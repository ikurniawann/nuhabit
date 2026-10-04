package sales

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/outbox"
)

// subscribe registers the module's own handlers: WhatsApp alerts belong to
// a notifications context no wave ports, so pos-sales sends them itself,
// after commit, from the outbox (fire-and-forget in the TS).
func (h *Handler) subscribe() {
	if h.events == nil {
		return
	}
	// stored-value settles member bills and publishes their orders as
	// pos.sale.completed with payment method "member_bill"; the TS gave each
	// settled order its queue number at that point (ensureQueueNumber).
	h.events.Subscribe(possales.TopicSaleCompleted, "pos-sales.member-bill-queue", func(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
		var p possales.SaleCompleted
		if err := e.Decode(&p); err != nil {
			return err
		}
		if p.PaymentMethod != "member_bill" {
			return nil
		}
		var queue, company, branch *string
		err := tx.QueryRow(ctx, `SELECT queue_number, company_id::text, branch_id::text FROM pos.pos_orders WHERE id = $1`, p.OrderID).Scan(&queue, &company, &branch)
		if database.IsNoRows(err) {
			return nil
		}
		if err != nil {
			return err
		}
		h.ensureQueueNumber(ctx, tx, p.OrderID, deref(queue), deref(company), deref(branch))
		return nil
	})
	if h.p.Notifier == nil {
		return
	}
	h.events.Subscribe(possales.TopicCompApproved, "pos-sales.comp-alert", func(ctx context.Context, _ pgx.Tx, e outbox.Event) error {
		var p possales.CompApproved
		if err := e.Decode(&p); err != nil {
			return err
		}
		h.p.Notifier.NotifyComp(ctx, ports.CompNotice{
			CompType: p.CompType, OrderNumber: p.OrderNumber, OrderCount: p.OrderCount,
			GrossIdr: p.GrossIdr, ApprovedName: p.ApprovedName, CustomerID: p.CustomerID,
		})
		return nil
	})
	h.events.Subscribe(possales.TopicGiftCardsSold, "pos-sales.gift-card-wa", func(ctx context.Context, _ pgx.Tx, e outbox.Event) error {
		var p possales.GiftCardsSold
		if err := e.Decode(&p); err != nil {
			return err
		}
		cards := make([]ports.IssuedGiftCard, len(p.Cards))
		for i, c := range p.Cards {
			var exp json.RawMessage = []byte("null")
			if c.ExpiresAt != nil {
				exp, _ = json.Marshal(*c.ExpiresAt)
			}
			cards[i] = ports.IssuedGiftCard{ID: c.ID, Code: c.Code, InitialValue: c.InitialValue, ExpiresAt: exp}
		}
		h.p.Notifier.NotifyGiftCardsSold(ctx, ports.GiftCardsSoldNotice{BuyerName: p.BuyerName, BuyerPhone: p.BuyerPhone, Cards: cards})
		return nil
	})
	h.events.Subscribe(possales.TopicOrdersVoided, "pos-sales.void-alert", func(ctx context.Context, _ pgx.Tx, e outbox.Event) error {
		var p possales.OrdersVoided
		if err := e.Decode(&p); err != nil {
			return err
		}
		if p.SourceOrderID == "" {
			return nil
		}
		h.p.Notifier.NotifyLargeVoid(ctx, ports.VoidNotice{
			OrderID: p.SourceOrderID, OrderNumber: p.OrderNumber, Total: p.Total,
			Reason: p.VoidReason, SupervisorName: p.SupervisorName,
		})
		return nil
	})
}

// publish stores an event in the caller's transaction.
func publish(ctx context.Context, q database.Querier, topic, key string, payload any) error {
	return outbox.Publish(ctx, q, topic, key, payload)
}

// bestEffort runs a write whose error the TS ignores (`await db.from(...)
// .insert(...)` without checking), in a savepoint so the transaction
// survives the failure.
func bestEffort(ctx context.Context, q database.Querier, sql string, args ...any) {
	if b, ok := q.(database.TxBeginner); ok {
		_ = database.WithTx(ctx, b, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, sql, args...)
			return err
		})
		return
	}
	_, _ = q.Exec(ctx, sql, args...)
}

// savepointExec runs fn in a savepoint of b.
func savepointExec(ctx context.Context, b database.TxBeginner, fn func(database.Querier) error) error {
	return database.WithTx(ctx, b, func(tx pgx.Tx) error { return fn(tx) })
}
