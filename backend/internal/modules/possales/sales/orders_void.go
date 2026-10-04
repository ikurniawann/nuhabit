package sales

import (
	"context"
	"errors"
	"math"
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/modules/possales/offers"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
)

const voidColumns = `id, status, payment_status, payment_method, order_number, total_amount, customer_id, company_id, branch_id, checkout_id, ark_coins_used`

// voidOrder is POST /api/pos/orders/{id}/void: supervisor-approved void of
// an order and its checkout siblings, refunding paid tenders.
func (h *Handler) voidOrder(w http.ResponseWriter, r *http.Request) error {
	user, err := kit.PosUser(h.auth, r)
	if err != nil {
		return err
	}
	res, err := h.voidUseCase(r, user)
	return h.writeOutcomeOr(w, res, err, "Void error", "Void gagal diproses")
}

func (h *Handler) voidUseCase(r *http.Request, user *auth.User) (*response, error) {
	ctx := r.Context()
	body, err := readObj(r)
	if err != nil {
		return nil, err
	}
	if !body.Truthy("reason") || !body.Truthy("supervisor_pin") {
		return nil, fail(400, "Reason and supervisor PIN required")
	}
	orderID := r.PathValue("id")
	var order *jsrow.Row
	_ = savepointQuery(ctx, h.db, func(q database.Querier) error {
		var err error
		order, err = jsrow.QueryOne(ctx, q, `SELECT `+voidColumns+` FROM pos.pos_orders WHERE id = $1`, orderID)
		return err
	})
	var scopeRow *orderScope
	if order != nil {
		scopeRow = &orderScope{CompanyID: order.Str("company_id"), BranchID: order.Str("branch_id")}
	}
	approval, err := h.pins.approveOrder(ctx, user.ID, orderID, scopeRow, domain.String(body.Get("supervisor_pin")))
	if err != nil {
		return nil, err
	}
	if approval.Approver == nil {
		return nil, rejection(approval, "PIN supervisor tidak valid")
	}
	supervisor := approval.Approver
	if !domain.CanVoidOrderStatus(order.Str("status")) {
		switch order.Str("status") {
		case "voided":
			return nil, fail(400, "Order already voided")
		case "merged":
			return nil, fail(400, "Cannot void merged order")
		}
		return nil, fail(400, "Order tidak bisa di-void")
	}
	var res *response
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		var err error
		res, err = h.voidTx(ctx, tx, order, supervisor, domain.Trim(domain.String(body.Get("reason"))), orderID)
		return err
	})
	return res, err
}

