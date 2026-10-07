package sales

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/database"
)

// mixedInput is CreateMixedCheckoutInput.
type mixedInput struct {
	domain.MixedSaleInput
	CompanyID, BranchID, ShiftID         string
	PaymentMethodCode, PaymentMethodName string
	CompType                             string
	CompApproved                         *Approver
}

// mixedResult is MixedCheckoutResult.
type mixedResult struct {
	CheckoutID, CheckoutNumber, QueueNumber string
	OrderIDs                                []string
	ArkBalanceAfter                         *float64
	XPAwarded                               float64
	XPTotalAfter                            *float64
}

// checkoutRow is CheckoutRow.
type checkoutRow struct {
	ID, CheckoutNumber, QueueNumber, PaymentStatus, PaymentMethod string
	CompanyID, BranchID, TableID, CustomerID, CashierID, ShiftID  *string
	DiscountAmount, TaxAmount, ServiceChargeAmount                float64
	OtherChargesAmount, TotalAmount, AmountPaid, ChangeAmount     float64
	Notes                                                         *string
	Snapshot                                                      map[string]any
	XenditQRID, XenditExternalID                                  string
}

const checkoutBaseColumns = `id, checkout_number, queue_number, payment_status, payment_method,
              company_id, branch_id, table_id, customer_id, cashier_id, shift_id,
              subtotal, discount_amount, tax_amount, service_charge_amount,
              other_charges_amount, total_amount, amount_paid, change_amount,
              notes`

func checkoutFromRow(r *jsrow.Row) *checkoutRow {
	c := &checkoutRow{
		ID: r.Str("id"), CheckoutNumber: r.Str("checkout_number"), QueueNumber: r.Str("queue_number"),
		PaymentStatus: r.Str("payment_status"), PaymentMethod: r.Str("payment_method"),
		CompanyID: r.StrPtr("company_id"), BranchID: r.StrPtr("branch_id"), TableID: r.StrPtr("table_id"),
		CustomerID: r.StrPtr("customer_id"), CashierID: r.StrPtr("cashier_id"), ShiftID: r.StrPtr("shift_id"),
		DiscountAmount: r.Num("discount_amount"), TaxAmount: r.Num("tax_amount"),
		ServiceChargeAmount: r.Num("service_charge_amount"), OtherChargesAmount: r.Num("other_charges_amount"),
		TotalAmount: r.Num("total_amount"), AmountPaid: r.Num("amount_paid"), ChangeAmount: r.Num("change_amount"),
		Notes: r.StrPtr("notes"), XenditQRID: r.Str("xendit_qr_id"), XenditExternalID: r.Str("xendit_external_id"),
	}
	if raw := rawField(r, "cart_snapshot"); len(raw) > 0 {
		c.Snapshot = parseSnapshot(raw)
	}
	return c
}

