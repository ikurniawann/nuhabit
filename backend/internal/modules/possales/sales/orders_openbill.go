package sales

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/modules/possales/offers"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/scope"
)

// openBill is POST /api/pos/orders/open-bill: an unpaid bill (stall order or
// central checkout) that the kitchen can already see.
func (h *Handler) openBill(w http.ResponseWriter, r *http.Request) error {
	user, err := kit.PosUser(h.auth, r)
	if err != nil {
		return err
	}
	res, err := h.openBillUseCase(r, user)
	return h.writeOutcome(w, res, err, "Open bill error")
}

func (h *Handler) openBillUseCase(r *http.Request, user *auth.User) (*response, error) {
	ctx := r.Context()
	body, err := readObj(r)
	if err != nil {
		return nil, err
	}
	req := withOpenBillDefaults(body)
	if !req.itemsIsNonEmptyArray() {
		return nil, fail(400, "Items are required")
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
	guard := domain.GuardMixedCheckoutCart(ids, warehouses, canMixed, false, req.Str("promo_code"))
	if guard.Message != "" {
		return nil, fail(400, guard.Message)
	}
	soldFrom := domain.SoldFrom(gate.HasCentralMenu && gate.CanCentralCheckout)
	reuse := domain.ShouldReuseUnpaidOpenBillCheckout(body.Get("reuse_unpaid_checkout"))
	tableID := req.Str("table_id")
	tableUnpaid := ""
	if reuse && soldFrom == "central" && tableID != "" {
		sql := `SELECT "id" FROM "pos"."pos_checkouts" WHERE "table_id" = $1 AND "payment_status" <> $2`
		args := []any{tableID, "paid"}
		if !sc.Unscoped {
			if c := deref(sc.CompanyID); c != "" {
				args = append(args, c)
				sql += ` AND "company_id" = $` + itoa(len(args))
			}
			if b := deref(sc.BranchID); b != "" {
				args = append(args, b)
				sql += ` AND "branch_id" = $` + itoa(len(args))
			}
		}
		if row, err := jsrow.QueryOne(ctx, h.db, sql+` ORDER BY "created_at" DESC LIMIT 1`, args...); err == nil && row != nil {
			tableUnpaid = row.Str("id")
		}
	}
	unpaidCheckout := domain.ResolveUnpaidCheckoutForOpenBill(reuse, req.Str("checkout_id"), tableUnpaid)
	kind := domain.SaleStall
	switch {
	case guard.CreateCheckout:
		kind = domain.SaleCentralMixed
	case soldFrom == "central":
		kind = domain.SaleCentralSingle
	}
	customerID := req.Str("customer_id")
	target := domain.ResolveTableSaleTarget(kind, unpaidCheckout)
	if target == domain.TargetCreateCheckout || target == domain.TargetAppendCheckout {
		allowed, msg, err := h.p.Loyalty.CheckProductPrivileges(ctx, h.db, ids, customerID)
		if err != nil {
			return nil, err
		}
		if !allowed {
			return nil, fail(403, msg)
		}
		in := mixedInput{
			MixedSaleInput: domain.MixedSaleInput{
				Items: req.Items, WarehouseByProduct: warehouses, OrderType: req.Str("order_type"), CustomerID: customerID,
				CashierID: firstStr(req.Str("cashier_id"), user.ID), ServerID: req.Str("server_id"), TableID: tableID,
				GuestCount: req.Get("guest_count"), DiscountAmount: req.Get("discount_amount"), DiscountReason: req.Str("discount_reason"),
				PromoCode: req.Str("promo_code"), TaxAmount: req.Get("tax_amount"), ServiceChargeAmount: req.Get("service_charge_amount"),
				OtherChargesAmount: req.Get("other_charges_amount"), ChargesBreakdown: req.Get("charges_breakdown"),
				PaymentMethod: "cash", PaymentStatus: "unpaid", AmountPaid: jsonZero,
				Notes: req.Str("notes"), SpecialRequests: req.Str("special_requests"), SessionUserID: user.ID,
				ForceInsertChildren: true, ReuseUnpaidTableCheckout: reuse && (tableID != "" || unpaidCheckout != ""),
				ExistingCheckoutID: unpaidCheckout,
			},
			ShiftID: req.Str("shift_id"),
		}
		in.CompanyID, in.BranchID = deref(sc.CompanyID), deref(sc.BranchID)
		var res mixedResult
		err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
			var err error
			res, err = h.createMixedCheckout(ctx, tx, in)
			return err
		})
		if err != nil {
			return nil, err
		}
		id := res.CheckoutID
		if len(res.OrderIDs) > 0 {
			id = res.OrderIDs[0]
		}
		return &response{status: 201, body: jsrow.Object(
			"success", true,
			"data", jsrow.Object("id", id, "checkout_id", res.CheckoutID, "checkout_number", res.CheckoutNumber,
				"queue_number", res.QueueNumber, "order_ids", nonNil(res.OrderIDs), "table_id", nilIfEmpty(tableID)),
			"message", "Open bill created successfully",
		)}, nil
	}

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
	allowed, pmsg, err := h.p.Loyalty.CheckProductPrivileges(ctx, h.db, productIDs(req.Items, false), customerID)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, fail(403, pmsg)
	}
	var res *response
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		var err error
		res, err = h.placeOpenBill(ctx, tx, user, req, sellWarehouse, soldFrom)
		return err
	})
	return res, err
}