func (h *Handler) voidTx(ctx context.Context, tx pgx.Tx, source *jsrow.Row, supervisor *Approver, reason, requestedID string) (*response, error) {
	family := []*jsrow.Row{source}
	if cid := source.Str("checkout_id"); cid != "" {
		rows, err := jsrow.Query(ctx, tx, `SELECT `+voidColumns+` FROM pos.pos_orders WHERE checkout_id = $1`, cid)
		if err != nil {
			return nil, err
		}
		if len(rows) > 0 {
			family = rows
		}
	}
	var voidable, paid []*jsrow.Row
	for _, row := range family {
		if domain.CanVoidOrderStatus(row.Str("status")) {
			voidable = append(voidable, row)
			if domain.IsPaidPosOrder(row.Str("status"), row.Str("payment_status")) {
				paid = append(paid, row)
			}
		}
	}
	if len(voidable) == 0 {
		return nil, fail(400, "Order already voided")
	}
	ids := make([]string, len(voidable))
	for i, row := range voidable {
		ids[i] = row.Str("id")
	}
	customer := source.Str("customer_id")
	for _, row := range voidable {
		if customer == "" {
			customer = row.Str("customer_id")
		}
	}
	now := h.clock()

	if len(paid) > 0 {
		for _, row := range voidable {
			if _, err := h.p.GiftCards.VoidIssued(ctx, tx, row.Str("id"), " — void "+firstStr(row.Str("order_number"), row.Str("id"))); err != nil {
				var used *ports.IssuedCardUsedError
				if errors.As(err, &used) {
					return nil, fail(409, used.Error())
				}
				return nil, err
			}
		}
		wallet, err := h.p.Wallet.OrderRows(ctx, tx, ids)
		if err != nil {
			return nil, err
		}
		walletPayment, refunded := 0.0, false
		for _, w := range wallet {
			switch w.Type {
			case "payment":
				walletPayment = math.Max(walletPayment, domain.Or0(w.Amount))
			case "refund":
				refunded = true
			}
		}
		refund := 0.0
		if !refunded {
			orders := make([]domain.VoidOrder, len(voidable))
			for i, row := range voidable {
				orders[i] = domain.VoidOrder{ArkCoinsUsed: row.Num("ark_coins_used"), TotalAmount: row.Num("total_amount")}
			}
			refund = domain.ArkRefundAmount(firstStr(source.Str("payment_method"), paid[0].Str("payment_method")), orders, walletPayment)
		}
		if refund > 0 && customer != "" {
			notes := "Void " + firstStr(source.Str("order_number"), source.Str("id"))
			if _, err := h.p.Wallet.Move(ctx, tx, ports.ArkMove{CustomerID: customer, Amount: refund, Type: "refund", OrderID: source.Str("id"), Notes: &notes}); err != nil {
				if errors.Is(err, ports.ErrArkInsufficient) || errors.Is(err, ports.ErrArkFailed) {
					return nil, fail(400, "Gagal mengembalikan ARK Coin")
				}
				return nil, err
			}
		}
		for _, row := range voidable {
			if row.Str("company_id") == "" || row.Str("branch_id") == "" {
				continue
			}
			label := firstStr(row.Str("order_number"), row.Str("id"))
			if _, err := h.p.GiftCards.Refund(ctx, tx, ports.GiftScope{CompanyID: row.Str("company_id"), BranchID: row.Str("branch_id")},
				row.Str("id"), supervisor.ID, "Pengembalian saldo — void "+label); err != nil {
				h.log.Error("[pos] gift_card refund failed", "order", row.Str("id"), "error", err)
			}
			if _, err := h.p.Tabs.Void(ctx, tx, row.Str("id"), reason, supervisor.ID); err != nil {
				h.log.Error("[pos] nfc_tab void failed", "order", row.Str("id"), "error", err)
			}
		}
	}

	paymentStatus := source.Get("payment_status")
	if len(paid) > 0 {
		paymentStatus = "refunded"
	}
	if _, err := tx.Exec(ctx, `UPDATE pos.pos_orders SET status = 'voided', payment_status = $2, voided_at = $3, voided_by = $4, void_reason = $5, updated_at = $3
		WHERE id = ANY($1::uuid[])`, ids, paymentStatus, now, supervisor.ID, reason); err != nil {
		return nil, err
	}
	if cid := source.Str("checkout_id"); cid != "" && len(paid) > 0 {
		bestEffort(ctx, tx, `UPDATE pos.pos_checkouts SET payment_status = 'refunded', updated_at = $2 WHERE id = $1`, cid, now)
	}
	for _, id := range ids {
		h.restoreMerchForOrder(ctx, tx, id)
		if err := savepointExec(ctx, tx, func(q database.Querier) error {
			if err := h.p.Offers.ReleasePromo(ctx, q, offers.ContextPosOrder, id); err != nil {
				return err
			}
			return h.p.Offers.ReleaseUsage(ctx, q, id)
		}); err != nil {
			h.log.Error("[pos] release promo error", "error", err)
		}
		// pos_order_splits has no updated_at column, so this TS update fails
		// unchecked and pending splits stay pending; kept as is for parity.
		bestEffort(ctx, tx, `UPDATE pos.pos_order_splits SET status = 'cancelled', updated_at = $2 WHERE order_id = $1 AND status = 'pending'`, id, now)
	}

	event := possales.OrdersVoided{OrderIDs: ids, VoidReason: reason, ReverseXP: len(paid) > 0,
		SourceOrderID: requestedID, SupervisorName: supervisor.Name}
	event.OrderNumber = source.Str("order_number")
	if event.OrderNumber == "" && len(requestedID) >= 8 {
		event.OrderNumber = requestedID[:8]
	}
	for _, row := range voidable {
		event.Total += row.Num("total_amount")
	}
	if customer != "" && len(paid) > 0 {
		amount := 0.0
		for _, row := range paid {
			amount += row.Num("total_amount")
		}
		if amount > 0 {
			event.StatsCustomerID, event.StatsAmount, event.StatsVisitDelta = &customer, amount, 1
		}
	}
	if err := publish(ctx, tx, possales.TopicOrdersVoided, requestedID, event); err != nil {
		return nil, err
	}
	return &response{status: 200, body: jsrow.Object("success", true, "data",
		jsrow.Object("order_id", requestedID, "voided_order_ids", ids, "message", "Order voided successfully"))}, nil
}
