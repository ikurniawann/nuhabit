package tableorder

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/integrations"
	"nuhabit/backend/internal/platform/outbox"
)

// subscribeQrisOrders settles the open-bill orders bound to their own QRIS
// once the Xendit webhook verified the payment (settleOrderQrisPayment).
// The order row is locked and a paid order is skipped, so a redelivered
// callback or the status poll that settled first changes nothing.
func subscribeQrisOrders(bus *outbox.Bus) {
	bus.Subscribe(integrations.TopicXenditQrPaid, "pos-sales.settle-qris-order", func(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
		var p integrations.XenditQrPaid
		if err := e.Decode(&p); err != nil {
			return err
		}
		if p.Action != integrations.ActionCompleteOrder {
			return nil
		}
		return settleOrderQris(ctx, tx, p.TargetID)
	})
}
