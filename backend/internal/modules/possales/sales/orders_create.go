package sales

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/modules/possales/offers"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/scope"
)

const (
	fallbackCashierID      = "00000000-0000-0000-0000-000000000001"
	arkCoinDisabledMessage = "Fitur ARK Coin sedang dinonaktifkan di pengaturan CRM"
)

// response is an HTTP answer decided inside a transaction. As an error it
// rolls the transaction back (the TS compensations undo the same writes).
type response struct {
	status int
	body   any
}

func (r *response) Error() string { return "response" }

func failBody(msg string) any {
	return struct {
		Success bool   `json:"success"`
		Error   string `json:"error"`
	}{false, msg}
}

func fail(status int, msg string) *response { return &response{status: status, body: failBody(msg)} }

// arkDisabled is the 409 of rejectIfArkCoinDisabled.
func arkDisabled() *response {
	return &response{status: 409, body: struct {
		Success bool   `json:"success"`
		Error   string `json:"error"`
		Code    string `json:"code"`
	}{false, arkCoinDisabledMessage, "ARK_COIN_DISABLED"}}
}

// writeOutcome writes a response produced by a use case: a *response (any
// status) or, for other errors, the route's 500 `{success:false,error}` with
// the error message.
func (h *Handler) writeOutcome(w http.ResponseWriter, res *response, err error, logMsg string) error {
	return h.writeOutcomeOr(w, res, err, logMsg, "")
}

// writeOutcomeOr is writeOutcome for routes whose catch-all prints a fixed
// text: their unexpected failures come from the TS query shim, whose error
// objects are not Error instances, so `error instanceof Error ? message :
// fallback` yields the fallback.
func (h *Handler) writeOutcomeOr(w http.ResponseWriter, res *response, err error, logMsg, fallback string) error {
	var r *response
	if errors.As(err, &r) {
		return httpx.JSON(w, r.status, r.body)
	}
	var ce *domain.CheckoutError
	if errors.As(err, &ce) {
		return kit.Fail(w, ce.Status, ce.Message)
	}
	if err != nil {
		h.log.Error(logMsg, "error", err)
		if fallback != "" {
			return kit.Fail(w, 500, fallback)
		}
		return kit.Fail(w, 500, kit.ErrorMessage(err))
	}
	return httpx.JSON(w, res.status, res.body)
}

/* ── request (order-types.ts) ────────────────────────────────────────── */

// orderReq is withOrderDefaults(body): defaults replace undefined only.
type orderReq struct {
	domain.Obj
	Items []domain.Obj
}

func withOrderDefaults(body domain.Obj) orderReq {
	defaults := map[string]any{
		"order_type": "dine_in", "discount_amount": jsonZero, "tax_amount": jsonZero,
		"service_charge_amount": jsonZero, "other_charges_amount": jsonZero, "charges_breakdown": []any{},
		"payment_method": "cash", "amount_paid": jsonZero, "ark_coins_used": jsonZero, "include_tax": false,
	}
	o := domain.Obj{}
	for k, v := range body {
		o[k] = v
	}
	for k, v := range defaults {
		if !o.Has(k) {
			o[k] = v
		}
	}
	req := orderReq{Obj: o}
	if list, ok := o.List("items"); ok {
		for _, it := range list {
			m, _ := it.(map[string]any)
			req.Items = append(req.Items, domain.Obj(m))
		}
	}
	return req
}

var jsonZero = json.Number("0")

func (r orderReq) itemsIsNonEmptyArray() bool {
	l, ok := r.List("items")
	return ok && len(l) > 0
}

/* ── POST /api/pos/orders ────────────────────────────────────────────── */

func (h *Handler) createOrder(w http.ResponseWriter, r *http.Request) error {
	user, err := kit.PosUser(h.auth, r)
	if err != nil {
		return err
	}
	body, err := readJSON(r)
	if err != nil {
		h.log.Error("Error creating order", "error", err)
		return kit.Fail(w, 500, kit.ErrorMessage(err))
	}
	obj, _ := body.(map[string]any)
	res, err := h.createPosOrder(r, user, withOrderDefaults(obj))
	return h.writeOutcome(w, res, err, "Error creating order")
}

// activeStallMode reads the stall switcher cookie (resolveActiveStallFromCookies).
func (h *Handler) activeStall(r *http.Request) (domain.ActiveStallMode, string) {
	value := ""
	for _, name := range []string{"nuhabit-active-stall", "arkiv-active-stall"} {
		if c, err := r.Cookie(name); err == nil && domain.Trim(c.Value) != "" {
			value = domain.Trim(c.Value)
			break
		}
	}
	if value == "" {
		return domain.StallUnset, ""
	}
	if value == "all" {
		return domain.StallAll, ""
	}
	w, err := h.p.Directory.ActiveWarehouse(r.Context(), h.db, value)
	if err != nil || w == nil {
		return domain.StallUnset, ""
	}
	return domain.StallOne, w.ID
}

// cashierGate is loadCentralCashierGate.
type cashierGate struct {
	CanCentralCheckout, HasCentralMenu bool
	Mode                               domain.ActiveStallMode
}

