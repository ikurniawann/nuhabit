-- Feedback 360°: the HR page, the reviewer form in ESS, and live summaries.
--
--   1. The five behavioural categories (20% each) and their criteria, the
--      set of the original 360 design, when the tables are still empty.
--   2. performance.refresh_feedback_summary(cycle, employee) recomputes one
--      summary from the submitted and approved assignments: each category
--      score is the average rating (1–5) × 20, overall_360_score weighs the
--      categories by weight, kpi_score is the average KPI scorecard inside
--      the cycle dates (kept when there is none), and final_score and
--      final_grade follow the cycle weights (70/30 by default, grades as
--      domain.FinalGrade). Locked summaries stay as they are.
--      The old trigger function counted status 'completed', which the
--      status check never allows, so every summary held zeros; it now calls
--      the refresh, and status changes and deletes refresh too.
--   3. Menus hris.performance.feedback-360 (HR: super_admin, admin, hrd)
--      and ess.feedback-360 (every role, as ess.kpi).
-- Idempotent.

-- 1. Categories and criteria.
INSERT INTO performance.feedback_categories (name, description, weight, display_order)
SELECT v.name, v.description, 20.00, v.ord
  FROM (VALUES
    ('Leadership', 'Kemampuan memimpin, mengarahkan, dan menginspirasi tim', 1),
    ('Communication', 'Efektivitas komunikasi verbal dan tertulis', 2),
    ('Collaboration', 'Kemampuan bekerja sama dalam tim lintas fungsi', 3),
    ('Accountability', 'Tanggung jawab atas hasil dan komitmen', 4),
    ('Problem Solving', 'Kemampuan menganalisis dan menyelesaikan masalah', 5)
  ) AS v(name, description, ord)
 WHERE NOT EXISTS (SELECT 1 FROM performance.feedback_categories);

INSERT INTO performance.feedback_criteria (category_id, name, description, display_order)
SELECT c.id, v.name, v.description, v.ord
  FROM (VALUES
    ('Leadership', 'Menetapkan arah dan tujuan yang jelas', 'Mampu menetapkan visi dan target yang jelas untuk tim', 1),
    ('Leadership', 'Memberikan feedback konstruktif', 'Memberikan masukan yang membangun untuk perkembangan tim', 2),
    ('Leadership', 'Menginspirasi dan memotivasi', 'Mampu memotivasi tim untuk mencapai target', 3),
    ('Communication', 'Komunikasi verbal yang efektif', 'Menyampaikan ide dengan jelas dalam diskusi atau presentasi', 1),
    ('Communication', 'Komunikasi tertulis yang baik', 'Email, dokumen, dan laporan yang jelas dan terstruktur', 2),
    ('Communication', 'Mendengarkan aktif', 'Mendengarkan dan memahami perspektif orang lain', 3),
    ('Collaboration', 'Berbagi pengetahuan', 'Mau berbagi informasi dan keahlian dengan tim', 1),
    ('Collaboration', 'Dukungan kepada rekan tim', 'Membantu rekan tim saat dibutuhkan', 2),
    ('Collaboration', 'Fleksibilitas dalam tim', 'Mampu beradaptasi dengan berbagai gaya kerja', 3),
    ('Accountability', 'Memenuhi komitmen', 'Menyelesaikan tugas sesuai janji dan tenggat', 1),
    ('Accountability', 'Tanggung jawab atas kesalahan', 'Mengakui kesalahan dan belajar darinya', 2),
    ('Accountability', 'Inisiatif dan proaktif', 'Tidak menunggu perintah, mengambil inisiatif', 3),
    ('Problem Solving', 'Analisis masalah sistematis', 'Mengidentifikasi akar masalah dengan baik', 1),
    ('Problem Solving', 'Solusi kreatif dan inovatif', 'Menawarkan solusi yang efektif dan kreatif', 2),
    ('Problem Solving', 'Pengambilan keputusan', 'Mampu mengambil keputusan tepat waktu', 3)
  ) AS v(category, name, description, ord)
  JOIN performance.feedback_categories c ON c.name = v.category
 WHERE NOT EXISTS (SELECT 1 FROM performance.feedback_criteria x WHERE x.category_id = c.id);

