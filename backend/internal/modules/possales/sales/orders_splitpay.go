package sales

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
)

// paySplit is POST /api/pos/orders/{id}/splits/{splitId}/pay.
func (h *Handler) paySplit(w http.ResponseWriter, r *http.Request) error {
	user, err := kit.PosUser(h.auth, r)
	if err != nil {
		return err
	}
	body, err := readObj(r)
	if err != nil {
		return h.writeOutcome(w, nil, err, "Error paying split")
	}
	var res *response
	err = database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		var err error
		res, err = h.paySplitTx(r.Context(), tx, user, r.PathValue("id"), r.PathValue("splitId"), body)
		return err
	})
	return h.writeOutcomeOr(w, res, err, "Error paying split", "Unknown error")
}

func (h *Handler) paySplitTx(ctx context.Context, tx pgx.Tx, user *auth.User, orderID, splitID string, body domain.Obj) (*response, error) {
	method := body.Get("payment_method")
	if !domain.Truthy(method) || domain.IsNullish(body.Get("amount_paid")) {
		return nil, fail(400, "payment_method and amount_paid required")
	}
	pm := domain.String(method)
	arkRaw := body.Get("ark_coins_used")
	if _, undef := arkRaw.(domain.Undefined); undef {
		arkRaw = jsonZero
	}
	if pm == "ark_coin" || domain.Or0(domain.Number(arkRaw)) > 0 {
		if !h.p.Loyalty.ArkCoinEnabled(ctx, tx) {
			return nil, arkDisabled()
		}
	}
	var split *jsrow.Row
	_ = savepointQuery(ctx, tx, func(q database.Querier) error {
		var err error
		split, err = jsrow.QueryOne(ctx, q, `SELECT * FROM pos.pos_order_splits WHERE id = $1 AND order_id = $2`, splitID, orderID)
		return err
	})
	if split == nil {
		return nil, fail(404, "Split not found")
	}
	switch split.Str("status") {
	case "cancelled":
		return nil, fail(400, "Split already cancelled")
	case "paid":
		return nil, fail(400, "Split already paid")
	}
	amountPaid := domain.Number(body.Get("amount_paid"))
	splitTotal := split.Num("total_amount")
	if amountPaid < splitTotal {
		return nil, fail(400, "Nominal bayar kurang dari total split "+domain.NumberString(splitTotal))
	}
	change := amountPaid - splitTotal
	ark := domain.Or0(domain.Number(arkRaw))
	if pm == "gift_card" {
		return nil, fail(400, "Gift card belum didukung untuk split bill")
	}
	if ark > 0 && pm != "ark_coin" {
		return nil, fail(400, "ARK Coin tidak bisa dicampur metode lain — 1 pembayaran 1 metode")
	}
	if pm == "ark_coin" && ark < splitTotal {
		return nil, fail(400, "Pembayaran ARK Coin harus menutup seluruh total split")
	}
	customerID := split.Str("customer_id")
	if ark > 0 {
		if customerID == "" {
			return nil, fail(400, "ARK Coin butuh customer member")
		}
		notes := "Split payment " + splitID
		if _, err := h.p.Wallet.Move(ctx, tx, ports.ArkMove{CustomerID: customerID, Amount: -ark, Type: "payment", OrderID: orderID, Notes: &notes}); err != nil {
			if errors.Is(err, ports.ErrArkInsufficient) {
				return nil, fail(400, "Saldo ARK Coin tidak cukup")
			}
			if errors.Is(err, ports.ErrArkFailed) {
				return nil, fail(400, "Gagal memproses ARK Coin")
			}
			return nil, err
		}
	}
	var paymentID string
	if err := savepointQuery(ctx, tx, func(q database.Querier) error {
		return q.QueryRow(ctx, `INSERT INTO pos.pos_split_payments (split_id, order_id, amount, change_amount, payment_method, reference_number, cashier_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
			splitID, orderID, amountPaid, change, pm, truthyScalar(body.Get("reference_number")), user.ID).Scan(&paymentID)
	}); err != nil {
		return nil, fail(500, kit.ErrorMessage(err))
	}
	if err := savepointQuery(ctx, tx, func(q database.Querier) error {
		_, err := q.Exec(ctx, `UPDATE pos.pos_order_splits SET status = 'paid', payment_method = $2, amount_paid = $3, change_amount = $4, ark_coins_used = $5, paid_at = $6 WHERE id = $1`,
			splitID, pm, amountPaid, change, ark, h.clock())
		return err
	}); err != nil {
		return nil, fail(500, kit.ErrorMessage(err))
	}
	var total, paid int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int, count(*) FILTER (WHERE status = 'paid')::int FROM pos.pos_order_splits WHERE order_id = $1`, orderID).Scan(&total, &paid); err != nil {
		return nil, err
	}
	paymentStatus := "partial"
	if total > 0 && total == paid {
		paymentStatus = "paid"
	}
	if err := savepointQuery(ctx, tx, func(q database.Querier) error {
		_, err := q.Exec(ctx, `UPDATE pos.pos_orders SET payment_status = $2 WHERE id = $1`, orderID, paymentStatus)
		return err
	}); err != nil {
		return nil, fail(500, kit.ErrorMessage(err))
	}
	// pos_order_status_history has no reason column: the TS insert fails unchecked.
	label := firstStr(split.Str("label"), domain.String(split.Get("split_index")))
	bestEffort(ctx, tx, `INSERT INTO pos.pos_order_status_history (order_id, from_status, to_status, reason, changed_at) VALUES ($1, NULL, NULL, $2, $3)`,
		orderID, "Split "+label+" paid via "+pm, h.clock())

	order, err := jsrow.QueryOne(ctx, tx, `SELECT total_amount, service_charge_amount, other_charges_amount FROM pos.pos_orders WHERE id = $1`, orderID)
	if err != nil {
		return nil, err
	}
	var cogs float64
	if err := tx.QueryRow(ctx, `SELECT COALESCE(SUM(GREATEST(COALESCE(cost_total, 0), 0)), 0)::float8 FROM pos.pos_order_items WHERE order_id = $1`, orderID).Scan(&cogs); err != nil {
		return nil, err
	}
	orderTotal, service, other := splitTotal, 0.0, 0.0
	if order != nil {
		orderTotal = domain.Or(order.Num("total_amount"), splitTotal)
		service, other = order.Num("service_charge_amount"), order.Num("other_charges_amount")
	}
	settled := possales.SaleSettled{
		OrderID: orderID, UserID: user.ID, PaymentMethod: &pm,
		DocumentID: firstStr(paymentID, splitID), DocumentType: "pos_split_payment",
		AmountsOverride: domain.SplitAccountingAmounts(domain.SplitAmountsInput{
			Subtotal: split.Num("subtotal"), Discount: split.Num("discount_amount"), Tax: split.Num("tax_amount"),
			Total: splitTotal, AmountPaid: amountPaid, OrderTotal: orderTotal, OrderCogs: cogs, ServiceCharge: service, OtherCharges: other,
		}),
	}
	if err := publish(ctx, tx, possales.TopicSaleSettled, splitID, settled); err != nil {
		return nil, err
	}
	branch := split.Str("branch_id") // pos_order_splits has no branch_id: undefined in TS too.
	award, err := h.p.Loyalty.AwardSplitXP(ctx, tx, ports.SplitXP{OrderID: orderID, SplitID: splitID, CustomerID: customerID,
		TotalAmount: splitTotal, OutletID: strPtr(branch), PaymentMethod: pm})
	if err != nil {
		return nil, err
	}
	splitEvent := possales.SplitPaid{OrderID: orderID, SplitID: splitID, CustomerID: strPtr(customerID), TotalAmount: splitTotal, PaymentMethod: pm}
	if customerID != "" {
		splitEvent.StatsAmount = &splitTotal
	}
	if err := publish(ctx, tx, possales.TopicSplitPaid, splitID, splitEvent); err != nil {
		return nil, err
	}
	return &response{status: 200, body: jsrow.Object("success", true, "data", jsrow.Object(
		"success", true, "split_id", splitID, "change", change, "paid_splits", paid, "total_splits", total,
		"payment_status", paymentStatus, "crm_xp", award))}, nil
}