func (h *Handler) cashierGate(r *http.Request, user *auth.User, role string) (cashierGate, error) {
	flags, err := h.p.Directory.Flags(r.Context(), h.db, user.ID)
	if err != nil {
		return cashierGate{}, err
	}
	mode, _ := h.activeStall(r)
	return cashierGate{CanCentralCheckout: flags.CanCentralCheckout, HasCentralMenu: h.p.Directory.HasCentralMenu(r.Context(), user.ID, role), Mode: mode}, nil
}

// resolveCashierID: session employee → client id (not the dummy) → dummy.
func (h *Handler) resolveCashierID(ctx context.Context, userID, client string) string {
	if id, _ := h.p.Directory.EmployeeID(ctx, h.db, userID); id != "" {
		return id
	}
	if client != "" && client != fallbackCashierID {
		return client
	}
	return fallbackCashierID
}

// sellStall resolves the stall a single-stall sale is booked to
// (resolvePosSellStallForUser, or the one stall of an "all"-mode cart).
func (h *Handler) sellStall(r *http.Request, user *auth.User, sc *scope.Scope, singleFromAll string) (string, string, error) {
	ctx := r.Context()
	if singleFromAll != "" {
		allowed, err := h.stallAccess(ctx, user.ID, sc)
		if err != nil {
			return "", "", err
		}
		if msg := domain.AssertAllModeSellStallAssigned(singleFromAll, allowed); msg != "" {
			return "", msg, nil
		}
		return singleFromAll, "", nil
	}
	assigned, err := h.p.Directory.AssignedWarehouses(ctx, h.db, user.ID)
	if err != nil {
		return "", "", err
	}
	flags, err := h.p.Directory.Flags(ctx, h.db, user.ID)
	if err != nil {
		return "", "", err
	}
	ids := make([]string, len(assigned))
	for i, a := range assigned {
		ids[i] = a.ID
	}
	unscoped := sc == nil || sc.Unscoped
	mode, active := h.activeStall(r)
	if mode == domain.StallUnset && len(ids) == 0 && unscoped {
		mode = domain.StallAll
	}
	def := flags.DefaultWarehouseID
	if def == "" && len(ids) > 0 {
		def = ids[0]
	}
	res := domain.ResolvePosSellStall(mode, active, ids, def)
	if !res.OK() {
		return "", res.Message, nil
	}
	if !domain.IsSellStallAllowed(res.WarehouseID, ids, flags.CanSwitchStall, unscoped, flags.DefaultWarehouseID) {
		return "", domain.MsgStallOutsideAssignment, nil
	}
	return res.WarehouseID, "", nil
}

// stallAccess is getStallAccess(...).stalls ids.
func (h *Handler) stallAccess(ctx context.Context, userID string, sc *scope.Scope) ([]string, error) {
	assigned, err := h.p.Directory.AssignedWarehouses(ctx, h.db, userID)
	if err != nil {
		return nil, err
	}
	flags, err := h.p.Directory.Flags(ctx, h.db, userID)
	if err != nil {
		return nil, err
	}
	role, branch := "", ""
	if sc != nil {
		role, branch = deref(sc.Role), deref(sc.BranchID)
	}
	mainStorage := false
	for _, a := range assigned {
		mainStorage = mainStorage || a.IsDefault
	}
	list := assigned
	if domain.ComputeStallAllAccess(role, flags.CanSwitchStall, mainStorage) {
		if list, err = h.p.Directory.BranchWarehouses(ctx, h.db, branch); err != nil {
			return nil, err
		}
	}
	ids := make([]string, len(list))
	for i, w := range list {
		ids[i] = w.ID
	}
	return ids, nil
}

// createPosOrder is createPosOrder: mixed checkout, split bill or single order.
func (h *Handler) createPosOrder(r *http.Request, user *auth.User, req orderReq) (*response, error) {
	ctx := r.Context()
	if !req.itemsIsNonEmptyArray() {
		return nil, fail(400, "Items and total amount are required")
	}
	if req.Str("payment_method") == "ark_coin" || req.NumOr0("ark_coins_used") > 0 {
		if !h.p.Loyalty.ArkCoinEnabled(ctx, h.db) {
			return nil, arkDisabled()
		}
	}
	ids := productIDs(req.Items, false)
	warehouses, err := h.p.Catalog.Warehouses(ctx, h.db, ids)
	if err != nil {
		return nil, err
	}
	itemWarehouses := make([]string, len(ids))
	for i, id := range ids {
		itemWarehouses[i] = warehouses[id]
	}
	sc, err := scope.Load(ctx, h.db, user.ID)
	if err != nil {
		return nil, err
	}
	gate, err := h.cashierGate(r, user, deref(sc.Role))
	if err != nil {
		return nil, err
	}
	canMixed := domain.CanSellMixedStall(gate.HasCentralMenu, gate.CanCentralCheckout, gate.Mode)
	splits, _ := req.List("splits")
	guard := domain.GuardMixedCheckoutCart(ids, warehouses, canMixed, len(splits) > 0, req.Str("promo_code"))
	if guard.Message != "" {
		return nil, fail(400, guard.Message)
	}
	customerID := req.Str("customer_id")

	if guard.CreateCheckout {
		allowed, msg, err := h.p.Loyalty.CheckProductPrivileges(ctx, h.db, ids, customerID)
		if err != nil {
			return nil, err
		}
		if !allowed {
			return nil, fail(403, msg)
		}
		in := h.mixedInputFromOrder(ctx, user, req, sc, warehouses)
		var res mixedResult
		err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
			var err error
			res, err = h.createMixedCheckout(ctx, tx, in)
			return err
		})
		if err != nil {
			return nil, err
		}
		return &response{status: 201, body: jsrow.Object("success", true, "data", jsrow.Object(
			"checkout_id", res.CheckoutID, "checkout_number", res.CheckoutNumber,
			"queue_number", res.QueueNumber, "order_ids", nonNil(res.OrderIDs)))}, nil
	}

	soldFrom := domain.SoldFrom(gate.HasCentralMenu && gate.CanCentralCheckout)
	sellWarehouse, msg, err := h.sellStall(r, user, sc, domain.ResolveSingleStallSellFromAllMode(itemWarehouses, canMixed))
	if err != nil {
		return nil, err
	}
	if msg != "" {
		return nil, fail(400, msg)
	}
	if msg := domain.AssertProductWarehousesMatchStall(itemWarehouses, sellWarehouse); msg != "" {
		return nil, fail(400, msg)
	}
	cashierID := h.resolveCashierID(ctx, user.ID, req.Str("cashier_id"))
	allowed, pmsg, err := h.p.Loyalty.CheckProductPrivileges(ctx, h.db, ids, customerID)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, fail(403, pmsg)
	}
	nominals, reason, err := h.p.GiftCards.PrepareSale(ctx, h.db, giftLines(req.Items))
	if err != nil {
		return nil, err
	}
	if reason != "" {
		return nil, fail(400, reason)
	}
	oc := orderCtx{req: req, user: user, cashierID: cashierID, sellWarehouse: sellWarehouse, soldFrom: soldFrom, giftNominals: nominals}
	if len(splits) > 0 {
		return h.createSplitOrder(ctx, oc, splits)
	}
	return h.createSingleOrder(ctx, oc)
}