// nextCheckoutNumber is CHK-YYYYMMDD-NNNN under an advisory lock.
func nextCheckoutNumber(ctx context.Context, tx pgx.Tx) (string, error) {
	var prefix string
	if err := tx.QueryRow(ctx, `SELECT 'CHK-' || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD') AS prefix`).Scan(&prefix); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "pos_checkout_number:"+prefix); err != nil {
		return "", err
	}
	var seq int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(CAST(SUBSTRING(checkout_number FROM LENGTH($1) + 2) AS integer)), 0) + 1 AS seq
		FROM pos.pos_checkouts WHERE checkout_number LIKE $1 || '-%'`, prefix).Scan(&seq); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s-%04d", prefix, seq), nil
}

func generateOrderNumber(ctx context.Context, q database.Querier) (string, error) {
	var v *string
	err := q.QueryRow(ctx, `SELECT generate_order_number() AS value`).Scan(&v)
	return deref(v), err
}

func generateQueueNumber(ctx context.Context, q database.Querier, companyID, branchID *string) (string, error) {
	var v *string
	err := q.QueryRow(ctx, `SELECT generate_queue_number($1, $2) AS value`, companyID, branchID).Scan(&v)
	return deref(v), err
}

// allocateQueueNumber is the rpc variant: failures are logged and yield "".
func (h *Handler) allocateQueueNumber(ctx context.Context, q database.Querier, companyID, branchID string) string {
	var v string
	err := savepointQuery(ctx, q, func(q database.Querier) error {
		var p *string
		err := q.QueryRow(ctx, `SELECT * FROM "generate_queue_number"("p_company_id" := $1, "p_branch_id" := $2)`, nilIfEmpty(companyID), nilIfEmpty(branchID)).Scan(&p)
		v = deref(p)
		return err
	})
	if err != nil {
		h.log.Error("[pos] generate_queue_number", "error", err)
		return ""
	}
	return v
}

func savepointQuery(ctx context.Context, q database.Querier, fn func(database.Querier) error) error {
	if b, ok := q.(database.TxBeginner); ok {
		return savepointExec(ctx, b, fn)
	}
	return fn(q)
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// stampPaymentCatalog writes the cashier's catalog method on the checkout
// and its children.
func stampPaymentCatalog(ctx context.Context, tx pgx.Tx, checkoutID string, orderIDs []string, code, name string) error {
	stamp := domain.ResolvePaymentCatalogStamp(code, name)
	if stamp.Code == "" && stamp.Name == "" {
		return nil
	}
	if checkoutID != "" {
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_checkouts
         SET payment_method_code = $2, payment_method_name = $3, updated_at = now()
         WHERE id = $1`, checkoutID, nilIfEmpty(stamp.Code), nilIfEmpty(stamp.Name)); err != nil {
			return err
		}
	}
	if len(orderIDs) > 0 {
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_orders
         SET payment_method_code = $2, payment_method_name = $3, updated_at = now()
         WHERE id = ANY($1::uuid[])`, orderIDs, nilIfEmpty(stamp.Code), nilIfEmpty(stamp.Name)); err != nil {
			return err
		}
	}
	return nil
}

// findUnpaidCheckout locks the unpaid, not cancelled checkout of a table
// (latest) or by id.
func findUnpaidCheckout(ctx context.Context, tx pgx.Tx, byTable bool, key, company, branch string) (*checkoutRow, error) {
	scoped, args := unpaidScopeSQL(company, branch, 2)
	col, tail := "id", "FOR UPDATE"
	if byTable {
		col, tail = "table_id", "ORDER BY created_at DESC\n       LIMIT 1\n       FOR UPDATE"
	}
	row, err := jsrow.QueryOne(ctx, tx, `SELECT `+checkoutBaseColumns+`, cart_snapshot
       FROM pos.pos_checkouts
       WHERE `+col+` = $1
         AND LOWER(payment_status::text) <> 'paid'
         AND COALESCE(notes, '') NOT ILIKE 'cancelled%'
         `+scoped+`
       `+tail, append([]any{key}, args...)...)
	if err != nil || row == nil {
		return nil, err
	}
	return checkoutFromRow(row), nil
}

// childOrder is ChildOrderRow.
type childOrder struct {
	OrderNumber, QueueNumber, OrderType, PaymentStatus, PaymentMethod string
	CompanyID, BranchID                                               *string
	WarehouseID, CheckoutID                                           string
	CustomerID                                                        *string
	CashierID                                                         string
	ServerID, TableID                                                 *string
	GuestCount                                                        int
	ShiftID                                                           *string
	Subtotal, Discount                                                float64
	DiscountReason                                                    *string
	Tax, ServiceCharge, OtherCharges, Total, AmountPaid, ChangeAmount float64
	Notes, SpecialRequests                                            *string
	OrderStatus                                                       string
	CompType, CompApprovedBy, CompApprovedName                        *string
}

func insertChildOrder(ctx context.Context, tx pgx.Tx, row childOrder, now time.Time) (string, error) {
	id := randomUUID()
	var completedAt *time.Time
	if row.OrderStatus == "completed" {
		completedAt = &now
	}
	_, err := tx.Exec(ctx, `INSERT INTO pos.pos_orders (
       id, order_number, queue_number, order_type, status, payment_status, payment_method,
       company_id, branch_id, warehouse_id, checkout_id, sold_from,
       customer_id, cashier_id, server_id, table_id, guest_count, shift_id,
       subtotal, discount_amount, discount_reason, tax_amount, service_charge_amount,
       other_charges_amount, charges_breakdown, total_amount, amount_paid, change_amount,
       notes, special_requests, ordered_at, completed_at, comp_type,
       comp_approved_by, comp_approved_name
     ) VALUES (
       $1,$2,$3,$4::pos_order_type,$28::pos_order_status,$5::pos_payment_status,$6::pos_payment_method,
       $7,$8,$9,$10,'central',
       $11,$12,$13,$14,$15,$16,
       $17,$18,$19,$20,$21,
       $22,'[]'::jsonb,$23,$24,$25,
       $26,$27, now(), $29, $30,
       $31, $32
     )`,
		id, row.OrderNumber, row.QueueNumber, row.OrderType, row.PaymentStatus, row.PaymentMethod,
		row.CompanyID, row.BranchID, row.WarehouseID, row.CheckoutID,
		row.CustomerID, row.CashierID, row.ServerID, row.TableID, row.GuestCount, row.ShiftID,
		row.Subtotal, row.Discount, row.DiscountReason, row.Tax, row.ServiceCharge,
		row.OtherCharges, row.Total, row.AmountPaid, row.ChangeAmount,
		row.Notes, row.SpecialRequests, row.OrderStatus, completedAt, row.CompType,
		row.CompApprovedBy, row.CompApprovedName)
	return id, err
}

// insertChildItems writes the lines of one child order.
func insertChildItems(ctx context.Context, tx pgx.Tx, orderID string, lines []domain.BuiltLine, cost map[string]float64, merchClaimed map[string]bool) error {
	for _, l := range lines {
		pid := l.ProductID()
		snap := domain.BuildCostSnapshot(cost[pid], l.Qty, l.LineTotal)
		discType := domain.ParseDiscountType(l.Item.Get("discount_type"))
		var discValue *float64
		if !domain.IsNullish(l.Item.Get("discount_value")) && l.Item.Get("discount_value") != "" {
			v := domain.ToNumber(l.Item.Get("discount_value"), 0)
			discValue = &v
		}
		station := normalizeStation(l.Item.Get("station"), domain.StrOr(l.Item.Get("product_name"), ""), "")
		sku := domain.StrOr(l.Item.Get("product_sku"), domain.StrOr(l.Item.Get("product_id"), ""))
		if _, err := tx.Exec(ctx, `INSERT INTO pos.pos_order_items (
         order_id, product_id, sku_id, product_name, product_sku, variants, modifiers,
         quantity, unit_price, subtotal, discount_type, discount_value, discount_amount,
         total_amount, xp_earned, station, kitchen_status, inventory_deducted,
         cost_price, cost_total, gross_profit, gross_margin_pct
       ) VALUES (
         $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,
         $8,$9,$10,$11,$12,$13,
         $14,0,$15,'pending',$16,
         $17,$18,$19,$20
       )`,
			orderID, nilIfEmpty(pid), nilIfEmpty(l.Item.Str("sku_id")), domain.StrOr(l.Item.Get("product_name"), "Unknown"),
			truncate50(sku), jsonOrEmptyArray(l.Item.Get("variants")), jsonOrEmptyArray(l.Item.Get("modifiers")),
			l.Qty, l.UnitPrice, l.LineSubtotal, nilIfEmpty(discType), discValue, l.LineDiscount,
			l.LineTotal, station, pid != "" && merchClaimed[pid],
			snap.CostPrice, snap.CostTotal, snap.GrossProfit, snap.GrossMarginPct); err != nil {
			return err
		}
	}
	return nil
}

// truncate50 is String(x).slice(0, 50) (UTF-16 units).
func truncate50(s string) string {
	n := 0
	for i, r := range s {
		w := 1
		if r > 0xFFFF {
			w = 2
		}
		if n+w > 50 {
			return s[:i]
		}
		n += w
	}
	return s
}

// jsonOrEmptyArray is JSON.stringify(x || []).
func jsonOrEmptyArray(v any) string {
	if !domain.Truthy(v) {
		return "[]"
	}
	b, _ := jsrow.Marshal(v)
	return string(b)
}

// normalizeStation is normalizeStation(station, name, notes) for a raw JSON station.
func normalizeStation(station any, name, notes string) string {
	s, _ := station.(string)
	return kdomainNormalize(s, name, notes)
}

func insertCreatedHistory(ctx context.Context, tx pgx.Tx, orderID, cashierID string, paid bool, orderStatus string) error {
	note := "Order created from central checkout"
	if paid {
		note = "Order created and paid from central checkout"
	}
	_, err := tx.Exec(ctx, `INSERT INTO pos.pos_order_status_history (order_id, from_status, to_status, changed_by, notes)
     VALUES ($1, NULL, $4, $2, $3)`, orderID, cashierID, note, orderStatus)
	return err
}

// insertChildren creates one child order per stall from the snapshot:
// charges pro rata subtotal, tender pro rata total, change on the first.
func (h *Handler) insertChildren(ctx context.Context, tx pgx.Tx, c *checkoutRow, snapshot map[string]any, isOpenBill bool, warehouseByProduct map[string]string, merchClaimed map[string]bool, cost map[string]float64, compType string, approver *Approver) ([]string, error) {
	slices := domain.SliceLinesByStall(domain.BuildLines(domain.SnapshotItems(snapshot), warehouseByProduct))
	if len(slices) < 2 {
		return nil, domain.Reject(domain.MsgMultiStallRequired)
	}
	alloc := domain.AllocateSliceCharges(slices, c.DiscountAmount, c.TaxAmount, c.ServiceChargeAmount, c.OtherChargesAmount)
	totals := make([]float64, len(alloc))
	for i, a := range alloc {
		totals[i] = a.Total
	}
	paid := domain.AllocateAmount(c.AmountPaid, totals)
	status := domain.ChildOrderStatus(c.PaymentStatus, isOpenBill)
	method := c.PaymentMethod
	if method == "" {
		method = "cash"
	}
	var ids []string
	for i, s := range slices {
		num, err := generateOrderNumber(ctx, tx)
		if err != nil {
			return nil, err
		}
		change := 0.0
		if i == 0 {
			change = c.ChangeAmount
		}
		row := childOrder{
			OrderNumber: num, QueueNumber: c.QueueNumber, OrderType: snapString(snapshot, "orderType"),
			PaymentStatus: c.PaymentStatus, PaymentMethod: method, CompanyID: c.CompanyID, BranchID: c.BranchID,
			WarehouseID: s.WarehouseID, CheckoutID: c.ID, CustomerID: c.CustomerID, CashierID: deref(c.CashierID),
			ServerID: snapPtr(snapshot, "serverId"), TableID: c.TableID, GuestCount: snapInt(snapshot, "guestCount"), ShiftID: c.ShiftID,
			Subtotal: s.Subtotal, Discount: alloc[i].Discount, DiscountReason: snapPtr(snapshot, "discountReason"),
			Tax: alloc[i].Tax, ServiceCharge: alloc[i].ServiceCharge, OtherCharges: alloc[i].OtherCharges, Total: alloc[i].Total,
			AmountPaid: paid[i], ChangeAmount: change, Notes: snapPtr(snapshot, "notes"), SpecialRequests: snapPtr(snapshot, "specialRequests"),
			OrderStatus: status, CompType: strPtr(compType),
		}
		if approver != nil {
			row.CompApprovedBy, row.CompApprovedName = &approver.ID, &approver.Name
		}
		id, err := insertChildOrder(ctx, tx, row, h.now())
		if err != nil {
			return nil, err
		}
		if err := insertChildItems(ctx, tx, id, s.Lines, cost, merchClaimed); err != nil {
			return nil, err
		}
		if err := insertCreatedHistory(ctx, tx, id, deref(c.CashierID), c.PaymentStatus == "paid", status); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// appendToCheckout adds open-bill items to an unpaid checkout: stalls that
// already have an active central child grow, new stalls get a new child.
func (h *Handler) appendToCheckout(ctx context.Context, tx pgx.Tx, existing *checkoutRow, plan domain.MixedSalePlan, merchClaimed map[string]bool, cost map[string]float64) (mixedResult, error) {
	slices := domain.SliceLinesByStall(plan.Lines)
	alloc := domain.AllocateSliceCharges(slices, plan.DiscountAmount, plan.TaxAmount, plan.ServiceChargeAmount, plan.OtherChargesAmount)
	children, err := jsrow.Query(ctx, tx, `SELECT id, warehouse_id FROM pos.pos_orders
     WHERE checkout_id = $1
       AND COALESCE(sold_from, 'stall') = 'central'
       AND status::text NOT IN ('completed', 'cancelled', 'voided', 'merged')
       AND LOWER(payment_status::text) <> 'paid'`, existing.ID)
	if err != nil {
		return mixedResult{}, err
	}
	existingChildren := make([]domain.AppendChild, len(children))
	for i, c := range children {
		existingChildren[i] = domain.AppendChild{OrderID: c.Str("id"), WarehouseID: c.Str("warehouse_id")}
	}
	incoming := make([]string, len(slices))
	for i, s := range slices {
		incoming[i] = s.WarehouseID
	}
	planned := domain.PlanCheckoutAppend(incoming, existingChildren)
	snapshot := plan.Snapshot
	var ids []string
	for i, s := range slices {
		orderID := planned[i].OrderID
		if orderID == "" {
			num, err := generateOrderNumber(ctx, tx)
			if err != nil {
				return mixedResult{}, err
			}
			method := existing.PaymentMethod
			if method == "" {
				method = "cash"
			}
			orderID, err = insertChildOrder(ctx, tx, childOrder{
				OrderNumber: num, QueueNumber: existing.QueueNumber, OrderType: snapString(snapshot, "orderType"),
				PaymentStatus: plan.PaymentStatus, PaymentMethod: method, CompanyID: existing.CompanyID, BranchID: existing.BranchID,
				WarehouseID: s.WarehouseID, CheckoutID: existing.ID, CustomerID: existing.CustomerID, CashierID: deref(existing.CashierID),
				ServerID: snapPtr(snapshot, "serverId"), TableID: existing.TableID, GuestCount: snapInt(snapshot, "guestCount"), ShiftID: existing.ShiftID,
				Subtotal: s.Subtotal, Discount: alloc[i].Discount, DiscountReason: snapPtr(snapshot, "discountReason"),
				Tax: alloc[i].Tax, ServiceCharge: alloc[i].ServiceCharge, OtherCharges: alloc[i].OtherCharges, Total: alloc[i].Total,
				Notes: snapPtr(snapshot, "notes"), SpecialRequests: snapPtr(snapshot, "specialRequests"),
				OrderStatus: domain.ChildOrderStatus(plan.PaymentStatus, true),
			}, h.now())
			if err != nil {
				return mixedResult{}, err
			}
		} else if _, err := tx.Exec(ctx, `UPDATE pos.pos_orders SET
           subtotal = COALESCE(subtotal, 0) + $1,
           discount_amount = COALESCE(discount_amount, 0) + $2,
           tax_amount = COALESCE(tax_amount, 0) + $3,
           service_charge_amount = COALESCE(service_charge_amount, 0) + $4,
           other_charges_amount = COALESCE(other_charges_amount, 0) + $5,
           total_amount = COALESCE(total_amount, 0) + $6,
           updated_at = now()
         WHERE id = $7`, s.Subtotal, alloc[i].Discount, alloc[i].Tax, alloc[i].ServiceCharge, alloc[i].OtherCharges, alloc[i].Total, orderID); err != nil {
			return mixedResult{}, err
		}
		if err := insertChildItems(ctx, tx, orderID, s.Lines, cost, merchClaimed); err != nil {
			return mixedResult{}, err
		}
		ids = append(ids, orderID)
	}
	merged := map[string]any{}
	for k, v := range snapshot {
		merged[k] = v
	}
	prevItems, _ := existing.Snapshot["items"].([]any)
	newItems, _ := snapshot["items"].([]any)
	merged["items"] = append(append([]any{}, prevItems...), newItems...)
	byProduct := map[string]any{}
	if prev, ok := existing.Snapshot["warehouseByProduct"].(map[string]any); ok {
		for k, v := range prev {
			byProduct[k] = v
		}
	}
	if cur, ok := snapshot["warehouseByProduct"].(map[string]any); ok {
		for k, v := range cur {
			byProduct[k] = v
		}
	}
	merged["warehouseByProduct"] = byProduct
	snapJSON, _ := jsrow.Marshal(merged)
	if _, err := tx.Exec(ctx, `UPDATE pos.pos_checkouts SET
         subtotal = COALESCE(subtotal, 0) + $1,
         discount_amount = COALESCE(discount_amount, 0) + $2,
         tax_amount = COALESCE(tax_amount, 0) + $3,
         service_charge_amount = COALESCE(service_charge_amount, 0) + $4,
         other_charges_amount = COALESCE(other_charges_amount, 0) + $5,
         total_amount = COALESCE(total_amount, 0) + $6,
         cart_snapshot = $7::jsonb,
         updated_at = now()
       WHERE id = $8`, plan.ServerSubtotal, plan.DiscountAmount, plan.TaxAmount, plan.ServiceChargeAmount,
		plan.OtherChargesAmount, plan.ServerTotal, string(snapJSON), existing.ID); err != nil {
		return mixedResult{}, err
	}
	return mixedResult{CheckoutID: existing.ID, CheckoutNumber: existing.CheckoutNumber, QueueNumber: existing.QueueNumber, OrderIDs: ids}, nil
}

func snapString(s map[string]any, key string) string {
	v, _ := s[key].(string)
	return v
}

func snapPtr(s map[string]any, key string) *string {
	v, ok := s[key].(string)
	if !ok {
		return nil
	}
	return &v
}

func snapInt(s map[string]any, key string) int {
	return domain.NormalizeGuestCount(s[key])
}

func parseSnapshot(raw []byte) map[string]any {
	var m map[string]any
	if err := jsonUnmarshalNumber(raw, &m); err != nil {
		return nil
	}
	return m
}

// createMixedCheckout is createMixedCheckout, inside the caller's tx:
// plan → claim stock → checkout + children (or append) → ARK debit →
// finalize (kitchen tickets, XP, stats and journal events).
func (h *Handler) createMixedCheckout(ctx context.Context, tx pgx.Tx, in mixedInput) (mixedResult, error) {
	plan, err := domain.PlanMixedSale(in.MixedSaleInput)
	if err != nil {
		return mixedResult{}, err
	}
	defCompany, defBranch := h.p.Directory.Venue(ctx, tx)
	company, branch := firstStr(in.CompanyID, defCompany), firstStr(in.BranchID, defBranch)

	merchClaimed := map[string]bool{}
	if plan.IsPaidSale {
		claims, status, reason, err := h.p.Merchandise.Claim(ctx, tx, merchLines(in.Items))
		if err != nil {
			return mixedResult{}, err
		}
		if reason != "" {
			return mixedResult{}, &domain.CheckoutError{Status: status, Message: reason}
		}
		for _, c := range claims {
			merchClaimed[c.ProductID] = true
		}
	}
	cost := map[string]float64{}
	if plan.InsertChildren {
		if cost, err = h.p.Catalog.CostPrices(ctx, tx, productIDs(in.Items, true)); err != nil {
			return mixedResult{}, err
		}
	}

	created, err := h.persistCheckout(ctx, tx, in, plan, company, branch, merchClaimed, cost)
	if err != nil {
		return mixedResult{}, err
	}

	if plan.PaymentMethod == "ark_coin" && in.CustomerID != "" && len(created.OrderIDs) > 0 {
		bal, err := h.p.Wallet.Move(ctx, tx, ports.ArkMove{CustomerID: in.CustomerID, Amount: -plan.ArkUsed, Type: "payment", OrderID: created.OrderIDs[0]})
		if err != nil {
			if errors.Is(err, ports.ErrArkInsufficient) {
				return mixedResult{}, domain.Reject("Saldo ARK Coin tidak cukup")
			}
			if errors.Is(err, ports.ErrArkFailed) {
				return mixedResult{}, domain.Reject("Gagal memproses ARK Coin")
			}
			return mixedResult{}, err
		}
		created.ArkBalanceAfter = bal
	}

	if plan.IsPaidSale && plan.InsertChildren {
		xp, err := h.finalizePaidChildren(ctx, tx, created.OrderIDs, in.CustomerID, in.SessionUserID, plan.PaymentMethod, branch, false)
		if err != nil {
			return mixedResult{}, err
		}
		created.XPAwarded = xp
		if in.CustomerID != "" && xp > 0 {
			if created.XPTotalAfter, err = h.p.Loyalty.TotalXP(ctx, tx, in.CustomerID); err != nil {
				return mixedResult{}, err
			}
		}
	}
	return created, nil
}

func firstStr(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// persistCheckout locks the open bill to continue (explicit id or table) and
// appends to it, or inserts a fresh checkout.
func (h *Handler) persistCheckout(ctx context.Context, tx pgx.Tx, in mixedInput, plan domain.MixedSalePlan, company, branch string, merchClaimed map[string]bool, cost map[string]float64) (mixedResult, error) {
	var existing *checkoutRow
	var err error
	if explicit := domain.Trim(in.ExistingCheckoutID); explicit != "" {
		if existing, err = findUnpaidCheckout(ctx, tx, false, explicit, company, branch); err != nil {
			return mixedResult{}, err
		}
		if existing == nil {
			return mixedResult{}, domain.Reject("Open bill tidak ditemukan")
		}
	} else if in.TableID != "" {
		if existing, err = findUnpaidCheckout(ctx, tx, true, in.TableID, company, branch); err != nil {
			return mixedResult{}, err
		}
	}
	existingID := ""
	if existing != nil {
		existingID = existing.ID
	}
	if in.TableID == "" && existing == nil {
		if !plan.CanCreateFreshCheckout {
			return mixedResult{}, domain.Reject(domain.MsgMultiStallRequired)
		}
	} else {
		if !plan.RequestedUnpaid && existingID != "" {
			return mixedResult{}, domain.Reject(domain.MsgContinueOpenBill)
		}
		kind := domain.SaleCentralSingle
		if plan.CanCreateFreshCheckout {
			kind = domain.SaleCentralMixed
		}
		if domain.ResolveTableSaleTarget(kind, existingID) == domain.TargetAppendCheckout && existing != nil && plan.RequestedUnpaid {
			return h.appendToCheckout(ctx, tx, existing, plan, merchClaimed, cost)
		}
		if !plan.CanCreateFreshCheckout {
			return mixedResult{}, domain.Reject(domain.MsgMultiStallRequired)
		}
	}
	return h.insertFreshCheckout(ctx, tx, in, plan, company, branch, merchClaimed, cost)
}

func (h *Handler) insertFreshCheckout(ctx context.Context, tx pgx.Tx, in mixedInput, plan domain.MixedSalePlan, company, branch string, merchClaimed map[string]bool, cost map[string]float64) (mixedResult, error) {
	number, err := nextCheckoutNumber(ctx, tx)
	if err != nil {
		return mixedResult{}, err
	}
	queue, err := generateQueueNumber(ctx, tx, strPtr(company), strPtr(branch))
	if err != nil {
		return mixedResult{}, err
	}
	snapJSON, _ := jsrow.Marshal(plan.Snapshot)
	var id, num string
	var q *string
	err = tx.QueryRow(ctx, `INSERT INTO pos.pos_checkouts (
         checkout_number, queue_number, company_id, branch_id, table_id, customer_id,
         cashier_id, shift_id, payment_method, payment_status, subtotal, discount_amount,
         tax_amount, service_charge_amount, other_charges_amount, total_amount,
         amount_paid, change_amount, notes, cart_snapshot
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9::pos_payment_method,$10::pos_payment_status,
         $11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb
       )
       RETURNING id, checkout_number, queue_number`,
		number, queue, strPtr(company), strPtr(branch), strPtr(in.TableID), strPtr(in.CustomerID),
		in.CashierID, strPtr(in.ShiftID), plan.PaymentMethod, plan.PaymentStatus, plan.ServerSubtotal, plan.DiscountAmount,
		plan.TaxAmount, plan.ServiceChargeAmount, plan.OtherChargesAmount, plan.ServerTotal,
		plan.AmountPaid, plan.ChangeAmount, strPtr(in.Notes), string(snapJSON)).Scan(&id, &num, &q)
	if err != nil {
		return mixedResult{}, err
	}
	var orderIDs []string
	if plan.InsertChildren {
		c := &checkoutRow{
			ID: id, QueueNumber: deref(q), PaymentStatus: plan.PaymentStatus, PaymentMethod: plan.PaymentMethod,
			CompanyID: strPtr(company), BranchID: strPtr(branch), TableID: strPtr(in.TableID), CustomerID: strPtr(in.CustomerID),
			CashierID: &in.CashierID, ShiftID: strPtr(in.ShiftID), DiscountAmount: plan.DiscountAmount, TaxAmount: plan.TaxAmount,
			ServiceChargeAmount: plan.ServiceChargeAmount, OtherChargesAmount: plan.OtherChargesAmount,
			AmountPaid: plan.AmountPaid, ChangeAmount: plan.ChangeAmount,
		}
		if orderIDs, err = h.insertChildren(ctx, tx, c, plan.Snapshot, plan.RequestedUnpaid, in.WarehouseByProduct, merchClaimed, cost, in.CompType, in.CompApproved); err != nil {
			return mixedResult{}, err
		}
	}
	if err := stampPaymentCatalog(ctx, tx, id, orderIDs, in.PaymentMethodCode, in.PaymentMethodName); err != nil {
		return mixedResult{}, err
	}
	return mixedResult{CheckoutID: id, CheckoutNumber: num, QueueNumber: firstStr(deref(q), queue), OrderIDs: orderIDs}, nil
}

// finalizePaidChildren is finalizePaidChildren: kitchen tickets, the XP
// award per child (port, summed for the receipt), then one SaleCompleted
// (customer stats; CRM's XP re-award finds the same idempotency keys) and
// one SaleSettled (journal) event per child.
func (h *Handler) finalizePaidChildren(ctx context.Context, tx pgx.Tx, orderIDs []string, customerID, userID, paymentMethod, branchID string, alreadyHadChildren bool) (float64, error) {
	if len(orderIDs) == 0 {
		return 0, nil
	}
	orders, err := jsrow.Query(ctx, tx, `SELECT "id", "order_number", "queue_number", "order_type", "table_id", "total_amount", "warehouse_id" FROM "pos"."pos_orders" WHERE "id" IN (SELECT unnest($1::uuid[]))`, orderIDs)
	if err != nil {
		return 0, err
	}
	items, err := jsrow.Query(ctx, tx, `SELECT "id", "order_id", "product_id", "product_name", "product_sku", "variants", "modifiers", "quantity", "unit_price", "total_amount", "station" FROM "pos"."pos_order_items" WHERE "order_id" IN (SELECT unnest($1::uuid[]))`, orderIDs)
	if err != nil {
		return 0, err
	}
	byOrder := map[string][]*jsrow.Row{}
	for _, it := range items {
		byOrder[it.Str("order_id")] = append(byOrder[it.Str("order_id")], it)
	}
	for _, o := range orders {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pos.pos_print_jobs WHERE order_id = $1)`, o.Str("id")).Scan(&exists); err != nil {
			return 0, err
		}
		if !exists {
			h.insertPrintJobs(ctx, tx, h.printOrder(o, o.Str("queue_number")), byOrder[o.Str("id")])
		}
	}
	var statsAmount *float64
	if customerID != "" && !alreadyHadChildren {
		total := 0.0
		for _, o := range orders {
			total += o.Num("total_amount")
		}
		statsAmount = &total
	}
	xp := 0.0
	for i, o := range orders {
		award, err := h.p.Loyalty.AwardOrderXP(ctx, tx, ports.OrderXP{
			OrderID: o.Str("id"), CustomerID: customerID, TotalAmount: o.Num("total_amount"),
			Items: xpItems(byOrder[o.Str("id")]), OutletID: strPtr(branchID), PaymentMethod: paymentMethod,
		})
		if err != nil {
			return 0, err
		}
		xp += award.XPAwarded
		event := saleCompleted(o.Str("id"), customerID, o.Num("total_amount"), paymentMethod, branchID, userID, byOrder[o.Str("id")])
		if i == 0 {
			event.StatsAmount = statsAmount
		}
		if err := publish(ctx, tx, possales.TopicSaleCompleted, o.Str("id"), event); err != nil {
			return 0, err
		}
		pm := paymentMethod
		if err := publish(ctx, tx, possales.TopicSaleSettled, o.Str("id"), possales.SaleSettled{OrderID: o.Str("id"), UserID: userID, PaymentMethod: &pm}); err != nil {
			return 0, err
		}
	}
	return xp, nil
}

