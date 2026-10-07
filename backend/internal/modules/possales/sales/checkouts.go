package sales

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/scope"
)

/* ── POST /api/pos/checkouts ─────────────────────────────────────────── */

func (h *Handler) createCheckout(w http.ResponseWriter, r *http.Request) error {
	user, err := kit.PosUser(h.auth, r)
	if err != nil {
		return err
	}
	res, err := h.createCheckoutUseCase(r, user)
	return h.writeOutcome(w, res, err, "[pos] create checkout error")
}

func (h *Handler) createCheckoutUseCase(r *http.Request, user *auth.User) (*response, error) {
	ctx := r.Context()
	userID := user.ID
	body, err := readObj(r)
	if err != nil {
		return nil, err
	}
	if body.Str("payment_method") == "ark_coin" || body.NumOr0("ark_coins_used") > 0 {
		if !h.p.Loyalty.ArkCoinEnabled(ctx, h.db) {
			return nil, arkDisabled()
		}
	}
	var items []domain.Obj
	if list, ok := body.List("items"); ok {
		for _, it := range list {
			m, _ := it.(map[string]any)
			items = append(items, domain.Obj(m))
		}
	}
	if len(items) == 0 {
		return nil, fail(400, "Items and total amount are required")
	}
	ids := productIDs(items, false)
	warehouses, err := h.p.Catalog.Warehouses(ctx, h.db, ids)
	if err != nil {
		return nil, err
	}
	sc, err := scope.Load(ctx, h.db, userID)
	if err != nil {
		return nil, err
	}
	gate, err := h.cashierGate(r, user, deref(sc.Role))
	if err != nil {
		return nil, err
	}
	splits, _ := body.List("splits")
	guard := domain.GuardMixedCheckoutCart(ids, warehouses, domain.CanSellMixedStall(gate.HasCentralMenu, gate.CanCentralCheckout, gate.Mode),
		len(splits) > 0, body.Str("promo_code"))
	if guard.Message != "" {
		return nil, fail(400, guard.Message)
	}
	if !guard.CreateCheckout {
		return nil, fail(400, domain.MsgMultiStallRequired)
	}
	customerID := body.Str("customer_id")
	allowed, msg, err := h.p.Loyalty.CheckProductPrivileges(ctx, h.db, ids, customerID)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, fail(403, msg)
	}
	gross := 0.0
	for _, it := range items {
		v := it.Get("subtotal")
		if domain.IsNullish(v) {
			v = it.Get("total_amount")
		}
		gross += domain.Or0(domain.Number(v))
	}
	compType := ""
	if ct := body.Get("comp_type"); !domain.IsNullish(ct) && domain.String(ct) != "" {
		if domain.String(ct) != domain.KolComp {
			return nil, fail(400, "comp_type tidak dikenal utk checkout")
		}
		if customerID == "" {
			return nil, fail(400, "Komplimen KOL membutuhkan customer")
		}
		if body.NumOr0("total_amount") > 0.5 {
			return nil, fail(400, "Komplimen KOL harus menggratiskan seluruh order (total 0)")
		}
		reason, err := h.p.Loyalty.ValidateKolComp(ctx, h.db, customerID, gross)
		if err != nil {
			return nil, err
		}
		if reason != "" {
			return nil, fail(403, reason)
		}
		compType = domain.KolComp
	}
	var approver *Approver
	if domain.IsFocPaymentMethod(body.Str("payment_method_code"), body.Str("payment_method_name")) {
		if customerID == "" {
			return nil, fail(400, "Metode FOC membutuhkan customer/member — pilih customer dulu")
		}
		pin := domain.Trim(body.Str("supervisor_pin"))
		if pin == "" {
			return nil, fail(400, "Metode FOC membutuhkan PIN supervisor")
		}
		a, err := h.pins.Approve(ctx, userID, pin)
		if err != nil {
			return nil, err
		}
		if a.Approver == nil {
			return nil, rejection(a, "PIN supervisor tidak valid")
		}
		approver = a.Approver
	}
	in := mixedInput{
		MixedSaleInput: domain.MixedSaleInput{
			Items: items, WarehouseByProduct: warehouses, OrderType: body.Str("order_type"), CustomerID: customerID,
			CashierID: h.resolveCashierID(ctx, userID, body.Str("cashier_id")), ServerID: body.Str("server_id"),
			TableID: body.Str("table_id"), GuestCount: body.Get("guest_count"), DiscountAmount: body.Get("discount_amount"),
			DiscountReason: body.Str("discount_reason"), PromoCode: body.Str("promo_code"), TaxAmount: body.Get("tax_amount"),
			ServiceChargeAmount: body.Get("service_charge_amount"), OtherChargesAmount: body.Get("other_charges_amount"),
			ChargesBreakdown: body.Get("charges_breakdown"), PaymentMethod: body.Str("payment_method"),
			PaymentStatus: body.Str("payment_status"), AmountPaid: body.Get("amount_paid"), ArkCoinsUsed: body.Get("ark_coins_used"),
			Notes: body.Str("notes"), SpecialRequests: body.Str("special_requests"), SessionUserID: userID,
		},
		BranchID: body.Str("branch_id"), ShiftID: body.Str("shift_id"),
		PaymentMethodCode: body.Str("payment_method_code"), PaymentMethodName: body.Str("payment_method_name"),
		CompType: compType, CompApproved: approver,
	}
	in.CompanyID = deref(sc.CompanyID)
	if in.BranchID == "" {
		in.BranchID = deref(sc.BranchID)
	}
	if approver != nil {
		zero := jsonZero
		in.DiscountAmount, in.DiscountReason = gross, "FOC"
		in.TaxAmount, in.ServiceChargeAmount, in.OtherChargesAmount, in.AmountPaid = zero, zero, zero, zero
		in.CompType = domain.FocComp
	}
	var res mixedResult
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		var err error
		if res, err = h.createMixedCheckout(ctx, tx, in); err != nil {
			return err
		}
		if approver != nil {
			return publish(ctx, tx, possales.TopicCompApproved, res.CheckoutID, possales.CompApproved{
				CompType: domain.FocComp, OrderNumber: res.CheckoutNumber, OrderCount: len(res.OrderIDs),
				GrossIdr: gross, ApprovedName: &approver.Name, CustomerID: strPtr(customerID),
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	var approvedName any
	if approver != nil {
		approvedName = approver.Name
	}
	var crmXP any
	if res.XPAwarded != 0 {
		crmXP = jsrow.Object("xpAwarded", res.XPAwarded)
	}
	return &response{status: 201, body: jsrow.Object(
		"success", true,
		"data", jsrow.Object("checkout_id", res.CheckoutID, "checkout_number", res.CheckoutNumber, "queue_number", res.QueueNumber,
			"order_ids", nonNil(res.OrderIDs), "comp_approved_name", approvedName),
		"ark_balance_after", res.ArkBalanceAfter,
		"xp_total_after", res.XPTotalAfter,
		"crm_xp", crmXP,
	)}, nil
}

// rejection is supervisorPinRejection as a use-case response.
func rejection(a Approval, invalid string) *response {
	if a.RetryMinutes > 0 {
		return fail(429, domain.SupervisorPinLockedMessage(a.RetryMinutes))
	}
	return fail(403, invalid)
}

/* ── POST /api/pos/checkouts/{id}/complete ───────────────────────────── */

func (h *Handler) completeCheckout(w http.ResponseWriter, r *http.Request) error {
	user, err := kit.PosUser(h.auth, r)
	if err != nil {
		return err
	}
	res, err := h.completeCheckoutUseCase(r, user.ID)
	return h.writeOutcome(w, res, err, "[pos] complete checkout error")
}

func (h *Handler) completeCheckoutUseCase(r *http.Request, userID string) (*response, error) {
	ctx := r.Context()
	id := domain.Trim(r.PathValue("id"))
	if id == "" {
		return nil, fail(400, "Checkout tidak valid")
	}
	body := readObjOrEmpty(r)
	var amountPaid *float64
	if !domain.IsNullish(body.Get("amount_paid")) {
		v := domain.Number(body.Get("amount_paid"))
		amountPaid = &v
	}
	var approver *Approver
	if domain.IsFocPaymentMethod(body.Str("payment_method_code"), body.Str("payment_method_name")) {
		var customer *string
		err := h.db.QueryRow(ctx, `SELECT customer_id::text FROM pos.pos_checkouts WHERE id = $1`, id).Scan(&customer)
		if err != nil && !database.IsNoRows(err) {
			return nil, err
		}
		if deref(customer) == "" {
			return nil, fail(400, "Metode FOC membutuhkan customer/member — pasangkan customer ke bill dulu")
		}
		pin := domain.Trim(body.Str("supervisor_pin"))
		if pin == "" {
			return nil, fail(400, "Metode FOC membutuhkan PIN supervisor")
		}
		a, err := h.pins.Approve(ctx, userID, pin)
		if err != nil {
			return nil, err
		}
		if a.Approver == nil {
			return nil, rejection(a, "PIN supervisor tidak valid")
		}
		approver = a.Approver
	}
	tender := completeTender{
		Method: body.Str("payment_method"), AmountPaid: amountPaid,
		Code: body.Str("payment_method_code"), Name: body.Str("payment_method_name"), Approver: approver,
	}
	var orderIDs []string
	err := database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		var err error
		if orderIDs, err = h.completeMixedCheckout(ctx, tx, id, tender, false); err != nil {
			return err
		}
		if approver == nil {
			return nil
		}
		var gross float64
		var number, customer *string
		if err := tx.QueryRow(ctx, `SELECT COALESCE(SUM(subtotal), 0)::float8 FROM pos.pos_orders WHERE id = ANY($1::uuid[])`, orderIDs).Scan(&gross); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT checkout_number, customer_id::text FROM pos.pos_checkouts WHERE id = $1`, id).Scan(&number, &customer); err != nil {
			return err
		}
		return publish(ctx, tx, possales.TopicCompApproved, id, possales.CompApproved{
			CompType: domain.FocComp, OrderNumber: firstStr(deref(number), id), OrderCount: len(orderIDs),
			GrossIdr: gross, ApprovedName: &approver.Name, CustomerID: customer,
		})
	})
	if err != nil {
		return nil, err
	}
	var approvedName any
	if approver != nil {
		approvedName = approver.Name
	}
	return &response{status: 200, body: jsrow.Object("success", true, "data",
		jsrow.Object("order_ids", nonNil(orderIDs), "comp_approved_name", approvedName))}, nil
}

// completeTender is CompleteMixedCheckoutTender.
type completeTender struct {
	Method     string
	AmountPaid *float64
	Code, Name string
	Approver   *Approver
}

// completeMixedCheckout settles a stored checkout: existing children are
// marked paid, a childless checkout gets its children from the snapshot.
// paymentConfirmed skips the Xendit re-check (verified webhooks).
func (h *Handler) completeMixedCheckout(ctx context.Context, tx pgx.Tx, id string, tender completeTender, paymentConfirmed bool) ([]string, error) {
	existing, err := jsrow.Query(ctx, tx, `SELECT "id", "total_amount", "subtotal" FROM "pos"."pos_orders" WHERE "checkout_id" = $1`, id)
	if err != nil {
		return nil, err
	}
	preview, err := jsrow.QueryOne(ctx, tx, `SELECT id, customer_id, cashier_id, payment_method, payment_method_code, payment_method_name, branch_id, cart_snapshot, xendit_qr_id, xendit_external_id, total_amount
		FROM pos.pos_checkouts WHERE id = $1`, id)
	if err != nil {
		return nil, err
	}
	if preview == nil {
		return nil, &domain.CheckoutError{Status: 404, Message: "Checkout tidak ditemukan"}
	}
	childTotal := 0.0
	for _, c := range existing {
		childTotal += domain.ToNumber(c.Get("total_amount"), 0)
	}
	total := domain.Or(preview.Num("total_amount"), childTotal)
	method, amount := domain.CompleteTender(tender.Method, tender.AmountPaid, preview.Str("payment_method"), total)
	resolved, msg := domain.ResolveCheckoutBillTender(method, &amount, total)
	if msg != "" {
		return nil, domain.Reject(msg)
	}
	stamp := domain.ResolvePaymentCatalogStamp(firstStr(tender.Code, preview.Str("payment_method_code")), firstStr(tender.Name, preview.Str("payment_method_name")))
	if resolved.PaymentMethod == "qris" && !paymentConfirmed {
		if err := h.confirmStoredQrisPaid(ctx, tx, preview.Str("xendit_qr_id"), preview.Str("xendit_external_id")); err != nil {
			return nil, err
		}
	}
	snapshot := parseSnapshot(rawField(preview, "cart_snapshot"))
	if len(existing) > 0 {
		if err := h.payExistingChildren(ctx, tx, id, existing, preview, resolved, stamp, tender.Approver); err != nil {
			return nil, err
		}
		ids := make([]string, len(existing))
		for i, c := range existing {
			ids[i] = c.Str("id")
		}
		sessionUser := firstStr(snapString(snapshot, "sessionUserId"), preview.Str("cashier_id"))
		_, err := h.finalizePaidChildren(ctx, tx, ids, preview.Str("customer_id"), sessionUser, resolved.PaymentMethod, preview.Str("branch_id"), true)
		return ids, err
	}
	return h.settleAndInsertChildren(ctx, tx, id, resolved, stamp, tender.Approver)
}

// confirmStoredQrisPaid asks Xendit whether the stored QRIS was paid.
func (h *Handler) confirmStoredQrisPaid(ctx context.Context, q database.Querier, qrID, externalID string) error {
	if msg := domain.AssertCheckoutQrisReady(qrID, externalID, true); msg != "" {
		return &domain.CheckoutError{Status: 409, Message: msg}
	}
	cfg, err := h.p.Xendit.Config(ctx, q)
	if err != nil {
		return err
	}
	var remote map[string]any
	id := qrID
	if id != "" {
		remote, err = h.p.Xendit.GetQR(ctx, cfg.SecretKey, id)
	} else {
		remote, err = h.p.Xendit.GetQRByReference(ctx, cfg.SecretKey, externalID)
		if err == nil {
			id = domain.StrOr(remote["id"], "")
		}
	}
	if err != nil {
		return err
	}
	paid := isXenditQrPaid(remote)
	if !paid && id != "" {
		if payments, err := h.p.Xendit.QRPayments(ctx, cfg.SecretKey, id); err == nil {
			list := make([]any, len(payments))
			for i, p := range payments {
				list[i] = p
			}
			paid = isXenditQrPaid(map[string]any{"payments": list})
		}
	}
	if msg := domain.AssertCheckoutQrisReady(firstStr(qrID, id), externalID, paid); msg != "" {
		return &domain.CheckoutError{Status: 409, Message: msg}
	}
	return nil
}

func (h *Handler) payExistingChildren(ctx context.Context, tx pgx.Tx, id string, children []*jsrow.Row, preview *jsrow.Row, t domain.BillTender, stamp domain.CatalogStamp, approver *Approver) error {
	now := h.clock()
	focGross := 0.0
	for _, c := range children {
		focGross += domain.Or(domain.ToNumber(c.Get("subtotal"), 0), domain.ToNumber(c.Get("total_amount"), 0))
	}
	amountPaid, change := t.AmountPaid, t.ChangeAmount
	set := `payment_status = 'paid', payment_method = $2, amount_paid = $3, change_amount = $4, payment_method_code = $5, payment_method_name = $6, updated_at = $7`
	args := []any{id, t.PaymentMethod, amountPaid, change, nilIfEmpty(stamp.Code), nilIfEmpty(stamp.Name), now}
	if approver != nil {
		args[2], args[3] = 0, 0
		set += `, discount_amount = $8, total_amount = 0`
		args = append(args, focGross)
	}
	if _, err := tx.Exec(ctx, `UPDATE pos.pos_checkouts SET `+set+` WHERE id = $1 AND payment_status <> 'paid'`, args...); err != nil {
		return err
	}
	totals := make([]float64, len(children))
	for i, c := range children {
		totals[i] = domain.ToNumber(c.Get("total_amount"), 0)
	}
	parts := domain.AllocateAmount(t.AmountPaid, totals)
	for i, c := range children {
		paid, ch := parts[i], 0.0
		if i == 0 {
			ch = t.ChangeAmount
		}
		set := `payment_status = 'paid', payment_method = $2, amount_paid = $3, change_amount = $4, xendit_qr_id = $5, xendit_external_id = $6,
			payment_method_code = $7, payment_method_name = $8, updated_at = $9`
		args := []any{c.Str("id"), t.PaymentMethod, paid, ch, nilIfEmpty(preview.Str("xendit_qr_id")), nilIfEmpty(preview.Str("xendit_external_id")),
			nilIfEmpty(stamp.Code), nilIfEmpty(stamp.Name), now}
		if approver != nil {
			args[2], args[3] = 0, 0
			set += `, discount_amount = $10, discount_reason = 'FOC', total_amount = 0, comp_type = 'foc_comp', comp_approved_by = $11, comp_approved_name = $12`
			args = append(args, domain.Or(domain.ToNumber(c.Get("subtotal"), 0), totals[i]), approver.ID, approver.Name)
		}
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_orders SET `+set+` WHERE id = $1 AND payment_status <> 'paid'`, args...); err != nil {
			return err
		}
	}
	return nil
}