// withOpenBillDefaults applies the destructuring defaults of the route.
func withOpenBillDefaults(body map[string]any) orderReq {
	defaults := map[string]any{
		"order_type": "dine_in", "manual_discount_type": nil, "manual_discount_value": nil,
		"tax_amount": jsonZero, "service_charge_amount": jsonZero, "other_charges_amount": jsonZero, "charges_breakdown": []any{},
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
	} else if !o.Has("items") {
		o["items"] = []any{}
	}
	return req
}

func (h *Handler) placeOpenBill(ctx context.Context, tx pgx.Tx, user *auth.User, req orderReq, sellWarehouse, soldFrom string) (*response, error) {
	company, branch := h.p.Directory.Venue(ctx, tx)
	orderNumber, err := rpcText(ctx, tx, `SELECT * FROM "generate_order_number"()`)
	if err != nil {
		h.log.Error("Order number generation error", "error", err)
		return nil, fail(500, "Failed to generate order number")
	}
	queue := h.allocateQueueNumber(ctx, tx, company, branch)
	customerID := req.Str("customer_id")
	cart := make([]offers.CartLine, len(req.Items))
	lines := make([]domain.LineInput, len(req.Items))
	for i, it := range req.Items {
		cart[i] = offers.CartLine{ProductID: it.Str("product_id"), Quantity: domain.ItemQuantity(it), UnitPrice: domain.ItemUnitPrice(it)}
		lines[i] = domain.LineInput{LineSubtotal: domain.ItemLineSubtotal(it), DiscountType: domain.ParseDiscountType(it.Get("discount_type")), DiscountValue: domain.ParseNullableNumber(it.Get("discount_value"))}
	}
	code := ""
	if req.Truthy("promo_code") {
		code = req.Str("promo_code")
	}
	eval, err := h.p.Offers.EvaluateForPosCart(ctx, tx, strPtr(company), strPtr(branch), cart, code, customerID)
	if err != nil {
		return nil, err
	}
	membershipPct := req.NumOr0("membership_discount_pct")
	manualType := domain.ParseDiscountType(req.Get("manual_discount_type"))
	manualValue := domain.ParseNullableNumber(req.Get("manual_discount_value"))
	stack := domain.ComputeDiscountStack(domain.StackInput{
		Items:         lines,
		OfferDiscount: domain.ResolveOpenBillOfferDiscount(req.Get("offer_discount"), eval.OfferDiscount),
		MembershipPct: membershipPct,
		PromoDiscount: maxf(0, req.NumOr0("promo_discount")),
		ManualType:    manualType, ManualValue: manualValue,
	})
	labels := make([]string, len(eval.Applied))
	for i, a := range eval.Applied {
		labels[i] = a.Name
	}
	reason := domain.BuildDiscountReason(domain.DiscountReasonInput{
		HasItemDiscounts: stack.LineDiscountTotal > 0, OfferLabels: labels, MembershipPct: membershipPct,
		PromoCode: code, ManualType: manualType, ManualValue: manualValue,
	})
	tax, service, other := req.NumOr0("tax_amount"), req.NumOr0("service_charge_amount"), req.NumOr0("other_charges_amount")
	charges, ok := req.Get("charges_breakdown").([]any)
	if !ok {
		charges = []any{}
	}
	chargesJSON, _ := jsrow.Marshal(charges)
	var discountReason any = nilIfEmpty(reason)
	if reason == "" {
		discountReason = truthyScalar(req.Get("discount_reason"))
	}
	cashier := firstStr(req.Str("cashier_id"), user.ID)
	order, err := jsrow.QueryOne(ctx, tx, `INSERT INTO "pos"."pos_orders" ("order_number", "queue_number", "order_type", "status", "payment_status",
		"company_id", "branch_id", "warehouse_id", "checkout_id", "sold_from", "customer_id", "cashier_id", "server_id", "table_id",
		"guest_count", "shift_id", "subtotal", "discount_amount", "discount_reason", "manual_discount_type", "manual_discount_value",
		"tax_amount", "service_charge_amount", "other_charges_amount", "charges_breakdown", "total_amount", "payment_method",
		"amount_paid", "notes", "special_requests", "ark_coins_used", "ordered_at")
		VALUES ($1, $2, $3, 'pending', 'unpaid', $4, $5, $6, NULL, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
		$19, $20, $21, $22::jsonb, $23, NULL, 0, $24, $25, 0, $26) RETURNING *`,
		orderNumber, nilIfEmpty(queue), jsonScalar(req.Get("order_type")), nilIfEmpty(company), nilIfEmpty(branch), sellWarehouse, soldFrom,
		truthyScalar(req.Get("customer_id")), cashier, truthyScalar(req.Get("server_id")), truthyScalar(req.Get("table_id")),
		domain.NormalizeGuestCount(req.Get("guest_count")), truthyScalar(req.Get("shift_id")), stack.GrossSubtotal, stack.DiscountAmount,
		discountReason, nilIfEmpty(manualType), manualValue, tax, service, other, string(chargesJSON),
		stack.AfterDiscount+tax+service+other, truthyScalar(req.Get("notes")), truthyScalar(req.Get("special_requests")), h.clock())
	if err != nil {
		h.log.Error("Open bill insert error", "error", err)
		return nil, fail(500, kit.ErrorMessage(err))
	}
	orderID := order.Str("id")
	if len(eval.Applied) > 0 {
		if err := savepointExec(ctx, tx, func(q database.Querier) error {
			return h.p.Offers.RecordUsage(ctx, q, offers.UsageInput{
				CompanyID: strPtr(company), BranchID: strPtr(branch), OrderID: orderID, CustomerID: customerID,
				Applied: eval.Applied, Status: "captured", Enforce: false,
			})
		}); err != nil {
			h.log.Error("[open-bill] record offer usage error", "error", err)
		}
	}
	if tableID := req.Str("table_id"); req.Truthy("table_id") {
		bestEffort(ctx, tx, `UPDATE pos.pos_orders SET pre_settled_at = NULL, updated_at = $2
			WHERE table_id = $1 AND status IN ('pending', 'confirmed', 'preparing', 'ready', 'served') AND pre_settled_at IS NOT NULL`, tableID, h.clock())
	}
	cost, err := h.p.Catalog.CostPrices(ctx, tx, productIDs(req.Items, true))
	if err != nil {
		return nil, err
	}
	var inserted []*jsrow.Row
	for i, it := range req.Items {
		qty := domain.ItemQuantity(it)
		unit := domain.ItemUnitPrice(it)
		sub := unit * qty
		line := stack.LineResults[i]
		name := domain.StrOr(it.Get("product_name"), "Unknown")
		notes := domain.StrOr(it.Get("kitchen_notes"), domain.StrOr(it.Get("notes"), ""))
		snap := domain.BuildCostSnapshot(cost[it.Str("product_id")], qty, line.TotalAmount)
		var discValue any
		if v := domain.ParseNullableNumber(it.Get("discount_value")); v != nil {
			discValue = *v
		}
		row, err := jsrow.QueryOne(ctx, tx, `INSERT INTO pos.pos_order_items (order_id, product_id, product_name, product_sku, variants, modifiers,
			quantity, unit_price, subtotal, discount_type, discount_value, discount_amount, total_amount, station, kitchen_status, kitchen_notes,
			cost_price, cost_total, gross_profit, gross_margin_pct)
			VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, 'pending', $15, $16, $17, $18, $19)
			RETURNING id, product_id, product_name, product_sku, variants, modifiers, quantity, unit_price, total_amount, station, kitchen_notes`,
			orderID, jsonScalar(it.Get("product_id")), name, truncate50(domain.StrOr(it.Get("product_sku"), domain.StrOr(it.Get("product_id"), ""))),
			jsonOrEmptyArray(it.Get("variants")), jsonOrEmptyArray(it.Get("modifiers")), qty, unit, sub,
			nilIfEmpty(domain.ParseDiscountType(it.Get("discount_type"))), discValue, line.DiscountAmount, line.TotalAmount,
			normalizeStation(it.Get("station"), name, notes), nilIfEmpty(notes),
			snap.CostPrice, snap.CostTotal, snap.GrossProfit, snap.GrossMarginPct)
		if err != nil {
			h.log.Error("Open bill items error", "error", err)
			return nil, fail(500, kit.ErrorMessage(err))
		}
		inserted = append(inserted, row)
	}
	h.insertPrintJobs(ctx, tx, h.printOrder(order, order.Str("queue_number")), inserted)
	bestEffort(ctx, tx, `INSERT INTO pos.pos_order_status_history (order_id, from_status, to_status, changed_by, notes)
		VALUES ($1, NULL, 'pending', $2, 'Open bill created from cashier')`, orderID, cashier)
	return &response{status: 201, body: jsrow.Object("success", true, "data", order, "message", "Open bill created successfully")}, nil
}

func maxf(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