-- 2. Live summaries.
CREATE OR REPLACE FUNCTION performance.refresh_feedback_summary(p_cycle uuid, p_employee uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v record;
  v_cycle record;
  v_kpi numeric;
  v_final numeric;
BEGIN
  IF p_cycle IS NULL OR p_employee IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM performance.feedback_summaries
              WHERE cycle_id = p_cycle AND employee_id = p_employee AND is_locked) THEN
    RETURN;
  END IF;
  SELECT * INTO v_cycle FROM performance.feedback_cycles WHERE id = p_cycle;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  WITH per_category AS (
    SELECT lower(c.name) AS name, COALESCE(c.weight, 0) AS weight, avg(r.rating) * 20 AS score
      FROM performance.feedback_responses r
      JOIN performance.feedback_assignments a ON a.id = r.assignment_id
      JOIN performance.feedback_criteria cr ON cr.id = r.criteria_id
      JOIN performance.feedback_categories c ON c.id = cr.category_id
     WHERE a.cycle_id = p_cycle AND a.employee_id = p_employee
       AND a.status IN ('submitted', 'approved')
     GROUP BY c.id, c.name, c.weight)
  SELECT count(*) AS n,
         max(score) FILTER (WHERE name = 'leadership') AS leadership,
         max(score) FILTER (WHERE name = 'communication') AS communication,
         max(score) FILTER (WHERE name = 'collaboration') AS collaboration,
         max(score) FILTER (WHERE name = 'accountability') AS accountability,
         max(score) FILTER (WHERE name = 'problem solving') AS problem_solving,
         CASE WHEN sum(weight) > 0 THEN sum(score * weight) / sum(weight) ELSE avg(score) END AS overall
    INTO v
    FROM per_category;

  -- Nothing reviewed yet: no row to create.
  IF v.n = 0 AND NOT EXISTS (SELECT 1 FROM performance.feedback_summaries
                              WHERE cycle_id = p_cycle AND employee_id = p_employee) THEN
    RETURN;
  END IF;

  SELECT avg(k.score) INTO v_kpi
    FROM performance.kpi_scorecards k
   WHERE k.employee_id = p_employee AND k.score IS NOT NULL
     AND make_date(k.period_year, k.period_month, 1)
         BETWEEN date_trunc('month', v_cycle.start_date)::date AND v_cycle.end_date;
  IF v_kpi IS NULL THEN
    SELECT kpi_score INTO v_kpi FROM performance.feedback_summaries
     WHERE cycle_id = p_cycle AND employee_id = p_employee;
  END IF;
  v_final := v_kpi * COALESCE(v_cycle.kpi_weight, 70) / 100 + v.overall * COALESCE(v_cycle.feedback_weight, 30) / 100;

  INSERT INTO performance.feedback_summaries AS s (
    cycle_id, employee_id, leadership_score, communication_score, collaboration_score,
    accountability_score, problem_solving_score, overall_360_score, kpi_score,
    final_score, final_grade, updated_at)
  VALUES (p_cycle, p_employee, v.leadership, v.communication, v.collaboration,
    v.accountability, v.problem_solving, v.overall, v_kpi, v_final,
    CASE WHEN v_final IS NULL THEN NULL
         WHEN v_final >= 90 THEN 'A' WHEN v_final >= 80 THEN 'B'
         WHEN v_final >= 70 THEN 'C' WHEN v_final >= 60 THEN 'D' ELSE 'E' END,
    now())
  ON CONFLICT (cycle_id, employee_id) DO UPDATE SET
    leadership_score = EXCLUDED.leadership_score,
    communication_score = EXCLUDED.communication_score,
    collaboration_score = EXCLUDED.collaboration_score,
    accountability_score = EXCLUDED.accountability_score,
    problem_solving_score = EXCLUDED.problem_solving_score,
    overall_360_score = EXCLUDED.overall_360_score,
    kpi_score = EXCLUDED.kpi_score,
    final_score = EXCLUDED.final_score,
    final_grade = EXCLUDED.final_grade,
    updated_at = now();
END;
$function$;

-- A response changed: refresh its assignment's summary (none when the
-- assignment itself is being deleted; its own trigger covers that).
CREATE OR REPLACE FUNCTION public.fn_calculate_feedback_summary()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_cycle uuid;
  v_employee uuid;
BEGIN
  SELECT cycle_id, employee_id INTO v_cycle, v_employee
    FROM performance.feedback_assignments
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.assignment_id ELSE NEW.assignment_id END;
  PERFORM performance.refresh_feedback_summary(v_cycle, v_employee);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_calculate_feedback_summary ON performance.feedback_responses;
CREATE TRIGGER trg_calculate_feedback_summary AFTER INSERT OR UPDATE OR DELETE ON performance.feedback_responses
  FOR EACH ROW EXECUTE FUNCTION public.fn_calculate_feedback_summary();

-- An assignment changed status or was deleted. Runs after
-- trg_lock_summary_on_approval (triggers fire by name), so an approval
-- locks first and the refresh then leaves the summary alone.
CREATE OR REPLACE FUNCTION performance.trg_refresh_summary_on_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM performance.refresh_feedback_summary(OLD.cycle_id, OLD.employee_id);
  ELSE
    PERFORM performance.refresh_feedback_summary(NEW.cycle_id, NEW.employee_id);
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_refresh_summary_on_status ON performance.feedback_assignments;
CREATE TRIGGER trg_refresh_summary_on_status AFTER UPDATE ON performance.feedback_assignments
  FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status)
  EXECUTE FUNCTION performance.trg_refresh_summary_on_assignment();
DROP TRIGGER IF EXISTS trg_refresh_summary_on_delete ON performance.feedback_assignments;
CREATE TRIGGER trg_refresh_summary_on_delete AFTER DELETE ON performance.feedback_assignments
  FOR EACH ROW EXECUTE FUNCTION performance.trg_refresh_summary_on_assignment();

-- Recompute what the old trigger left at zero.
SELECT performance.refresh_feedback_summary(s.cycle_id, s.employee_id)
  FROM performance.feedback_summaries s WHERE NOT s.is_locked;

-- 3. Menus.
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('hris.performance.feedback-360', 'Feedback 360°', '/dashboard/hris/feedback-360', 'users', 'sidebar', 68,
        '{"actions":["read","create","update","delete","approve"]}'::jsonb),
       ('ess.feedback-360', 'Feedback 360°', '/dashboard/me/feedback-360', 'users', 'sidebar', 46,
        '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'hris', level = 3 WHERE code = 'hris.performance.feedback-360';
UPDATE iam.menus SET module = 'ess', level = 2 WHERE code = 'ess.feedback-360';
UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE (child.code = 'hris.performance.feedback-360' AND parent.code = 'hris.performance')
    OR (child.code = 'ess.feedback-360' AND parent.code = 'ess');

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
  FROM iam.roles r CROSS JOIN iam.menus m
 WHERE r.deleted_at IS NULL AND m.deleted_at IS NULL
   AND ((m.code = 'hris.performance.feedback-360' AND r.code IN ('super_admin', 'admin', 'hrd'))
        OR m.code = 'ess.feedback-360')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
