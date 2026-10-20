-- Background jobs (backend/internal/platform/jobs) and gym reminder delivery.
--
-- platform.job_runs: one row per job name. The runner takes a session
-- advisory lock per job, then starts a run only when the last start is at
-- least one interval old, so several API replicas run each job about once
-- per interval between them.
--
-- platform.reminder_sends: the sent log of periodic reminders. A sweep
-- inserts (kind, subject_id, period) in the transaction that writes the
-- notification; the primary key makes a rerun skip what it already sent.
--
-- gym.athlete_settings gains the member's per-channel opt-outs for gym
-- notifications. booking_reminders (already there) gates class reminders.
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.job_runs (
  name              text PRIMARY KEY,
  last_started_at   timestamptz NOT NULL,
  last_finished_at  timestamptz,
  last_succeeded_at timestamptz,
  last_error        text
);

CREATE TABLE IF NOT EXISTS platform.reminder_sends (
  kind        text        NOT NULL,
  subject_id  text        NOT NULL,
  period      text        NOT NULL,
  customer_id uuid,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, subject_id, period)
);

CREATE INDEX IF NOT EXISTS reminder_sends_sent_at_idx ON platform.reminder_sends (sent_at);

ALTER TABLE gym.athlete_settings
  ADD COLUMN IF NOT EXISTS gym_whatsapp boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS gym_email    boolean NOT NULL DEFAULT true;