func nonNil(ids []string) []string {
	if ids == nil {
		return []string{}
	}
	return ids
}

func giftLines(items []domain.Obj) []ports.GiftSaleLine {
	out := make([]ports.GiftSaleLine, len(items))
	for i, it := range items {
		out[i] = ports.GiftSaleLine{
			ProductID: it.Str("product_id"), Quantity: it.Get("quantity"), UnitPrice: it.Get("unit_price"),
			VariantPriceAdjustment: it.Get("variant_price_adjustment"), ModifierPriceAdjustment: it.Get("modifier_price_adjustment"),
		}
	}
	return out
}

// mixedInputFromOrder maps the POST /api/pos/orders body to createMixedCheckout.
func (h *Handler) mixedInputFromOrder(ctx context.Context, user *auth.User, req orderReq, sc *scope.Scope, warehouses map[string]string) mixedInput {
	in := mixedInput{
		MixedSaleInput: domain.MixedSaleInput{
			Items: req.Items, WarehouseByProduct: warehouses, OrderType: req.Str("order_type"),
			CustomerID: req.Str("customer_id"), CashierID: h.resolveCashierID(ctx, user.ID, req.Str("cashier_id")),
			ServerID: req.Str("server_id"), TableID: req.Str("table_id"), GuestCount: req.Get("guest_count"),
			DiscountAmount: req.Get("discount_amount"), DiscountReason: req.Str("discount_reason"), PromoCode: req.Str("promo_code"),
			TaxAmount: req.Get("tax_amount"), ServiceChargeAmount: req.Get("service_charge_amount"),
			OtherChargesAmount: req.Get("other_charges_amount"), ChargesBreakdown: req.Get("charges_breakdown"),
			PaymentMethod: req.Str("payment_method"), AmountPaid: req.Get("amount_paid"), ArkCoinsUsed: req.Get("ark_coins_used"),
			Notes: req.Str("notes"), SpecialRequests: req.Str("special_requests"), SessionUserID: user.ID,
		},
		ShiftID: req.Str("shift_id"), PaymentMethodCode: req.Str("payment_method_code"), PaymentMethodName: req.Str("payment_method_name"),
		BranchID: req.Str("branch_id"),
	}
	in.CompanyID = deref(sc.CompanyID)
	if in.BranchID == "" {
		in.BranchID = deref(sc.BranchID)
	}
	return in
}

/* ── single order (orders/single-order.ts + settle-order.ts) ─────────── */

type orderCtx struct {
	req           orderReq
	user          *auth.User
	cashierID     string
	sellWarehouse string
	soldFrom      string
	giftNominals  []float64
}

func (h *Handler) createSingleOrder(ctx context.Context, oc orderCtx) (*response, error) {
	req := oc.req
	method := req.Str("payment_method")
	customerID := req.Str("customer_id")
	company, defBranch := h.p.Directory.Venue(ctx, h.db)
	branch := firstStr(req.Str("branch_id"), defBranch)

	// FOC approval writes the durable attempt counter, so it runs on the
	// pool before the sale transaction (a rejected PIN must stay counted).
	var approver *Approver
	focCheck := func() *response {
		if !domain.IsFocPaymentMethod(req.Str("payment_method_code"), req.Str("payment_method_name")) {
			return nil
		}
		pin := domain.Trim(req.Str("supervisor_pin"))
		if rej := domain.GuardFocRequest(customerID, pin); rej != nil {
			return fail(rej.Status, rej.Message)
		}
		a, err := h.approveWithPin(ctx, oc.user.ID, pin)
		if err != nil {
			return &response{status: 500, body: failBody(kit.ErrorMessage(err))}
		}
		if a.Approver == nil {
			if a.RetryMinutes > 0 {
				return fail(429, domain.SupervisorPinLockedMessage(a.RetryMinutes))
			}
			return fail(403, "PIN supervisor tidak valid")
		}
		approver = a.Approver
		return nil
	}

	var res *response
	err := database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		var err error
		res, err = h.placeSingleOrder(ctx, tx, oc, company, branch, method, customerID, focCheck, &approver)
		return err
	})
	return res, err
}

