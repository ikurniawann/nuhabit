-- Outbox receipts for CRM subscribers whose effects have no natural key
-- (backend/internal/modules/crm/advance: crm_events rows and workflow runs
-- for salesfunnel.crm_event.raised). The handler claims (subscriber, outbox
-- event id) in its delivery transaction, so a redelivered event finds the
-- receipt and applies nothing twice. Receipts older than the outbox
-- retention (7 days) are pruned by the claim statement.
CREATE TABLE IF NOT EXISTS crm.outbox_receipts (
  subscriber  text        NOT NULL,
  event_id    bigint      NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber, event_id)
);

CREATE INDEX IF NOT EXISTS outbox_receipts_received_idx ON crm.outbox_receipts (received_at);
