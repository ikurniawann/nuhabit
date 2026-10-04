package sales

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
)

// patchOrder is PATCH /api/pos/orders/{id}: status changes and settlement of
// an open bill (cash/QRIS/card, ARK Coin, NFC Tab, gift card, FOC and owner
// comp).
func (h *Handler) patchOrder(w http.ResponseWriter, r *http.Request) error {
	user, err := kit.PosUser(h.auth, r)
	if err != nil {
		return err
	}
	body, err := readObj(r)
	if err != nil { // JSON.parse throws a real Error: its message is printed.
		return h.writeOutcome(w, nil, err, "Error updating order")
	}
	var res *response
	err = database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		var err error
		res, err = h.patchOrderTx(r.Context(), tx, user, r.PathValue("id"), body)
		return err
	})
	return h.writeOutcomeOr(w, res, err, "Error updating order", "Unknown error")
}

// setList is an ordered UPDATE SET list.
type setList struct {
	cols []string
	vals map[string]any
}

func newSetList() *setList { return &setList{vals: map[string]any{}} }

func (s *setList) set(col string, v any) {
	if _, ok := s.vals[col]; !ok {
		s.cols = append(s.cols, col)
	}
	s.vals[col] = v
}

func (s *setList) has(col string) bool { _, ok := s.vals[col]; return ok }

func (s *setList) str(col string) string {
	v, _ := s.vals[col].(string)
	return v
}

func (s *setList) sql(args *sqlArgs) string {
	parts := make([]string, len(s.cols))
	for i, c := range s.cols {
		parts[i] = `"` + c + `" = ` + args.add(s.vals[c])
	}
	return strings.Join(parts, ", ")
}

