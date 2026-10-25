-- =============================================================================
-- KPI indicator coach_complaint_rate: complaint tickets linked to a coach per
-- 100 attendees of that coach's classes in the period (lower is better,
-- default target 1). The payroll KPI snapshot computes it for employees whose
-- account is linked to a gym coach; everyone else has no value, so the
-- indicator drops out of their score and its weight is redistributed.
-- Idempotent.
-- =============================================================================

INSERT INTO performance.kpi_indicators (code, name, unit, direction, source_kind, source_ref, default_target, is_active, notes)
VALUES ('coach_complaint_rate', 'Keluhan per 100 Peserta (Coach)', 'rasio', 'lower_better', 'auto', 'gym.complaints', 1, true,
        'tiket keluhan yang tertaut ke coach / peserta hadir di kelas coach itu x 100')
ON CONFLICT (code) DO NOTHING;

-- Coaches sign in as gym_coach; older coach accounts use the employee role.
INSERT INTO performance.kpi_role_indicators (role_code, indicator_id, weight)
SELECT r.role_code, i.id, 15
  FROM performance.kpi_indicators i
 CROSS JOIN (VALUES ('gym_coach'), ('employee')) AS r(role_code)
 WHERE i.code = 'coach_complaint_rate'
ON CONFLICT (role_code, indicator_id) DO NOTHING;
