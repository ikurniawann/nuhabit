package storedvalue

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/integrations"
	"nuhabit/backend/internal/platform/outbox"
)

// subscribeQrisTopups credits the QRIS top-ups the Xendit webhook verified
// (creditPendingTopup in the TS webhook). The credit locks the top-up row
// and skips one that is no longer pending, so a redelivered callback or a
// cashier reconcile that came first credits nothing twice.
func subscribeQrisTopups(bus *outbox.Bus, w *Wallet) {
	bus.Subscribe(integrations.TopicXenditQrPaid, "stored-value.credit-qris-topup", func(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
		var p integrations.XenditQrPaid
		if err := e.Decode(&p); err != nil {
			return err
		}
		if p.Action != integrations.ActionCreditTopup {
			return nil
		}
		onTx := *w
		onTx.db = tx
		_, err := onTx.creditPendingTopup(ctx, p.TargetID, p.XenditPaymentID, p.Notes)
		return err
	})
}