func (h *Handler) patchOrderTx(ctx context.Context, tx pgx.Tx, user *auth.User, orderID string, body domain.Obj) (*response, error) {
	status := ""
	if body.Truthy("status") {
		status = body.Str("status")
	}
	paymentStatus := ""
	if body.Truthy("payment_status") {
		paymentStatus = body.Str("payment_status")
	}
	method := ""
	if body.Truthy("payment_method") {
		method = body.Str("payment_method")
	}
	amountPaid := body.NumOr0("amount_paid")
	arkUsed := body.NumOr0("ark_coins_used")
	_, amountSent := body.Get("amount_paid").(domain.Undefined)
	amountSent = !amountSent
	_, arkSent := body.Get("ark_coins_used").(domain.Undefined)
	arkSent = !arkSent

	upd := newSetList()
	if status != "" && status != "completed" {
		upd.set("status", status)
	}
	if paymentStatus != "" {
		upd.set("payment_status", paymentStatus)
	}
	if method != "" {
		upd.set("payment_method", method)
	}
	if amountSent {
		upd.set("amount_paid", amountPaid)
	}
	if arkSent {
		upd.set("ark_coins_used", arkUsed)
	}
	if body.Truthy("notes") {
		upd.set("notes", body.Str("notes"))
	}
	qrID, extID := domain.SanitizeXenditRef(body.Str("xendit_qr_id")), domain.SanitizeXenditRef(body.Str("xendit_external_id"))
	if qrID != "" {
		upd.set("xendit_qr_id", qrID)
	}
	if extID != "" {
		upd.set("xendit_external_id", extID)
	}
	stamp := domain.ResolvePaymentCatalogStamp(body.Str("payment_method_code"), body.Str("payment_method_name"))
	if stamp.Code != "" {
		upd.set("payment_method_code", stamp.Code)
	}
	if stamp.Name != "" {
		upd.set("payment_method_name", stamp.Name)
	}
	if status == "completed" || paymentStatus == "paid" {
		upd.set("payment_status", "paid")
	}

	existing, err := jsrow.QueryOne(ctx, tx, `SELECT customer_id, payment_status, payment_method, subtotal, total_amount, order_number, company_id, branch_id, queue_number, status, checkout_id, xendit_qr_id, xendit_external_id
		FROM pos.pos_orders WHERE id = $1`, orderID)
	if err != nil || existing == nil {
		return nil, fail(404, "Order tidak ditemukan")
	}
	existingPaid := existing.Str("payment_status") == "paid"
	gross := domain.Or(existing.Num("subtotal"), existing.Num("total_amount"))
	orderNumber := existing.Str("order_number")
	customerID := existing.Str("customer_id")

	// Owner Comp (EPIC-043): legacy PIN check over every pos_supervisor.
	var ownerComp *Approver
	var family struct {
		checkoutID string
		siblings   []string
	}
	if body.Str("comp_type") == domain.OwnerComp {
		if paymentStatus != "paid" {
			return nil, fail(400, "owner_comp hanya berlaku saat pelunasan open bill")
		}
		if existingPaid {
			return nil, fail(400, "Bill sudah dibayar — tidak bisa diubah jadi komplimen")
		}
		pin := domain.Trim(body.Str("supervisor_pin"))
		if pin == "" {
			return nil, fail(400, "Owner Comp membutuhkan PIN supervisor")
		}
		s, err := h.findAnySupervisorByPin(ctx, tx, pin)
		if err != nil {
			return nil, err
		}
		if s == nil {
			return nil, fail(403, "PIN supervisor tidak valid")
		}
		ownerComp = s
		setComp(upd, gross, "Owner Comp", domain.OwnerComp, s)
		if cid := existing.Str("checkout_id"); cid != "" {
			family.checkoutID = cid
			sibs, err := jsrow.Query(ctx, tx, `SELECT id, subtotal, payment_status, status FROM pos.pos_orders WHERE checkout_id = $1 AND id <> $2`, cid, orderID)
			if err != nil {
				return nil, err
			}
			for _, s := range sibs {
				st := s.Str("status")
				if s.Str("payment_status") != "paid" && st != "cancelled" && st != "voided" && st != "merged" {
					family.siblings = append(family.siblings, s.Str("id"))
				}
			}
		}
	}

	effective := existing.Str("payment_method") // payment_method ?? existing.payment_method
	if v := body.Get("payment_method"); !domain.IsNullish(v) {
		effective = domain.String(v)
	}
	settling := (upd.str("payment_status") == "paid" || paymentStatus == "paid") && !existingPaid
	if effective == "qris" && settling {
		q := firstStr(qrID, domain.SanitizeXenditRef(existing.Str("xendit_qr_id")))
		x := firstStr(extID, domain.SanitizeXenditRef(existing.Str("xendit_external_id")))
		used := false
		if q != "" || x != "" {
			col, val := "xendit_qr_id", q
			if q == "" {
				col, val = "xendit_external_id", x
			}
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pos.pos_orders WHERE payment_status = 'paid' AND id <> $1 AND `+col+` = $2)`, orderID, val).Scan(&used); err != nil {
				return nil, err
			}
		}
		if msg := domain.AssertQrisSaleMaySettle("qris", q, x, used); msg != "" {
			return nil, fail(400, msg)
		}
	}
	orderTotal := existing.Num("total_amount")
	if arkUsed > 0 && effective != "ark_coin" {
		return nil, fail(400, "ARK Coin tidak bisa dicampur metode lain — 1 transaksi 1 metode pembayaran")
	}
	if effective == "ark_coin" && arkSent && arkUsed < orderTotal {
		return nil, fail(400, "Pembayaran ARK Coin harus menutup seluruh total order")
	}
	ownAmount := effective == "ark_coin" || effective == "nfc_tab" || effective == "gift_card"

	var focApprover *Approver
	if settling && ownerComp == nil && domain.IsFocPaymentMethod(body.Str("payment_method_code"), body.Str("payment_method_name")) {
		if customerID == "" {
			return nil, fail(400, "Metode FOC membutuhkan customer/member — pasangkan customer ke bill dulu")
		}
		pin := domain.Trim(body.Str("supervisor_pin"))
		if pin == "" {
			return nil, fail(400, "Metode FOC membutuhkan PIN supervisor")
		}
		a, err := h.approveWithPin(ctx, user.ID, pin)
		if err != nil {
			return nil, err
		}
		if a.Approver == nil {
			return nil, rejection(a, "PIN supervisor tidak valid")
		}
		focApprover = a.Approver
		setComp(upd, gross, "FOC", domain.FocComp, focApprover)
	}
	if settling && !ownAmount && ownerComp == nil && focApprover == nil && amountSent {
		if amountPaid+arkUsed < orderTotal-0.5 {
			return nil, fail(400, fmt.Sprintf("Nominal pembayaran (%s) kurang dari total bill %s (%s)", domain.FormatRupiah(amountPaid), orderNumber, domain.FormatRupiah(orderTotal)))
		}
		if effective != "cash" && math.Abs(amountPaid-orderTotal) > 1 {
			return nil, fail(409, fmt.Sprintf("Nominal pembayaran (%s) tidak sama dengan total bill tersimpan %s (%s) — muat ulang bill sebelum menagih", domain.FormatRupiah(amountPaid), orderNumber, domain.FormatRupiah(orderTotal)))
		}
	}

	company, branch := existing.Str("company_id"), existing.Str("branch_id")
	if effective == "nfc_tab" && settling {
		if !h.limiter.Allow("pos-nfc-tab:"+user.ID, 30) {
			return nil, fail(429, "Terlalu banyak percobaan NFC Tab — tunggu sebentar")
		}
		if existing.Str("payment_status") == "partial" {
			return nil, fail(400, "Order sudah terbayar sebagian — NFC Tab hanya untuk order yang belum terbayar")
		}
		uid := domain.Trim(body.Str("nfc_tab_uid"))
		if uid == "" {
			return nil, fail(400, "Pembayaran NFC Tab membutuhkan tap gelang")
		}
		if !domain.IsValidNfcUID(domain.NormalizeNfcUID(uid)) {
			return nil, fail(400, "UID gelang tidak valid — tap ulang gelang")
		}
		if arkUsed > 0 {
			return nil, fail(400, "NFC Tab tidak bisa dicampur ARK Coin — 1 transaksi 1 metode")
		}
		if company == "" || branch == "" {
			return nil, fail(400, "Order tanpa venue — tidak bisa charge ke tab")
		}
		out, err := h.p.Tabs.Charge(ctx, tx, ports.TabCharge{OrderID: orderID, OrderNumber: firstStr(orderNumber, orderID), Amount: orderTotal,
			BandUID: uid, CompanyID: company, BranchID: branch, CreatedBy: user.ID})
		if err != nil {
			return nil, err
		}
		if !out.OK {
			h.log.Error("[pos] nfc_tab charge rejected", "order", orderID, "user", user.ID, "reason", out.Reason)
			st := out.Status
			if st == 402 {
				st = 400
			}
			return nil, fail(st, out.Reason)
		}
		if err := markPaid(ctx, tx, orderID, true); err != nil {
			return nil, err
		}
		upd.set("amount_paid", 0)
	}
	if effective == "gift_card" && settling {
		if !h.limiter.Allow("pos-gift-card:"+user.ID, 30) {
			return nil, fail(429, "Terlalu banyak percobaan gift card — tunggu sebentar")
		}
		if existing.Str("payment_status") == "partial" {
			return nil, fail(400, "Order sudah terbayar sebagian — gift card hanya untuk order yang belum terbayar")
		}
		code := strings.ToUpper(domain.Trim(body.Str("gift_card_code")))
		if code == "" {
			return nil, fail(400, "Pembayaran gift card membutuhkan kode kartu")
		}
		if arkUsed > 0 {
			return nil, fail(400, "Gift card tidak bisa dicampur ARK Coin — 1 transaksi 1 metode")
		}
		if company == "" || branch == "" {
			return nil, fail(400, "Order tanpa venue — gift card tidak bisa dipakai")
		}
		out, err := h.p.GiftCards.Redeem(ctx, tx, ports.GiftRedeem{Scope: ports.GiftScope{CompanyID: company, BranchID: branch},
			Code: code, Amount: orderTotal, OrderID: orderID, CreatedBy: user.ID})
		if err != nil {
			return nil, err
		}
		if !out.OK {
			h.log.Error("[pos] gift_card debit rejected", "order", orderID, "user", user.ID, "reason", out.Reason)
			return nil, fail(out.Status, out.Reason)
		}
		upd.set("amount_paid", 0)
	}

	var arkAfter *float64
	switch {
	case arkUsed > 0 && customerID != "" && !existingPaid:
		bal, err := h.p.Wallet.Move(ctx, tx, ports.ArkMove{CustomerID: customerID, Amount: -arkUsed, Type: "payment", OrderID: orderID})
		if errors.Is(err, ports.ErrArkInsufficient) {
			return nil, fail(400, "Saldo ARK Coin tidak cukup")
		}
		if errors.Is(err, ports.ErrArkFailed) {
			return nil, fail(400, "Gagal memproses ARK Coin")
		}
		if err != nil {
			return nil, err
		}
		arkAfter = bal
	case arkUsed > 0 && customerID != "" && existingPaid:
		if arkAfter, err = h.p.Wallet.Balance(ctx, tx, customerID); err != nil {
			return nil, err
		}
	}

	if len(upd.cols) == 0 {
		// The TS shim builds "UPDATE … SET  WHERE …" and PostgreSQL rejects it.
		return nil, errors.New(`syntax error at or near "WHERE"`)
	}
	var args sqlArgs
	setSQL := upd.sql(&args)
	data, err := jsrow.QueryOne(ctx, tx, `UPDATE "pos"."pos_orders" SET `+setSQL+` WHERE "id" = `+args.add(orderID)+` RETURNING *`, args.list...)
	if err != nil {
		return nil, err
	}
	if data == nil {
		return nil, errors.New("No rows found")
	}

	now := h.clock()
	switch {
	case ownerComp != nil && family.checkoutID != "":
		for _, sib := range family.siblings {
			var sub, total *float64
			_ = tx.QueryRow(ctx, `SELECT subtotal::float8, total_amount::float8 FROM pos.pos_orders WHERE id = $1`, sib).Scan(&sub, &total)
			bestEffort(ctx, tx, `UPDATE pos.pos_orders SET payment_status = 'paid', discount_amount = $2, discount_reason = 'Owner Comp', total_amount = 0,
				amount_paid = 0, change_amount = 0, comp_type = 'owner_comp', comp_approved_by = $3, comp_approved_name = $4, updated_at = $5 WHERE id = $1`,
				sib, domain.Or(fval(sub), fval(total)), ownerComp.ID, ownerComp.Name, now)
		}
		var chkGross float64
		_ = tx.QueryRow(ctx, `SELECT COALESCE(SUM(subtotal), 0)::float8 FROM pos.pos_orders WHERE checkout_id = $1`, family.checkoutID).Scan(&chkGross)
		bestEffort(ctx, tx, `UPDATE pos.pos_checkouts SET payment_status = 'paid', discount_amount = $2, total_amount = 0, amount_paid = 0, change_amount = 0, updated_at = $3 WHERE id = $1`,
			family.checkoutID, chkGross, now)
		if err := publish(ctx, tx, possales.TopicCompApproved, orderID, possales.CompApproved{CompType: domain.OwnerComp, OrderNumber: firstStr(orderNumber, orderID),
			OrderCount: 1 + len(family.siblings), GrossIdr: chkGross, ApprovedName: &ownerComp.Name, CustomerID: strPtr(customerID)}); err != nil {
			return nil, err
		}
	case ownerComp != nil:
		if err := publish(ctx, tx, possales.TopicCompApproved, orderID, possales.CompApproved{CompType: domain.OwnerComp, OrderNumber: firstStr(orderNumber, orderID),
			GrossIdr: gross, ApprovedName: &ownerComp.Name, CustomerID: strPtr(customerID)}); err != nil {
			return nil, err
		}
	case focApprover != nil:
		if err := publish(ctx, tx, possales.TopicCompApproved, orderID, possales.CompApproved{CompType: domain.FocComp, OrderNumber: firstStr(orderNumber, orderID),
			GrossIdr: gross, ApprovedName: strPtr(focApprover.Name), CustomerID: strPtr(customerID)}); err != nil {
			return nil, err
		}
	}

	if status == "cancelled" {
		h.restoreMerchForOrder(ctx, tx, orderID)
	}
	if status != "" {
		changedBy := "system"
		if body.Truthy("changed_by") {
			changedBy = body.Str("changed_by")
		}
		var notes any
		if !domain.IsNullish(body.Get("status_notes")) {
			notes = jsonScalar(body.Get("status_notes"))
		}
		bestEffort(ctx, tx, `INSERT INTO pos.pos_order_status_history (order_id, from_status, to_status, changed_by, notes) VALUES ($1, NULL, $2, $3, $4)`,
			orderID, status, changedBy, notes)
	}
	nowPaid := settling
	if nowPaid {
		if q := h.ensureQueueNumber(ctx, tx, orderID, existing.Str("queue_number"), company, branch); q != "" {
			data.Set("queue_number", q)
		}
		m := firstStr(effective)
		if err := publish(ctx, tx, possales.TopicSaleSettled, orderID, possales.SaleSettled{OrderID: orderID, UserID: user.ID, PaymentMethod: nullableStr(m)}); err != nil {
			return nil, err
		}
	}

	// XP is in the response (crm_xp, xp_total_after), so it is awarded here
	// through the port; customer stats travel on pos.sale.completed.
	var crmXP any
	var xpTotal *float64
	dataCustomer := data.Str("customer_id")
	var items []*jsrow.Row
	if nowPaid || (dataCustomer != "" && (status == "completed" || paymentStatus == "paid")) {
		if items, err = jsrow.Query(ctx, tx, `SELECT "product_id", "quantity", "unit_price", "subtotal", "total_amount" FROM "pos"."pos_order_items" WHERE "order_id" = $1`, orderID); err != nil {
			return nil, err
		}
	}
	if dataCustomer != "" && (status == "completed" || paymentStatus == "paid") {
		award, err := h.p.Loyalty.AwardOrderXP(ctx, tx, ports.OrderXP{OrderID: orderID, CustomerID: dataCustomer, TotalAmount: data.Num("total_amount"),
			Items: xpItems(items), OutletID: strPtr(data.Str("branch_id")), PaymentMethod: effective})
		if err != nil {
			return nil, err
		}
		crmXP = award
		if xpTotal, err = h.p.Loyalty.TotalXP(ctx, tx, dataCustomer); err != nil {
			return nil, err
		}
	}
	if nowPaid {
		total := data.Num("total_amount")
		event := saleCompleted(orderID, dataCustomer, total, effective, data.Str("branch_id"), user.ID, items)
		if dataCustomer != "" {
			event.StatsAmount = &total
		}
		if err := publish(ctx, tx, possales.TopicSaleCompleted, orderID, event); err != nil {
			return nil, err
		}
	}
	return &response{status: 200, body: jsrow.Object("success", true, "data", data, "crm_xp", crmXP, "ark_balance_after", arkAfter, "xp_total_after", xpTotal)}, nil
}

func fval(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}

func nullableStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// setComp writes the free-of-charge columns (Owner Comp / FOC).
func setComp(upd *setList, gross float64, reason, compType string, a *Approver) {
	upd.set("discount_amount", gross)
	upd.set("discount_reason", reason)
	upd.set("total_amount", 0)
	upd.set("amount_paid", 0)
	upd.set("change_amount", 0)
	upd.set("comp_type", compType)
	upd.set("comp_approved_by", a.ID)
	upd.set("comp_approved_name", a.Name)
}

// findAnySupervisorByPin is the Owner Comp check: every pos_supervisor,
// no scope, status or attempt limit (the TS uses findSupervisorByPin over
// `users` where role = pos_supervisor).
func (h *Handler) findAnySupervisorByPin(ctx context.Context, q database.Querier, pin string) (*Approver, error) {
	rows, err := q.Query(ctx, `SELECT "id"::text, "full_name", "pos_pin" FROM "configuration"."users" WHERE "role" = 'pos_supervisor'`)
	if err != nil {
		return nil, err
	}
	type cand struct {
		id   string
		name *string
		pin  *string
	}
	var list []cand
	for rows.Next() {
		var c cand
		if err := rows.Scan(&c.id, &c.name, &c.pin); err != nil {
			rows.Close()
			return nil, err
		}
		list = append(list, c)
	}
	rows.Close()
	for _, c := range list {
		ok, err := verifyPosPin(ctx, q, pin, deref(c.pin))
		if err != nil {
			return nil, err
		}
		if ok {
			return &Approver{ID: c.id, Name: firstStr(deref(c.name), "Supervisor")}, nil
		}
	}
	return nil, nil
}

// restoreMerchForOrder is restoreMerchandiseStockForOrder: lines flagged
// inventory_deducted get their stock back and lose the flag.
func (h *Handler) restoreMerchForOrder(ctx context.Context, tx pgx.Tx, orderID string) {
	rows, err := jsrow.Query(ctx, tx, `SELECT id, product_id, sku_id, quantity FROM pos.pos_order_items WHERE order_id = $1 AND inventory_deducted = true`, orderID)
	if err != nil {
		h.log.Error("[pos] merch cancel-restore load failed", "order", orderID, "error", err)
		return
	}
	for _, r := range rows {
		qty := r.Num("quantity")
		if r.Str("product_id") == "" || qty <= 0 {
			continue
		}
		if !h.p.Merchandise.RestoreOne(ctx, tx, ports.MerchClaim{ProductID: r.Str("product_id"), SkuID: r.Str("sku_id"), Qty: qty}) {
			continue
		}
		bestEffort(ctx, tx, `UPDATE pos.pos_order_items SET inventory_deducted = false WHERE id = $1`, r.Str("id"))
	}
}
