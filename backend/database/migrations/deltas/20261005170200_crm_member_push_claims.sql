-- Web push dedupe for outbox subscribers (backend/internal/modules/crm/engagement).
-- A subscriber claims (outbox event id, recipient) in its own committed
-- statement before it sends a push. A redelivery of the same event, on any
-- replica, finds the claim and skips the push, even when the first
-- delivery's transaction failed after the push went out. Claims older than
-- the outbox retention (7 days) are pruned by the claim statement.
CREATE TABLE IF NOT EXISTS crm.member_push_claims (
  event_id   bigint      NOT NULL,
  recipient  text        NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, recipient)
);

CREATE INDEX IF NOT EXISTS member_push_claims_claimed_idx ON crm.member_push_claims (claimed_at);
