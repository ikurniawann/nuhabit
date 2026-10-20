-- Per-branch time zone. Gym days, session times, open gym hours, coach
-- availability, booking caps, receipts and reports follow the zone of the
-- branch; a branch without a choice keeps Jakarta (WIB). The list matches
-- backend/internal/platform/localtime.Names. Idempotent.

ALTER TABLE configuration.branches
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Jakarta';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'branches_timezone_check'
                    AND conrelid = 'configuration.branches'::regclass) THEN
    ALTER TABLE configuration.branches ADD CONSTRAINT branches_timezone_check
      CHECK (timezone IN ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'));
  END IF;
END $$;

COMMENT ON COLUMN configuration.branches.timezone IS
  'IANA zone of the branch wall clock: Asia/Jakarta (WIB), Asia/Makassar (WITA) or Asia/Jayapura (WIT).';