func (h *Handler) settleAndInsertChildren(ctx context.Context, tx pgx.Tx, id string, t domain.BillTender, stamp domain.CatalogStamp, approver *Approver) ([]string, error) {
	row, err := jsrow.QueryOne(ctx, tx, `SELECT `+checkoutBaseColumns+`, cart_snapshot, xendit_qr_id, xendit_external_id,
              payment_method_code, payment_method_name
       FROM pos.pos_checkouts
       WHERE id = $1
       FOR UPDATE`, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, &domain.CheckoutError{Status: 404, Message: "Checkout tidak ditemukan"}
	}
	c := checkoutFromRow(row)
	already, err := jsrow.Query(ctx, tx, `SELECT id FROM pos.pos_orders WHERE checkout_id = $1`, id)
	if err != nil {
		return nil, err
	}
	sessionUser := firstStr(snapString(c.Snapshot, "sessionUserId"), deref(c.CashierID))
	if len(already) > 0 {
		ids := make([]string, len(already))
		for i, a := range already {
			ids[i] = a.Str("id")
		}
		_, err := h.finalizePaidChildren(ctx, tx, ids, deref(c.CustomerID), sessionUser, firstStr(c.PaymentMethod, t.PaymentMethod), deref(c.BranchID), true)
		return ids, err
	}
	items := domain.SnapshotItems(c.Snapshot)
	if len(items) == 0 {
		return nil, &domain.CheckoutError{Status: 409, Message: "Checkout tidak punya item untuk diselesaikan"}
	}
	focGross := 0.0
	if approver != nil {
		for _, it := range items {
			v := it.Get("subtotal")
			if domain.IsNullish(v) {
				v = it.Get("total_amount")
			}
			focGross += domain.ToNumber(v, 0)
		}
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_checkouts
         SET payment_status = 'paid',
             payment_method = $2::pos_payment_method,
             amount_paid = 0,
             change_amount = 0,
             discount_amount = $3,
             tax_amount = 0,
             service_charge_amount = 0,
             other_charges_amount = 0,
             total_amount = 0,
             updated_at = now()
         WHERE id = $1`, id, t.PaymentMethod, focGross); err != nil {
			return nil, err
		}
	} else if _, err := tx.Exec(ctx, `UPDATE pos.pos_checkouts
         SET payment_status = 'paid',
             payment_method = $2::pos_payment_method,
             amount_paid = $3,
             change_amount = $4,
             updated_at = now()
         WHERE id = $1`, id, t.PaymentMethod, t.AmountPaid, t.ChangeAmount); err != nil {
		return nil, err
	}
	claims, status, reason, err := h.p.Merchandise.Claim(ctx, tx, merchLines(items))
	if err != nil {
		return nil, err
	}
	if reason != "" {
		return nil, &domain.CheckoutError{Status: status, Message: reason}
	}
	claimed := map[string]bool{}
	for _, cl := range claims {
		claimed[cl.ProductID] = true
	}
	cost, err := h.p.Catalog.CostPrices(ctx, tx, productIDs(items, true))
	if err != nil {
		return nil, err
	}
	c.PaymentStatus, c.PaymentMethod = "paid", t.PaymentMethod
	c.AmountPaid, c.ChangeAmount = t.AmountPaid, t.ChangeAmount
	compType := ""
	if approver != nil {
		c.AmountPaid, c.ChangeAmount = 0, 0
		c.DiscountAmount, c.TaxAmount, c.ServiceChargeAmount, c.OtherChargesAmount, c.TotalAmount = focGross, 0, 0, 0, 0
		compType = domain.FocComp
	}
	byProduct := map[string]string{}
	if m, ok := c.Snapshot["warehouseByProduct"].(map[string]any); ok {
		for k, v := range m {
			if s, ok := v.(string); ok {
				byProduct[k] = s
			}
		}
	}
	ids, err := h.insertChildren(ctx, tx, c, c.Snapshot, deref(c.TableID) != "", byProduct, claimed, cost, compType, approver)
	if err != nil {
		return nil, err
	}
	if c.XenditQRID != "" || c.XenditExternalID != "" {
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_orders
           SET xendit_qr_id = $2, xendit_external_id = $3, updated_at = now()
           WHERE checkout_id = $1`, id, nilIfEmpty(c.XenditQRID), nilIfEmpty(c.XenditExternalID)); err != nil {
			return nil, err
		}
	}
	if err := stampPaymentCatalog(ctx, tx, id, ids, firstStr(stamp.Code, row.Str("payment_method_code")), firstStr(stamp.Name, row.Str("payment_method_name"))); err != nil {
		return nil, err
	}
	_, err = h.finalizePaidChildren(ctx, tx, ids, deref(c.CustomerID), sessionUser, firstStr(c.PaymentMethod, t.PaymentMethod), deref(c.BranchID), false)
	return ids, err
}
