-- =============================================================================
-- Backfill source_type / source_id on old gym credit deductions
-- =============================================================================
-- Cancelling a session refunds the credits taken for its bookings by matching
-- ledger rows on source_type, source_id and the idempotency key
-- (gym:<checkin|late_cancel|no_show>:<booking id>). Deductions written
-- before the ledger recorded its source carried that key with a generic or
-- missing source, so the cancellation never found them. This fills
-- source_type and source_id from the key. The ledger is append-only by
-- trigger; the trigger is lifted for this one statement and put back.
-- Idempotent: rows already in the current shape are not touched.
-- =============================================================================

DO $$
DECLARE
  n integer;
BEGIN
  ALTER TABLE gym.credit_ledger DISABLE TRIGGER trg_gym_credit_ledger_append_only;

  WITH fixed AS (
    UPDATE gym.credit_ledger
       SET source_type = CASE substring(idempotency_key from '^gym:(checkin|late_cancel|no_show):')
                           WHEN 'checkin' THEN 'class_booking'
                           ELSE substring(idempotency_key from '^gym:(checkin|late_cancel|no_show):')
                         END,
           source_id   = substring(idempotency_key from '^gym:(?:checkin|late_cancel|no_show):([0-9a-fA-F-]{36})')::uuid
     WHERE type = 'class_deduction'
       AND amount < 0
       AND idempotency_key ~ '^gym:(checkin|late_cancel|no_show):[0-9a-fA-F-]{36}(:[0-9]+)?(#[0-9]+)?$'
       AND (source_id IS NULL
            OR source_type IS NULL
            OR source_type NOT IN ('class_booking', 'late_cancel', 'no_show'))
    RETURNING 1
  )
  SELECT count(*) INTO n FROM fixed;

  ALTER TABLE gym.credit_ledger ENABLE TRIGGER trg_gym_credit_ledger_append_only;

  RAISE NOTICE 'gym.credit_ledger: % deduksi lama diisi source_type/source_id dari kunci idempotensi', n;
END $$;
