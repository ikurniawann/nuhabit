-- Transactional outbox for the Go backend (backend/internal/platform/outbox).
-- A module publishes an event in its own transaction; the same transaction
-- adds one delivery row per registered subscriber of that topic. Dispatchers
-- claim pending deliveries with FOR UPDATE SKIP LOCKED and run the handler in
-- the delivery's transaction, so database effects apply exactly once.
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.outbox_events (
    id         bigserial PRIMARY KEY,
    topic      text        NOT NULL,
    key        text        NOT NULL DEFAULT '',
    payload    jsonb       NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbox_events_created_idx ON platform.outbox_events (created_at);

-- Every running dispatcher upserts the subscriptions it serves at startup.
CREATE TABLE IF NOT EXISTS platform.outbox_subscriptions (
    subscriber    text PRIMARY KEY,
    topic         text        NOT NULL,
    registered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbox_subscriptions_topic_idx ON platform.outbox_subscriptions (topic);

CREATE TABLE IF NOT EXISTS platform.outbox_deliveries (
    event_id        bigint      NOT NULL REFERENCES platform.outbox_events (id) ON DELETE CASCADE,
    subscriber      text        NOT NULL,
    attempts        integer     NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error      text,
    delivered_at    timestamptz,
    dead_at         timestamptz,
    PRIMARY KEY (event_id, subscriber)
);

CREATE INDEX IF NOT EXISTS outbox_deliveries_pending_idx
    ON platform.outbox_deliveries (subscriber, next_attempt_at, event_id)
    WHERE delivered_at IS NULL AND dead_at IS NULL;
