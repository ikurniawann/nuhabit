package sales

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/integrations"
	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/outbox"
)

// subscribeQrisCheckouts completes the central checkouts whose QRIS the
// Xendit webhook verified: completeMixedCheckout(checkoutId, {},
// { paymentAlreadyConfirmed: true }), the cashier's completion without the
// Xendit re-check, so the same sale events are published.
func (h *Handler) subscribeQrisCheckouts() {
	h.events.Subscribe(integrations.TopicXenditQrPaid, "pos-sales.complete-qris-checkout", func(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
		var p integrations.XenditQrPaid
		if err := e.Decode(&p); err != nil {
			return err
		}
		if p.Action != integrations.ActionCompleteCheckout {
			return nil
		}
		return h.completePaidCheckout(ctx, tx, p.TargetID)
	})
}

// completePaidCheckout runs only while the checkout has no child orders,
// the webhook's own condition, checked again under the checkout lock: a
// redelivered callback or a cashier who completed first changes nothing.
// A rejected completion is logged and dropped, as the TS webhook ACKed it
// (checkout_error); retrying cannot fix it.
func (h *Handler) completePaidCheckout(ctx context.Context, tx pgx.Tx, checkoutID string) error {
	err := tx.QueryRow(ctx, `SELECT 1 FROM pos.pos_checkouts WHERE id = $1 FOR UPDATE`, checkoutID).Scan(new(int))
	if database.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var children int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*)::int FROM pos.pos_orders WHERE checkout_id = $1`, checkoutID).Scan(&children); err != nil || children > 0 {
		return err
	}
	err = database.WithTx(ctx, tx, func(sp pgx.Tx) error {
		_, err := h.completeMixedCheckout(ctx, sp, checkoutID, completeTender{}, true)
		return err
	})
	var rejected *domain.CheckoutError
	if errors.As(err, &rejected) {
		h.log.ErrorContext(ctx, "[xendit webhook] checkout not completed", "checkout_id", checkoutID, "error", err)
		return nil
	}
	return err
}