func xpItems(rows []*jsrow.Row) []ports.XPItem {
	out := make([]ports.XPItem, len(rows))
	for i, r := range rows {
		out[i] = ports.XPItem{
			ProductID: r.Str("product_id"), Quantity: numPtr(r, "quantity"),
			TotalAmount: numPtr(r, "total_amount"), Subtotal: numPtr(r, "subtotal"), UnitPrice: numPtr(r, "unit_price"),
		}
	}
	return out
}

func numPtr(r *jsrow.Row, key string) *float64 {
	if r.Get(key) == nil {
		return nil
	}
	v := r.Num(key)
	return &v
}

func saleCompleted(orderID, customerID string, total float64, method, branchID, userID string, items []*jsrow.Row) possales.SaleCompleted {
	ev := possales.SaleCompleted{OrderID: orderID, UserID: strPtr(userID), CustomerID: strPtr(customerID), TotalAmount: total, PaymentMethod: method, BranchID: strPtr(branchID), Items: []possales.SaleItem{}}
	for _, it := range items {
		ev.Items = append(ev.Items, possales.SaleItem{
			ProductID: it.Str("product_id"), Quantity: domain.Or(it.Num("quantity"), 1),
			UnitPrice: numPtr(it, "unit_price"), TotalAmount: numPtr(it, "total_amount"),
		})
	}
	return ev
}

func merchLines(items []domain.Obj) []ports.MerchLine {
	out := make([]ports.MerchLine, len(items))
	for i, it := range items {
		out[i] = ports.MerchLine{ProductID: it.Str("product_id"), SkuID: it.Str("sku_id"), Quantity: it.Get("quantity")}
	}
	return out
}

// productIDs maps items to String(item.product_id || ""), optionally
// dropping blanks.
func productIDs(items []domain.Obj, dropBlank bool) []string {
	var out []string
	for _, it := range items {
		id := it.Str("product_id")
		if dropBlank && id == "" {
			continue
		}
		out = append(out, id)
	}
	return out
}