func (h *Handler) placeSingleOrder(ctx context.Context, tx pgx.Tx, oc orderCtx, company, branch, method, customerID string, focCheck func() *response, approverRef **Approver) (*response, error) {
	req := oc.req
	orderNumber, err := rpcText(ctx, tx, `SELECT * FROM "generate_order_number"()`)
	if err != nil {
		return nil, fail(500, kit.ErrorMessage(err))
	}
	queueNumber := h.allocateQueueNumber(ctx, tx, company, branch)
	subtotal := domain.ItemsSubtotal(req.Items)
	tax := req.NumOr0("tax_amount")
	service := req.NumOr0("service_charge_amount")
	other := req.NumOr0("other_charges_amount")
	lines := domain.BuildLineInputs(req.Items)
	membershipPct := req.NumOr0("membership_discount_pct")
	manualType := domain.ParseDiscountType(req.Get("manual_discount_type"))
	manualValue := domain.ParseNullableNumber(req.Get("manual_discount_value"))

	enteredCode := domain.Trim(req.Str("promo_code"))
	cart := make([]offers.CartLine, len(req.Items))
	for i, it := range req.Items {
		cart[i] = offers.CartLine{ProductID: it.Str("product_id"), Quantity: domain.ItemQuantity(it), UnitPrice: domain.ItemUnitPrice(it)}
	}
	eval, err := h.p.Offers.EvaluateForPosCart(ctx, tx, strPtr(company), strPtr(branch), cart, enteredCode, customerID)
	if err != nil {
		return nil, err
	}
	promoCode := enteredCode
	if eval.UnlockedRuleID != nil {
		promoCode = ""
	}
	stackIn := domain.StackInput{Items: lines, OfferDiscount: eval.OfferDiscount, MembershipPct: membershipPct, ManualType: manualType, ManualValue: manualValue}
	var hold *offers.PromoHold
	promoOrderID := ""
	if promoCode != "" {
		if company == "" || branch == "" {
			return nil, fail(400, "Venue belum dikonfigurasi — kode promo tidak bisa dipakai")
		}
		provisional := domain.ComputeDiscountStack(stackIn)
		promoOrderID = randomUUID()
		pl := make([]offers.PromoLineInput, len(req.Items))
		for i, it := range req.Items {
			amount := 0.0
			if i < len(provisional.LineResults) {
				amount = provisional.LineResults[i].TotalAmount
			}
			pl[i] = offers.PromoLineInput{ProductID: it.Str("product_id"), Amount: amount}
		}
		hold, err = h.p.Offers.HoldPromo(ctx, tx, offers.HoldInput{
			CompanyID: company, BranchID: branch, Code: promoCode, Channel: "pos", ContextType: offers.ContextPosOrder,
			ContextID: promoOrderID, Subtotal: provisional.ItemsSubtotal, CustomerID: customerID, Lines: pl,
		})
		var rej *offers.PromoRejectedError
		if errors.As(err, &rej) {
			return nil, fail(422, rej.Error())
		}
		if err != nil {
			return nil, err
		}
	}
	if hold != nil {
		stackIn.PromoDiscount = hold.Discount
	}
	stack := domain.ComputeDiscountStack(stackIn)
	discount := stack.DiscountAmount
	if math.Abs(req.NumOr0("discount_amount")-discount) > 1 {
		return nil, fail(400, "Total diskon tidak cocok — muat ulang dan coba lagi")
	}
	hasOffers := len(eval.Applied) > 0
	presetOrderID := promoOrderID
	if presetOrderID == "" && hasOffers {
		presetOrderID = randomUUID()
	}
	if presetOrderID != "" && hasOffers {
		err := h.p.Offers.RecordUsage(ctx, tx, offers.UsageInput{
			CompanyID: strPtr(company), BranchID: strPtr(branch), OrderID: presetOrderID, CustomerID: customerID,
			Applied: eval.Applied, Status: "held", Enforce: true,
		})
		var capErr *offers.CapReachedError
		if errors.As(err, &capErr) {
			return nil, fail(422, capErr.Error())
		}
		if err != nil {
			return nil, err
		}
	}
	labels := make([]string, len(eval.Applied))
	for i, a := range eval.Applied {
		labels[i] = a.Name
	}
	reason := domain.BuildDiscountReason(domain.DiscountReasonInput{
		HasItemDiscounts: stack.LineDiscountTotal > 0, OfferLabels: labels, MembershipPct: membershipPct,
		PromoCode: promoCode, ManualType: manualType, ManualValue: manualValue,
	})
	total := domain.TrustedTotal(method, hold != nil, req.Get("total_amount"), subtotal, discount, tax, service, other)
	paid := req.NumOr0("amount_paid")
	ark := req.NumOr0("ark_coins_used")
	nfcUID := domain.Trim(req.Str("nfc_tab_uid"))
	giftCode := strings.ToUpper(domain.Trim(req.Str("gift_card_code")))
	isNfc, payGift := method == "nfc_tab", method == "gift_card"

	if isNfc && !h.limiter.Allow("pos-nfc-tab:"+oc.user.ID, 30) {
		return nil, fail(429, "Terlalu banyak percobaan NFC Tab — tunggu sebentar")
	}
	if payGift && !h.limiter.Allow("pos-gift-card:"+oc.user.ID, 30) {
		return nil, fail(429, "Terlalu banyak percobaan gift card — tunggu sebentar")
	}
	if rej := domain.GuardBalancePayment(domain.BalancePaymentInput{
		PaymentMethod: method, NfcTabUID: nfcUID, GiftCardCode: giftCode, ArkUsed: ark,
		VenueCompanyID: company, VenueBranchID: branch, SellsGiftCard: len(oc.giftNominals) > 0,
	}); rej != nil {
		return nil, fail(rej.Status, rej.Message)
	}
	if method == "qris" {
		qrID, extID := domain.SanitizeXenditRef(req.Str("xendit_qr_id")), domain.SanitizeXenditRef(req.Str("xendit_external_id"))
		used := false
		if qrID != "" || extID != "" {
			col, val := "xendit_qr_id", qrID
			if qrID == "" {
				col, val = "xendit_external_id", extID
			}
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pos.pos_orders WHERE payment_status = 'paid' AND `+col+` = $1)`, val).Scan(&used); err != nil {
				return nil, err
			}
		}
		if msg := domain.AssertQrisSaleMaySettle(method, qrID, extID, used); msg != "" {
			return nil, fail(400, msg)
		}
	}
	if r := focCheck(); r != nil {
		return nil, r
	}
	approver := *approverRef
	if rej := domain.GuardSettlement(method, approver != nil, paid, ark, total, customerID); rej != nil {
		return nil, fail(rej.Status, rej.Message)
	}
	compType, rej := domain.GuardCompRequest(req.Get("comp_type"), customerID, total)
	if rej != nil {
		return nil, fail(rej.Status, rej.Message)
	}
	if compType != "" && customerID != "" {
		msg, err := h.p.Loyalty.ValidateKolComp(ctx, tx, customerID, subtotal)
		if err != nil {
			return nil, err
		}
		if msg != "" {
			return nil, fail(403, msg)
		}
	}
	payWithArk := ark > 0 && customerID != ""
	deferPaid := payWithArk || isNfc || payGift

	claims, status, merchReason, err := h.p.Merchandise.Claim(ctx, tx, merchLines(req.Items))
	if err != nil {
		return nil, err
	}
	if merchReason != "" {
		return nil, fail(status, merchReason)
	}
	claimed := map[string]bool{}
	for _, c := range claims {
		claimed[c.ProductID] = true
	}

	order, err := h.insertSingleOrder(ctx, tx, singleOrderRow{
		presetID: presetOrderID, orderNumber: orderNumber, queueNumber: queueNumber, req: req, deferPaid: deferPaid,
		company: company, branch: branch, warehouse: oc.sellWarehouse, customerID: customerID, cashierID: oc.cashierID,
		subtotal: subtotal, discount: discount, reason: reason, manualType: manualType, manualValue: manualValue,
		tax: tax, service: service, other: other, total: total, paid: paid, ark: ark, method: method,
		soldFrom: oc.soldFrom, compType: compType, approver: approver,
	})
	if err != nil {
		return nil, fail(500, kit.ErrorMessage(err))
	}
	if approver != nil {
		if err := publish(ctx, tx, possales.TopicCompApproved, order.Str("id"), possales.CompApproved{
			CompType: domain.FocComp, OrderNumber: orderNumber, GrossIdr: subtotal, ApprovedName: &approver.Name, CustomerID: strPtr(customerID),
		}); err != nil {
			return nil, err
		}
	}
	return h.settleAndComplete(ctx, tx, placedOrder{
		oc: oc, order: order, orderNumber: orderNumber, queueNumber: queueNumber, company: company, branch: branch,
		total: total, ark: ark, payWithArk: payWithArk, deferPaid: deferPaid, nfcUID: nfcUID, giftCode: giftCode,
		promoOrderID: promoOrderID, offerOrderID: map[bool]string{true: presetOrderID}[hasOffers],
		lineResults: stack.LineResults, isFoc: approver != nil, claimed: claimed,
	})
}

// rpcText runs a text-returning DB function.
func rpcText(ctx context.Context, q database.Querier, sql string, args ...any) (string, error) {
	var v *string
	err := savepointQuery(ctx, q, func(q database.Querier) error { return q.QueryRow(ctx, sql, args...).Scan(&v) })
	return deref(v), err
}

type singleOrderRow struct {
	presetID, orderNumber, queueNumber string
	req                                orderReq
	deferPaid                          bool
	company, branch, warehouse         string
	customerID, cashierID              string
	subtotal, discount                 float64
	reason, manualType                 string
	manualValue                        *float64
	tax, service, other, total         float64
	paid, ark                          float64
	method, soldFrom, compType         string
	approver                           *Approver
}

// insertSingleOrder is buildOrderInsertRows(...).row inserted with RETURNING *.
func (h *Handler) insertSingleOrder(ctx context.Context, tx pgx.Tx, in singleOrderRow) (*jsrow.Row, error) {
	req := in.req
	paymentStatus := "paid"
	if in.deferPaid {
		paymentStatus = "unpaid"
	}
	charges, ok := req.Get("charges_breakdown").([]any)
	if !ok {
		charges = []any{}
	}
	chargesJSON, _ := jsrow.Marshal(charges)
	stamp := domain.ResolvePaymentCatalogStamp(req.Str("payment_method_code"), req.Str("payment_method_name"))
	discount, reason, tax, service, other, total, amountPaid := in.discount, nilIfEmpty(in.reason), in.tax, in.service, in.other, in.total, in.paid
	change := domain.ChangeAmount(in.paid, in.ark, in.total)
	compType := nilIfEmpty(in.compType)
	var approvedBy, approvedName any
	if in.approver != nil {
		discount, reason, tax, service, other, total, amountPaid, change = in.subtotal, "FOC", 0, 0, 0, 0, 0, 0
		compType, approvedBy, approvedName = domain.FocComp, in.approver.ID, in.approver.Name
	}
	id := any(nil)
	if in.presetID != "" {
		id = in.presetID
	}
	return jsrow.QueryOne(ctx, tx, `INSERT INTO "pos"."pos_orders" (
		"id", "order_number", "queue_number", "order_type", "status", "payment_status", "company_id", "branch_id", "warehouse_id",
		"customer_id", "cashier_id", "server_id", "table_id", "guest_count", "shift_id", "subtotal", "discount_amount",
		"discount_reason", "tax_amount", "service_charge_amount", "other_charges_amount", "charges_breakdown", "total_amount",
		"amount_paid", "change_amount", "payment_method", "ark_coins_used", "notes", "special_requests", "ordered_at",
		"manual_discount_type", "manual_discount_value", "sold_from", "xendit_qr_id", "xendit_external_id",
		"payment_method_code", "payment_method_name", "comp_type", "comp_approved_by", "comp_approved_name")
		VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3, $4, 'pending', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
		$17, $18, $19, $20, $21::jsonb, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39)
		RETURNING *`,
		id, in.orderNumber, nilIfEmpty(in.queueNumber), jsonScalar(req.Get("order_type")), paymentStatus,
		nilIfEmpty(in.company), nilIfEmpty(in.branch), in.warehouse, nilIfEmpty(in.customerID), in.cashierID,
		truthyScalar(req.Get("server_id")), truthyScalar(req.Get("table_id")), domain.NormalizeGuestCount(req.Get("guest_count")),
		truthyScalar(req.Get("shift_id")), in.subtotal, discount, reason, tax, service, other, string(chargesJSON), total,
		amountPaid, change, in.method, in.ark, truthyScalar(req.Get("notes")), truthyScalar(req.Get("special_requests")), h.clock(),
		nilIfEmpty(in.manualType), in.manualValue, in.soldFrom,
		nilIfEmpty(domain.SanitizeXenditRef(req.Str("xendit_qr_id"))), nilIfEmpty(domain.SanitizeXenditRef(req.Str("xendit_external_id"))),
		nilIfEmpty(stamp.Code), nilIfEmpty(stamp.Name), compType, approvedBy, approvedName)
}

// truthyScalar is `x || null`.
func truthyScalar(v any) any {
	if !domain.Truthy(v) {
		return nil
	}
	return jsonScalar(v)
}

type placedOrder struct {
	oc                         orderCtx
	order                      *jsrow.Row
	orderNumber, queueNumber   string
	company, branch            string
	total, ark                 float64
	payWithArk, deferPaid      bool
	nfcUID, giftCode           string
	promoOrderID, offerOrderID string
	lineResults                []domain.LineResult
	isFoc                      bool
	claimed                    map[string]bool
}

func markPaid(ctx context.Context, tx pgx.Tx, orderID string, alsoTouch bool) error {
	sql := `UPDATE pos.pos_orders SET payment_status = 'paid' WHERE id = $1`
	if alsoTouch {
		sql = `UPDATE pos.pos_orders SET payment_status = 'paid', updated_at = now() WHERE id = $1`
	}
	_, err := tx.Exec(ctx, sql, orderID)
	return err
}

// settleAndComplete settles balance tenders, saves the lines and runs the
// follow-ups (kitchen, stats, XP, gift cards, journal, promo capture).
func (h *Handler) settleAndComplete(ctx context.Context, tx pgx.Tx, p placedOrder) (*response, error) {
	req := p.oc.req
	orderID := p.order.Str("id")
	userID := p.oc.user.ID
	if req.Str("payment_method") == "nfc_tab" {
		out, err := h.p.Tabs.Charge(ctx, tx, ports.TabCharge{
			OrderID: orderID, OrderNumber: p.orderNumber, Amount: p.total, BandUID: p.nfcUID,
			CompanyID: p.company, BranchID: p.branch, CreatedBy: userID,
		})
		if err != nil {
			return nil, err
		}
		if !out.OK {
			h.log.Error("[pos] nfc_tab charge rejected", "order", orderID, "user", userID, "reason", out.Reason)
			status := out.Status
			if status == 402 {
				status = 400
			}
			return nil, fail(status, out.Reason)
		}
		if err := markPaid(ctx, tx, orderID, true); err != nil {
			return nil, err
		}
	}
	if req.Str("payment_method") == "gift_card" {
		out, err := h.p.GiftCards.Redeem(ctx, tx, ports.GiftRedeem{
			Scope: ports.GiftScope{CompanyID: p.company, BranchID: p.branch}, Code: p.giftCode, Amount: p.total, OrderID: orderID, CreatedBy: userID,
		})
		if err != nil {
			return nil, err
		}
		if !out.OK {
			h.log.Error("[pos] gift_card debit rejected", "order", orderID, "user", userID, "reason", out.Reason)
			status := 400
			if out.Status == 409 || out.Status == 404 {
				status = out.Status
			}
			return nil, fail(status, out.Reason)
		}
		if err := markPaid(ctx, tx, orderID, false); err != nil {
			return nil, err
		}
	}
	var arkAfter *float64
	if p.payWithArk {
		bal, err := h.p.Wallet.Move(ctx, tx, ports.ArkMove{CustomerID: req.Str("customer_id"), Amount: -p.ark, Type: "payment", OrderID: orderID})
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
		if err := markPaid(ctx, tx, orderID, false); err != nil {
			return nil, err
		}
	}

	ids := productIDs(req.Items, true)
	cost, err := h.p.Catalog.CostPrices(ctx, tx, ids)
	if err != nil {
		return nil, err
	}
	skuRows := make([]*jsrow.Row, len(req.Items))
	for i, it := range req.Items {
		skuRows[i] = jsrow.Object("product_id", jsonScalar(it.Get("product_id")), "product_sku", jsonScalar(it.Get("product_sku")))
	}
	skuByProduct := map[string]any{}
	for _, r := range h.resolveItemSkus(ctx, tx, skuRows) {
		skuByProduct[domain.String(r.Get("product_id"))] = r.Get("product_sku")
	}
	items := buildOrderItemRows(orderID, req.Items, p.lineResults, cost, skuByProduct, p.claimed)
	if err := insertOrderItems(ctx, tx, items); err != nil {
		return nil, fail(500, kit.ErrorMessage(err))
	}
	note := "Order created and paid from cashier"
	if p.deferPaid {
		note = "Order created from cashier"
	}
	bestEffort(ctx, tx, `INSERT INTO pos.pos_order_status_history (order_id, from_status, to_status, changed_by, notes) VALUES ($1, NULL, 'pending', $2, $3)`,
		orderID, p.oc.cashierID, note)
	h.insertPrintJobs(ctx, tx, h.printOrder(p.order, p.queueNumber), items)

	settled := p.total
	if p.isFoc {
		settled = 0
	}
	customerID := req.Str("customer_id")
	method := req.Str("payment_method")
	award, err := h.p.Loyalty.AwardOrderXP(ctx, tx, ports.OrderXP{
		OrderID: orderID, CustomerID: customerID, TotalAmount: settled, Items: xpItems(items), OutletID: strPtr(p.branch), PaymentMethod: method,
	})
	if err != nil {
		return nil, err
	}
	var xpTotal *float64
	if customerID != "" {
		if xpTotal, err = h.p.Loyalty.TotalXP(ctx, tx, customerID); err != nil {
			return nil, err
		}
	}
	event := saleCompleted(orderID, customerID, settled, method, p.branch, userID, items)
	if customerID != "" {
		event.StatsAmount = &settled
	}
	if err := publish(ctx, tx, possales.TopicSaleCompleted, orderID, event); err != nil {
		return nil, err
	}

	sells := len(p.oc.giftNominals) > 0
	var cards []ports.IssuedGiftCard
	var giftErr any
	if sells {
		buyerName := strPtr(domain.Trim(req.Str("gift_card_buyer_name")))
		buyerPhone := domain.Trim(req.Str("gift_card_buyer_phone"))
		err := savepointExec(ctx, tx, func(q database.Querier) error {
			var err error
			cards, err = h.p.GiftCards.Issue(ctx, q, ports.GiftIssue{
				Scope: ports.GiftScope{CompanyID: p.company, BranchID: p.branch}, OrderID: orderID, Nominals: p.oc.giftNominals,
				BuyerName: buyerName, BuyerPhone: strPtr(buyerPhone), CreatedBy: userID,
			})
			return err
		})
		if err != nil {
			h.log.Error("[pos] gift card issue failed", "order", orderID, "error", err)
			cards = nil
			giftErr = "Order LUNAS tapi kartu gagal terbit — catat nomor order dan hubungi admin"
		}
		if len(cards) > 0 && buyerPhone != "" {
			if err := publish(ctx, tx, possales.TopicGiftCardsSold, orderID, giftCardsSold(orderID, buyerName, buyerPhone, cards)); err != nil {
				return nil, err
			}
		}
	}

	if err := publish(ctx, tx, possales.TopicSaleSettled, orderID, possales.SaleSettled{OrderID: orderID, UserID: userID, PaymentMethod: &method}); err != nil {
		return nil, err
	}
	if p.promoOrderID != "" {
		if err := savepointExec(ctx, tx, func(q database.Querier) error {
			return h.p.Offers.CapturePromo(ctx, q, offers.ContextPosOrder, p.promoOrderID)
		}); err != nil {
			h.log.Error("[pos] capture promo error", "error", err)
		}
	}
	if p.offerOrderID != "" {
		if err := savepointExec(ctx, tx, func(q database.Querier) error { return h.p.Offers.CaptureUsage(ctx, q, p.offerOrderID) }); err != nil {
			h.log.Error("[pos] capture offer usage error", "error", err)
		}
	}
	complete, err := jsrow.QueryOne(ctx, tx, `SELECT *, `+embedCustomer+`, `+embedItems+` FROM "pos"."pos_orders" WHERE "id" = $1`, orderID)
	if err != nil {
		return nil, err
	}
	body := jsrow.Object("success", true, "data", complete, "crm_xp", award, "ark_balance_after", arkAfter, "xp_total_after", xpTotal)
	if sells {
		if cards == nil {
			cards = []ports.IssuedGiftCard{}
		}
		body.Set("gift_cards", cards)
		body.Set("gift_card_error", giftErr)
	}
	return &response{status: 201, body: body}, nil
}

func giftCardsSold(orderID string, buyerName *string, phone string, cards []ports.IssuedGiftCard) possales.GiftCardsSold {
	out := possales.GiftCardsSold{OrderID: orderID, BuyerName: buyerName, BuyerPhone: phone}
	for _, c := range cards {
		var exp *string
		var s string
		if json.Unmarshal(c.ExpiresAt, &s) == nil {
			exp = &s
		}
		out.Cards = append(out.Cards, possales.SoldGiftCard{ID: c.ID, Code: c.Code, InitialValue: c.InitialValue, ExpiresAt: exp})
	}
	return out
}

// buildOrderItemRows is buildOrderItemRows (columns in the TS order).
func buildOrderItemRows(orderID string, items []domain.Obj, lines []domain.LineResult, cost map[string]float64, skuByProduct map[string]any, claimed map[string]bool) []*jsrow.Row {
	out := make([]*jsrow.Row, len(items))
	for i, it := range items {
		qty := domain.ItemQuantity(it)
		unit := domain.ItemUnitPrice(it)
		sub := unit * qty
		lineTotal, lineDiscount := sub, 0.0
		if i < len(lines) {
			lineTotal, lineDiscount = lines[i].TotalAmount, lines[i].DiscountAmount
		}
		pid := it.Get("product_id")
		sku := skuByProduct[domain.String(pid)]
		skuStr := domain.StrOr(sku, domain.StrOr(it.Get("product_sku"), domain.StrOr(pid, "")))
		snap := domain.BuildCostSnapshot(cost[domain.String(pid)], qty, lineTotal)
		var variants, modifiers any = []any{}, []any{}
		if domain.Truthy(it.Get("variants")) {
			variants = it.Get("variants")
		}
		if domain.Truthy(it.Get("modifiers")) {
			modifiers = it.Get("modifiers")
		}
		var discValue any
		if v := domain.ParseNullableNumber(it.Get("discount_value")); v != nil {
			discValue = *v
		}
		out[i] = jsrow.Object(
			"order_id", orderID,
			"product_id", jsonScalar(pid),
			"sku_id", truthyScalar(it.Get("sku_id")),
			"product_name", domain.StrOr(it.Get("product_name"), "Unknown"),
			"product_sku", truncate50(skuStr),
			"variants", variants,
			"modifiers", modifiers,
			"quantity", qty,
			"unit_price", unit,
			"subtotal", sub,
			"discount_type", nilIfEmpty(domain.ParseDiscountType(it.Get("discount_type"))),
			"discount_value", discValue,
			"discount_amount", lineDiscount,
			"total_amount", lineTotal,
			"xp_earned", 0,
			"station", normalizeStation(it.Get("station"), domain.StrOr(it.Get("product_name"), ""), ""),
			"kitchen_status", "pending",
			"inventory_deducted", domain.Truthy(pid) && claimed[domain.String(pid)],
			"cost_price", snap.CostPrice,
			"cost_total", snap.CostTotal,
			"gross_profit", snap.GrossProfit,
			"gross_margin_pct", snap.GrossMarginPct,
		)
	}
	return out
}

// insertOrderItems writes rows built by buildOrderItemRows.
func insertOrderItems(ctx context.Context, q database.Querier, rows []*jsrow.Row) error {
	for _, r := range rows {
		v, _ := jsrow.Marshal(r.Get("variants"))
		m, _ := jsrow.Marshal(r.Get("modifiers"))
		if _, err := q.Exec(ctx, `INSERT INTO pos.pos_order_items (order_id, product_id, sku_id, product_name, product_sku, variants, modifiers,
			quantity, unit_price, subtotal, discount_type, discount_value, discount_amount, total_amount, xp_earned, station, kitchen_status,
			inventory_deducted, cost_price, cost_total, gross_profit, gross_margin_pct)
			VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, 0, $15, 'pending', $16, $17, $18, $19, $20)`,
			r.Get("order_id"), r.Get("product_id"), r.Get("sku_id"), r.Get("product_name"), r.Get("product_sku"), string(v), string(m),
			r.Get("quantity"), r.Get("unit_price"), r.Get("subtotal"), r.Get("discount_type"), r.Get("discount_value"), r.Get("discount_amount"),
			r.Get("total_amount"), r.Get("station"), r.Get("inventory_deducted"), r.Get("cost_price"), r.Get("cost_total"),
			r.Get("gross_profit"), r.Get("gross_margin_pct")); err != nil {
			return err
		}
	}
	return nil
}
