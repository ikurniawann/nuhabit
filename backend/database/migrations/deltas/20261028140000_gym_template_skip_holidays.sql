-- Schedule templates skip public holidays.
--
-- gym.session_templates.skip_holidays (default true): generating sessions
-- leaves out the dates of active HRIS holidays (hris.public_holidays, every
-- type). The holiday table has no company or region column (each client has
-- its own database), so a holiday closes every branch. A skipped date is not
-- recorded as generated: when HR removes the holiday, the next run creates
-- the session. Idempotent.

ALTER TABLE gym.session_templates
  ADD COLUMN IF NOT EXISTS skip_holidays boolean NOT NULL DEFAULT true;
