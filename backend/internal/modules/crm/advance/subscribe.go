package advance

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/salesfunnel"
	"nuhabit/backend/internal/modules/crm/advance/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/outbox"
)

// Subscriber names are contracts: renaming one drops its pending deliveries.
const (
	subscriberSalesEvent      = "crm.workflow-on-sales-event"
	subscriberQuotationPriced = "crm.approval-on-quotation-priced"
)

// Subscribe registers the sales-funnel subscribers: the CRM event engine
// (emitCrmEvent) and the quotation discount approval sync, both run on the
// delivery's transaction.
func Subscribe(bus *outbox.Bus, d module.Deps, p Ports) {
	if bus == nil {
		return
	}
	s := subscriber{h: newHandler(d.DB, d, p)}
	bus.Subscribe(salesfunnel.TopicCrmEventRaised, subscriberSalesEvent, s.crmEventRaised)
	bus.Subscribe(salesfunnel.TopicQuotationPriced, subscriberQuotationPriced, s.quotationPriced)
}

type subscriber struct{ h *handler }

// crmEventRaised records the event, runs its workflow rules and rescores
// the lead. crm_events has no natural key, so a receipt keyed on the outbox
// event makes a redelivery apply nothing twice. Outbound sends of workflow
// actions (WhatsApp, webhooks) stay at-least-once.
func (s subscriber) crmEventRaised(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
	if first, err := claimReceipt(ctx, tx, subscriberSalesEvent, e.ID); err != nil || !first {
		return err
	}
	var in salesfunnel.CrmEventRaised
	if err := e.Decode(&in); err != nil {
		return err
	}
	var changes map[string]domain.Change
	if len(in.Changes) > 0 {
		changes = make(map[string]domain.Change, len(in.Changes))
		for field, raw := range in.Changes {
			c, _ := raw.(map[string]any)
			changes[field] = domain.Change{From: c["from"], To: c["to"]}
		}
	}
	return s.h.on(tx).processCrmEvent(ctx, crmEvent{
		EventType: in.EventType, SubjectType: in.SubjectType, SubjectID: in.SubjectID,
		CompanyID: nonEmpty(in.CompanyID), BranchID: nonEmpty(in.BranchID), ActorUserID: nonEmpty(in.ActorUserID),
		Payload: in.Payload, Changes: changes,
	})
}

// quotationPriced re-syncs the discount approval; the sync reads the
// current quotation, so a redelivery finds the request in place.
func (s subscriber) quotationPriced(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
	var in salesfunnel.QuotationPriced
	if err := e.Decode(&in); err != nil {
		return err
	}
	return s.h.on(tx).syncQuotationApproval(ctx, in.QuotationID, nonEmpty(&in.RequestedBy))
}

// claimReceipt records that subscriber handled event eventID; false when a
// delivery already did. Receipts past the outbox retention are dropped.
func claimReceipt(ctx context.Context, q database.Querier, subscriber string, eventID int64) (bool, error) {
	tag, err := q.Exec(ctx, `
WITH expired AS (DELETE FROM crm.outbox_receipts WHERE received_at < now() - interval '7 days')
INSERT INTO crm.outbox_receipts (subscriber, event_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING`, subscriber, eventID)
	return tag.RowsAffected() == 1, err
}

// nonEmpty maps "" (the publisher's unset id) to nil.
func nonEmpty(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}
