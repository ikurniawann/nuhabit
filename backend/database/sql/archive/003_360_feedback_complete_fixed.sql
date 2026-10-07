-- ============================================================
-- 360° FEEDBACK SYSTEM - COMPLETE MIGRATION
-- Run this in psql atau SQL client
-- ============================================================

-- ============================================================
-- PART 1: CORE SCHEMA (8 tables + views)
-- ============================================================

-- 1. FEEDBACK CATEGORIES (Behavioral Metrics)
CREATE TABLE IF NOT EXISTS feedback_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  description text,
  weight decimal(5,2) DEFAULT 20.00,
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

DROP INDEX IF EXISTS idx_feedback_categories_active;
CREATE INDEX IF NOT EXISTS idx_feedback_categories_active ON feedback_categories(is_active);

-- Seed 5 behavioral metrics
INSERT INTO feedback_categories (name, description, weight, display_order) VALUES
  ('Leadership', 'Kemampuan memimpin, mengarahkan, dan menginspirasi tim', 20.00, 1),
  ('Communication', 'Efektivitas komunikasi verbal dan tertulis', 20.00, 2),
  ('Collaboration', 'Kemampuan bekerja sama dalam tim lintas fungsi', 20.00, 3),
  ('Accountability', 'Tanggung jawab atas hasil dan komitmen', 20.00, 4),
  ('Problem Solving', 'Kemampuan menganalisis dan menyelesaikan masalah', 20.00, 5)
ON CONFLICT DO NOTHING;

-- 2. FEEDBACK CRITERIA (Indicators per category)
CREATE TABLE IF NOT EXISTS feedback_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES feedback_categories(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  description text,
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_criteria_category ON feedback_criteria(category_id);

-- Seed criteria for each category
INSERT INTO feedback_criteria (category_id, name, description, display_order)
SELECT fc.id, 'Menetapkan arah dan tujuan yang jelas', 'Mampu menetapkan visi dan target yang jelas untuk tim', 1
FROM feedback_categories fc WHERE fc.name = 'Leadership'
ON CONFLICT DO NOTHING;

INSERT INTO feedback_criteria (category_id, name, description, display_order)
SELECT fc.id, 'Memberikan feedback konstruktif', 'Memberikan masukan yang membangun untuk perkembangan tim', 2
FROM feedback_categories fc WHERE fc.name = 'Leadership'
ON CONFLICT DO NOTHING;

INSERT INTO feedback_criteria (category_id, name, description, display_order)
SELECT fc.id, 'Menginspirasi dan memotivasi', 'Mampu memotivasi tim untuk mencapai target', 3
FROM feedback_categories fc WHERE fc.name = 'Leadership'
ON CONFLICT DO NOTHING;

INSERT INTO feedback_criteria (category_id, name, description, display_order)
SELECT fc.id, 'Komunikasi verbal yang efektif', 'Menyampaikan ide dengan jelas dalam diskusi/presentasi', 1
FROM feedback_categories fc WHERE fc.name = 'Communication'
ON CONFLICT DO NOTHING;

INSERT INTO feedback_criteria (category_id, name, description, display_order)
SELECT fc.id, 'Komunikasi tertulis yang baik', 'Email, dokumen, dan laporan yang jelas dan terstruktur', 2
FROM feedback_categories fc WHERE fc.name = 'Communication'
ON CONFLICT DO NOTHING;

INSERT INTO feedback_criteria (category_id, name, description, display_order)
SELECT fc.id, 'Mendengarkan aktif', 'Mendengarkan dan memahami perspektif orang lain', 3
FROM feedback_categories fc WHERE fc.name = 'Communication'
ON CONFLICT DO NOTHING;

INSERT INTO feedback_criteria (category_id, name, description, display_order)
SELECT fc.id, 'Berbagi pengetahuan', 'Mau berbagi informasi dan expertise dengan tim', 1
FROM feedback_categories fc WHERE fc.name = 'Collaboration'
ON CONFLICT DO NOTHING;

INSERT INTO feedback_criteria (category_id, name, description, display_order)
SELECT fc.id, 'Dukungan kepada rekan tim', 'Membantu rekan tim saat dibutuhkan', 2
FROM feedback_categories fc WHERE fc.name = 'Collaboration'
ON CONFLICT DO NOTHING;

INSERT INTO feedback_criteria (category_id, name, description, display_order)
SELECT fc.id, 'Fleksibilitas dalam tim', 'Mampu beradaptasi dengan berbagai gaya kerja', 3
FROM feedback_categories fc WHERE fc.name = 'Collaboration'
ON CONFLICT DO NOTHING;

INSERT INTO feedback_criteria (category_id, name, description, display_order)
SELECT fc.id, 'Memenuhi komitmen', 'Menyelesaikan tugas sesuai janji dan deadline', 1
FROM feedback_categories fc WHERE fc.name = 'Accountability'
ON CONFLICT DO NOTHING;

INSERT INTO feedback_criteria (category_id, name, description, display_order)
SELECT fc.id, 'Tanggung jawab atas kesalahan', 'Mengakui kesalahan dan belajar darinya', 2
FROM feedback_categories fc WHERE fc.name = 'Accountability'
ON CONFLICT DO NOTHING;

INSERT INTO feedback_criteria (category_id, name, description, display_order)
SELECT fc.id, 'Inisiatif dan proaktif', 'Tidak menunggu perintah, mengambil inisiatif', 3
FROM feedback_categories fc WHERE fc.name = 'Accountability'
ON CONFLICT DO NOTHING;

INSERT INTO feedback_criteria (category_id, name, description, display_order)
SELECT fc.id, 'Analisis masalah sistematis', 'Mengidentifikasi akar masalah dengan baik', 1
FROM feedback_categories fc WHERE fc.name = 'Problem Solving'
ON CONFLICT DO NOTHING;

INSERT INTO feedback_criteria (category_id, name, description, display_order)
SELECT fc.id, 'Solusi kreatif dan inovatif', 'Menawarkan solusi yang efektif dan kreatif', 2
FROM feedback_categories fc WHERE fc.name = 'Problem Solving'
ON CONFLICT DO NOTHING;

INSERT INTO feedback_criteria (category_id, name, description, display_order)
SELECT fc.id, 'Pengambilan keputusan', 'Mampu mengambil keputusan tepat waktu', 3
FROM feedback_categories fc WHERE fc.name = 'Problem Solving'
ON CONFLICT DO NOTHING;

-- 3. FEEDBACK RELATIONSHIP TYPES
CREATE TABLE IF NOT EXISTS feedback_relationship_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(50) NOT NULL,
  description text,
  display_order integer DEFAULT 0
);

INSERT INTO feedback_relationship_types (name, description, display_order) VALUES
  ('self', 'Self-assessment / penilaian diri', 1),
  ('manager', 'Feedback dari manager langsung', 2),
  ('peer', 'Feedback dari rekan setara', 3),
  ('subordinate', 'Feedback dari bawahan langsung', 4),
  ('external', 'Feedback dari client/stakeholder eksternal', 5)
ON CONFLICT DO NOTHING;

-- 4. FEEDBACK CYCLES
CREATE TABLE IF NOT EXISTS feedback_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL,
  period_label varchar(100) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status varchar(50) DEFAULT 'draft',
  kpi_weight decimal(5,2) DEFAULT 70.00,
  feedback_weight decimal(5,2) DEFAULT 30.00,
  is_anonymous boolean DEFAULT true,
  allow_self_assessment boolean DEFAULT true,
  require_manager_review boolean DEFAULT true,
  created_by uuid REFERENCES employees(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_cycles_status ON feedback_cycles(status);
CREATE INDEX IF NOT EXISTS idx_feedback_cycles_period ON feedback_cycles(period_label);

-- 5. FEEDBACK ASSIGNMENTS
CREATE TABLE IF NOT EXISTS feedback_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES feedback_cycles(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reviewer_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  relationship_type varchar(50) NOT NULL,
  status varchar(50) DEFAULT 'pending',
  due_date date,
  started_at timestamptz,
  submitted_at timestamptz,
  reminder_count integer DEFAULT 0,
  last_reminder_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(cycle_id, employee_id, reviewer_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_feedback_assignments_cycle ON feedback_assignments(cycle_id);
CREATE INDEX IF NOT EXISTS idx_feedback_assignments_employee ON feedback_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_feedback_assignments_reviewer ON feedback_assignments(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_feedback_assignments_status ON feedback_assignments(status);

-- 6. FEEDBACK RESPONSES
CREATE TABLE IF NOT EXISTS feedback_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES feedback_assignments(id) ON DELETE CASCADE,
  criteria_id uuid NOT NULL REFERENCES feedback_criteria(id) ON DELETE RESTRICT,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comments text,
  sentiment_score decimal(5,2),
  sentiment_label varchar(20),
  ai_keywords text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(assignment_id, criteria_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_responses_assignment ON feedback_responses(assignment_id);
CREATE INDEX IF NOT EXISTS idx_feedback_responses_criteria ON feedback_responses(criteria_id);
CREATE INDEX IF NOT EXISTS idx_feedback_responses_sentiment ON feedback_responses(sentiment_label);

-- 7. FEEDBACK SUMMARY
CREATE TABLE IF NOT EXISTS feedback_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES feedback_cycles(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leadership_score decimal(5,2),
  communication_score decimal(5,2),
  collaboration_score decimal(5,2),
  accountability_score decimal(5,2),
  problem_solving_score decimal(5,2),
  overall_360_score decimal(5,2),
  kpi_score decimal(5,2),
  final_score decimal(5,2),
  final_grade varchar(2),
  manager_review_status varchar(50) DEFAULT 'pending',
  manager_comments text,
  reviewed_by uuid REFERENCES employees(id),
  reviewed_at timestamptz,
  strengths text[],
  weaknesses text[],
  burnout_risk varchar(20),
  promotion_potential varchar(20),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(cycle_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_summaries_cycle ON feedback_summaries(cycle_id);
CREATE INDEX IF NOT EXISTS idx_feedback_summaries_employee ON feedback_summaries(employee_id);
CREATE INDEX IF NOT EXISTS idx_feedback_summaries_score ON feedback_summaries(final_score);

-- 8. DEVELOPMENT PLANS
CREATE TABLE IF NOT EXISTS development_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_id uuid NOT NULL REFERENCES feedback_summaries(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  goal text NOT NULL,
  category varchar(50),
  priority varchar(20) DEFAULT 'medium',
  action_items text[],
  target_date date,
  progress integer DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  status varchar(50) DEFAULT 'planned',
  resources_needed text,
  mentor_id uuid REFERENCES employees(id),
  notes text,
  completed_at timestamptz,
  created_by uuid REFERENCES employees(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_development_plans_employee ON development_plans(employee_id);
CREATE INDEX IF NOT EXISTS idx_development_plans_status ON development_plans(status);

-- VIEWS FOR REPORTING
CREATE OR REPLACE VIEW v_employee_360_summary AS
SELECT 
  fs.id,
  fs.cycle_id,
  fs.employee_id,
  e.full_name,
  e.nip,
  d.name as department_name,
  p.title as position_title,
  fs.leadership_score,
  fs.communication_score,
  fs.collaboration_score,
  fs.accountability_score,
  fs.problem_solving_score,
  fs.overall_360_score,
  fs.kpi_score,
  fs.final_score,
  fs.final_grade,
  fs.burnout_risk,
  fs.promotion_potential,
  fc.period_label,
  fs.created_at
FROM feedback_summaries fs
JOIN employees e ON fs.employee_id = e.id
LEFT JOIN departments d ON e.department_id = d.id
LEFT JOIN positions p ON e.job_title_id = p.id
JOIN feedback_cycles fc ON fs.cycle_id = fc.id;

CREATE OR REPLACE VIEW v_feedback_cycle_progress AS
SELECT 
  fc.id,
  fc.name,
  fc.period_label,
  fc.status,
  fc.start_date,
  fc.end_date,
  COUNT(DISTINCT fa.employee_id) as total_employees,
  COUNT(DISTINCT CASE WHEN fa.status = 'completed' THEN fa.employee_id END) as completed_count,
  COUNT(DISTINCT CASE WHEN fa.status = 'pending' THEN fa.employee_id END) as pending_count,
  ROUND(COUNT(DISTINCT CASE WHEN fa.status = 'completed' THEN fa.employee_id END)::numeric / 
        NULLIF(COUNT(DISTINCT fa.employee_id), 0) * 100, 2) as completion_percentage
FROM feedback_cycles fc
LEFT JOIN feedback_assignments fa ON fc.id = fa.cycle_id
GROUP BY fc.id, fc.name, fc.period_label, fc.status, fc.start_date, fc.end_date;

-- RLS POLICIES
ALTER TABLE feedback_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_relationship_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE development_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow all feedback_categories" ON feedback_categories FOR ALL USING (true);
CREATE POLICY "allow all feedback_criteria" ON feedback_criteria FOR ALL USING (true);
CREATE POLICY "allow all feedback_relationship_types" ON feedback_relationship_types FOR ALL USING (true);
CREATE POLICY "allow all feedback_cycles" ON feedback_cycles FOR ALL USING (true);
CREATE POLICY "allow all feedback_assignments" ON feedback_assignments FOR ALL USING (true);
CREATE POLICY "allow all feedback_responses" ON feedback_responses FOR ALL USING (true);
CREATE POLICY "allow all feedback_summaries" ON feedback_summaries FOR ALL USING (true);
CREATE POLICY "allow all development_plans" ON development_plans FOR ALL USING (true);

-- TRIGGER: Auto-calculate summary scores
CREATE OR REPLACE FUNCTION fn_calculate_feedback_summary()
RETURNS trigger AS $$
DECLARE
  v_assignment RECORD;
  v_category_scores RECORD;
BEGIN
  SELECT * INTO v_assignment FROM feedback_assignments WHERE id = NEW.assignment_id;
  
  SELECT 
    AVG(CASE WHEN fc.name = 'Leadership' THEN fr.rating END) as leadership,
    AVG(CASE WHEN fc.name = 'Communication' THEN fr.rating END) as communication,
    AVG(CASE WHEN fc.name = 'Collaboration' THEN fr.rating END) as collaboration,
    AVG(CASE WHEN fc.name = 'Accountability' THEN fr.rating END) as accountability,
    AVG(CASE WHEN fc.name = 'Problem Solving' THEN fr.rating END) as problem_solving,
    COUNT(DISTINCT fr.assignment_id) as cnt
  INTO v_category_scores
  FROM feedback_responses fr
  JOIN feedback_assignments fa ON fr.assignment_id = fa.id
  JOIN feedback_criteria fcr ON fr.criteria_id = fcr.id
  JOIN feedback_categories fc ON fcr.category_id = fc.id
  WHERE fa.cycle_id = v_assignment.cycle_id 
    AND fa.employee_id = v_assignment.employee_id
    AND fa.status = 'completed';
  
  INSERT INTO feedback_summaries (
    cycle_id, employee_id,
    leadership_score, communication_score, collaboration_score,
    accountability_score, problem_solving_score,
    overall_360_score,
    updated_at
  ) VALUES (
    v_assignment.cycle_id,
    v_assignment.employee_id,
    COALESCE(v_category_scores.leadership, 0),
    COALESCE(v_category_scores.communication, 0),
    COALESCE(v_category_scores.collaboration, 0),
    COALESCE(v_category_scores.accountability, 0),
    COALESCE(v_category_scores.problem_solving, 0),
    COALESCE(
      (COALESCE(v_category_scores.leadership, 0) +
       COALESCE(v_category_scores.communication, 0) +
       COALESCE(v_category_scores.collaboration, 0) +
       COALESCE(v_category_scores.accountability, 0) +
       COALESCE(v_category_scores.problem_solving, 0)) / 5.0,
      0
    ),
    now()
  )
  ON CONFLICT (cycle_id, employee_id) DO UPDATE SET
    leadership_score = COALESCE(v_category_scores.leadership, 0),
    communication_score = COALESCE(v_category_scores.communication, 0),
    collaboration_score = COALESCE(v_category_scores.collaboration, 0),
    accountability_score = COALESCE(v_category_scores.accountability, 0),
    problem_solving_score = COALESCE(v_category_scores.problem_solving, 0),
    overall_360_score = COALESCE(
      (COALESCE(v_category_scores.leadership, 0) +
       COALESCE(v_category_scores.communication, 0) +
       COALESCE(v_category_scores.collaboration, 0) +
       COALESCE(v_category_scores.accountability, 0) +
       COALESCE(v_category_scores.problem_solving, 0)) / 5.0,
      0
    ),
    updated_at = now();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calculate_feedback_summary
  AFTER INSERT OR UPDATE ON feedback_responses
  FOR EACH ROW EXECUTE FUNCTION fn_calculate_feedback_summary();

-- ============================================================
-- PART 2: SEED DATA (80 employees)
-- ============================================================

-- Create feedback cycle
INSERT INTO feedback_cycles (id, name, period_label, start_date, end_date, status, kpi_weight, feedback_weight, is_anonymous, allow_self_assessment, require_manager_review) VALUES
  ('7b8c9563-60e3-4e11-9233-5ef98fec9dc8', 'Q1 2026 Performance Review', 'Q1 2026', '2026-01-01', '2026-03-31', 'completed', 70.00, 30.00, true, true, true);

-- Seed feedback summaries for 80 employees
-- EMP001-EMP040 (IT, Sales, HR, Marketing, Operations)
INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.15, 4.64, 3.87, 3.40, 4.63, 82.76, 68.00, 72.43, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Problem solver handal'], ARRAY['Tingkatkan akuntabilitas'] FROM employees e WHERE e.nip = 'EMP001';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.10, 3.98, 4.34, 4.50, 3.26, 80.72, 65.00, 69.72, 'D', 'medium', 'medium', ARRAY['Leadership kuat', 'Team player baik', 'Bertanggung jawab'], ARRAY['Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'EMP002';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.00, 3.92, 3.67, 3.65, 3.32, 74.24, 79.00, 77.57, 'C', 'medium', 'medium', ARRAY['Leadership kuat'], ARRAY['Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'EMP003';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.07, 3.53, 3.31, 3.48, 3.15, 66.16, 87.00, 80.75, 'B', 'medium', 'medium', ARRAY['Konsisten dalam bekerja'], ARRAY['Tingkatkan leadership', 'Lebih aktif kolaborasi', 'Tingkatkan akuntabilitas', 'Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'EMP004';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.29, 3.31, 4.15, 4.15, 4.97, 83.48, 76.00, 78.24, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Team player baik', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Tingkatkan komunikasi'] FROM employees e WHERE e.nip = 'EMP005';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.95, 4.31, 3.24, 3.78, 4.15, 77.72, 67.00, 70.22, 'C', 'medium', 'medium', ARRAY['Komunikasi efektif', 'Problem solver handal'], ARRAY['Lebih aktif kolaborasi'] FROM employees e WHERE e.nip = 'EMP006';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.45, 3.55, 3.37, 3.11, 4.41, 71.56, 84.00, 80.27, 'B', 'medium', 'medium', ARRAY['Problem solver handal'], ARRAY['Tingkatkan leadership', 'Lebih aktif kolaborasi', 'Tingkatkan akuntabilitas'] FROM employees e WHERE e.nip = 'EMP007';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.51, 4.69, 4.35, 3.89, 3.75, 84.76, 64.00, 70.23, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Team player baik'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'EMP008';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.08, 4.80, 4.13, 3.05, 4.46, 82.08, 70.00, 73.62, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Team player baik', 'Problem solver handal'], ARRAY['Tingkatkan akuntabilitas'] FROM employees e WHERE e.nip = 'EMP009';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.02, 3.80, 3.48, 4.10, 3.54, 75.76, 87.00, 83.63, 'B', 'medium', 'medium', ARRAY['Leadership kuat', 'Bertanggung jawab'], ARRAY['Lebih aktif kolaborasi'] FROM employees e WHERE e.nip = 'EMP010';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.30, 4.66, 4.18, 3.30, 3.63, 76.28, 81.00, 79.58, 'C', 'medium', 'medium', ARRAY['Komunikasi efektif', 'Team player baik'], ARRAY['Tingkatkan leadership', 'Tingkatkan akuntabilitas'] FROM employees e WHERE e.nip = 'EMP011';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.51, 3.28, 4.42, 3.87, 4.08, 76.64, 84.00, 81.79, 'B', 'medium', 'medium', ARRAY['Team player baik', 'Problem solver handal'], ARRAY['Tingkatkan komunikasi'] FROM employees e WHERE e.nip = 'EMP012';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 5.00, 4.37, 3.24, 3.80, 4.20, 82.44, 65.00, 70.23, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Problem solver handal'], ARRAY['Lebih aktif kolaborasi'] FROM employees e WHERE e.nip = 'EMP013';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.59, 4.48, 3.80, 4.05, 3.77, 78.76, 89.00, 85.93, 'B', 'medium', 'medium', ARRAY['Komunikasi efektif', 'Bertanggung jawab'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'EMP014';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.37, 3.00, 4.68, 4.75, 4.30, 80.40, 69.00, 72.42, 'C', 'medium', 'medium', ARRAY['Team player baik', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Tingkatkan leadership', 'Tingkatkan komunikasi'] FROM employees e WHERE e.nip = 'EMP015';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.10, 4.86, 4.44, 4.54, 3.26, 80.80, 94.00, 90.04, 'A', 'low', 'high', ARRAY['Komunikasi efektif', 'Team player baik', 'Bertanggung jawab'], ARRAY['Tingkatkan leadership', 'Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'EMP016';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.75, 4.08, 4.05, 3.71, 3.39, 79.92, 71.00, 73.68, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Team player baik'], ARRAY['Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'EMP017';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.50, 3.94, 4.90, 4.21, 4.57, 88.48, 68.00, 74.14, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Team player baik', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'EMP018';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.80, 4.15, 4.45, 3.62, 3.46, 77.92, 84.00, 82.18, 'B', 'medium', 'medium', ARRAY['Komunikasi efektif', 'Team player baik'], ARRAY['Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'EMP019';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.92, 3.96, 3.36, 3.60, 4.03, 75.48, 90.00, 85.64, 'B', 'medium', 'medium', ARRAY['Problem solver handal'], ARRAY['Lebih aktif kolaborasi'] FROM employees e WHERE e.nip = 'EMP020';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.21, 3.11, 3.49, 4.59, 4.92, 77.28, 91.00, 86.88, 'B', 'medium', 'medium', ARRAY['Bertanggung jawab', 'Problem solver handal'], ARRAY['Tingkatkan leadership', 'Tingkatkan komunikasi', 'Lebih aktif kolaborasi'] FROM employees e WHERE e.nip = 'EMP021';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.57, 3.39, 3.04, 3.06, 4.48, 70.16, 60.00, 63.05, 'D', 'medium', 'medium', ARRAY['Problem solver handal'], ARRAY['Tingkatkan komunikasi', 'Lebih aktif kolaborasi', 'Tingkatkan akuntabilitas'] FROM employees e WHERE e.nip = 'EMP022';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.24, 3.69, 4.57, 3.56, 4.05, 80.44, 78.00, 78.73, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Team player baik', 'Problem solver handal'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'EMP023';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.63, 3.84, 3.78, 4.85, 4.50, 82.40, 71.00, 74.42, 'C', 'medium', 'medium', ARRAY['Bertanggung jawab', 'Problem solver handal'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'EMP024';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.21, 4.79, 3.61, 4.79, 4.00, 85.60, 81.00, 82.38, 'B', 'low', 'high', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'EMP025';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.20, 3.19, 4.66, 3.40, 3.17, 74.48, 76.00, 75.54, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Team player baik'], ARRAY['Tingkatkan komunikasi', 'Tingkatkan akuntabilitas', 'Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'EMP026';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.08, 4.79, 3.56, 3.43, 3.06, 71.68, 91.00, 85.20, 'B', 'medium', 'medium', ARRAY['Komunikasi efektif'], ARRAY['Tingkatkan leadership', 'Tingkatkan akuntabilitas', 'Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'EMP027';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.11, 4.86, 4.54, 4.98, 3.27, 87.04, 64.00, 70.91, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Team player baik', 'Bertanggung jawab'], ARRAY['Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'EMP028';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.58, 3.14, 3.40, 4.28, 4.59, 75.96, 77.00, 76.69, 'C', 'medium', 'medium', ARRAY['Bertanggung jawab', 'Problem solver handal'], ARRAY['Tingkatkan komunikasi', 'Lebih aktif kolaborasi'] FROM employees e WHERE e.nip = 'EMP029';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.59, 3.90, 4.65, 3.07, 3.05, 73.04, 95.00, 88.41, 'B', 'medium', 'medium', ARRAY['Team player baik'], ARRAY['Tingkatkan akuntabilitas', 'Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'EMP030';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.03, 3.44, 3.20, 4.98, 4.81, 81.84, 89.00, 86.85, 'B', 'low', 'high', ARRAY['Leadership kuat', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Tingkatkan komunikasi', 'Lebih aktif kolaborasi'] FROM employees e WHERE e.nip = 'EMP031';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.40, 4.74, 3.56, 4.08, 4.60, 85.52, 69.00, 73.96, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'EMP032';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.40, 3.39, 3.10, 3.08, 3.86, 67.32, 74.00, 72.00, 'C', 'medium', 'medium', ARRAY['Konsisten dalam bekerja'], ARRAY['Tingkatkan leadership', 'Tingkatkan komunikasi', 'Lebih aktif kolaborasi', 'Tingkatkan akuntabilitas'] FROM employees e WHERE e.nip = 'EMP033';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.86, 4.18, 3.28, 4.40, 4.34, 84.24, 68.00, 72.87, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Lebih aktif kolaborasi'] FROM employees e WHERE e.nip = 'EMP034';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.58, 3.97, 4.71, 3.98, 3.33, 82.28, 93.00, 89.78, 'B', 'low', 'high', ARRAY['Leadership kuat', 'Team player baik'], ARRAY['Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'EMP035';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.69, 4.67, 3.02, 4.41, 3.39, 76.72, 64.00, 67.82, 'D', 'medium', 'medium', ARRAY['Komunikasi efektif', 'Bertanggung jawab'], ARRAY['Lebih aktif kolaborasi', 'Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'EMP036';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.49, 4.64, 3.07, 4.71, 4.64, 82.20, 69.00, 72.96, 'C', 'medium', 'medium', ARRAY['Komunikasi efektif', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Tingkatkan leadership', 'Lebih aktif kolaborasi'] FROM employees e WHERE e.nip = 'EMP037';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.78, 4.22, 3.60, 4.87, 4.21, 82.72, 82.00, 82.22, 'B', 'low', 'high', ARRAY['Komunikasi efektif', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'EMP038';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.60, 3.37, 3.84, 3.48, 3.11, 73.60, 80.00, 78.08, 'C', 'medium', 'medium', ARRAY['Leadership kuat'], ARRAY['Tingkatkan komunikasi', 'Tingkatkan akuntabilitas', 'Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'EMP039';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.67, 4.73, 3.50, 4.03, 3.89, 83.28, 86.00, 85.18, 'B', 'low', 'high', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Bertanggung jawab'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'EMP040';

-- E001-E040 (Second dataset)
INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.75, 3.24, 4.73, 4.61, 3.74, 76.00, 62.00, 66.20, 'D', 'medium', 'medium', ARRAY['Team player baik', 'Bertanggung jawab'], ARRAY['Tingkatkan komunikasi'] FROM employees e WHERE e.nip = 'E001';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.90, 3.99, 4.25, 4.79, 4.26, 84.00, 72.00, 75.60, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Team player baik', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'E002';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.46, 3.07, 3.66, 3.64, 4.27, 61.00, 81.00, 75.00, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Problem solver handal'], ARRAY['Tingkatkan komunikasi'] FROM employees e WHERE e.nip = 'E003';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.20, 4.82, 3.13, 3.22, 4.07, 74.00, 88.00, 83.80, 'B', 'medium', 'medium', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Problem solver handal'], ARRAY['Lebih aktif kolaborasi', 'Tingkatkan akuntabilitas'] FROM employees e WHERE e.nip = 'E004';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.31, 3.52, 3.62, 3.46, 3.18, 79.00, 65.00, 69.20, 'D', 'high', 'low', ARRAY['Konsisten dalam bekerja'], ARRAY['Tingkatkan leadership', 'Tingkatkan akuntabilitas', 'Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'E005';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.31, 4.33, 3.65, 3.85, 4.67, 74.00, 71.00, 71.90, 'C', 'medium', 'medium', ARRAY['Komunikasi efektif', 'Problem solver handal'], ARRAY['Tingkatkan leadership'] FROM employees e WHERE e.nip = 'E006';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.12, 3.62, 4.46, 4.64, 3.64, 84.00, 62.00, 68.60, 'D', 'medium', 'medium', ARRAY['Team player baik', 'Bertanggung jawab'], ARRAY['Tingkatkan leadership'] FROM employees e WHERE e.nip = 'E007';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.73, 4.04, 4.28, 4.72, 3.37, 75.00, 70.00, 71.50, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Team player baik', 'Bertanggung jawab'], ARRAY['Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'E008';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.20, 4.09, 4.77, 3.01, 3.08, 65.00, 88.00, 81.10, 'B', 'medium', 'medium', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Team player baik'], ARRAY['Tingkatkan akuntabilitas', 'Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'E009';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.42, 3.37, 3.94, 4.02, 4.18, 75.00, 89.00, 84.80, 'B', 'medium', 'medium', ARRAY['Leadership kuat', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Tingkatkan komunikasi'] FROM employees e WHERE e.nip = 'E010';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.04, 4.94, 3.24, 3.83, 4.36, 92.00, 94.00, 93.40, 'A', 'medium', 'medium', ARRAY['Komunikasi efektif', 'Problem solver handal'], ARRAY['Tingkatkan leadership', 'Lebih aktif kolaborasi'] FROM employees e WHERE e.nip = 'E011';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.94, 4.55, 4.43, 3.44, 3.03, 72.00, 94.00, 87.40, 'B', 'low', 'high', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Team player baik'], ARRAY['Tingkatkan akuntabilitas', 'Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'E012';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.66, 4.88, 4.52, 3.24, 4.02, 82.00, 79.00, 79.90, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Team player baik', 'Problem solver handal'], ARRAY['Tingkatkan akuntabilitas'] FROM employees e WHERE e.nip = 'E013';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.42, 4.79, 4.12, 3.68, 3.45, 73.00, 62.00, 65.30, 'D', 'medium', 'medium', ARRAY['Komunikasi efektif', 'Team player baik'], ARRAY['Tingkatkan leadership', 'Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'E014';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.36, 4.20, 4.54, 4.89, 4.29, 84.00, 63.00, 69.30, 'D', 'medium', 'medium', ARRAY['Komunikasi efektif', 'Team player baik', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Tingkatkan leadership'] FROM employees e WHERE e.nip = 'E015';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.37, 4.84, 3.99, 3.65, 3.35, 68.00, 92.00, 84.80, 'B', 'medium', 'medium', ARRAY['Komunikasi efektif'], ARRAY['Tingkatkan leadership', 'Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'E016';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.61, 3.18, 4.05, 4.04, 4.38, 74.00, 75.00, 74.70, 'C', 'medium', 'medium', ARRAY['Team player baik', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Tingkatkan komunikasi'] FROM employees e WHERE e.nip = 'E017';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.05, 3.39, 3.86, 4.41, 3.77, 62.00, 93.00, 83.70, 'B', 'medium', 'medium', ARRAY['Leadership kuat', 'Bertanggung jawab'], ARRAY['Tingkatkan komunikasi'] FROM employees e WHERE e.nip = 'E018';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.86, 3.09, 3.05, 3.73, 4.87, 80.00, 79.00, 79.30, 'C', 'medium', 'medium', ARRAY['Problem solver handal'], ARRAY['Tingkatkan komunikasi', 'Lebih aktif kolaborasi'] FROM employees e WHERE e.nip = 'E019';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.58, 3.65, 3.22, 4.94, 3.28, 82.00, 68.00, 72.20, 'C', 'medium', 'medium', ARRAY['Bertanggung jawab'], ARRAY['Lebih aktif kolaborasi', 'Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'E020';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.22, 3.78, 3.06, 4.92, 3.68, 79.00, 73.00, 74.80, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Bertanggung jawab'], ARRAY['Lebih aktif kolaborasi'] FROM employees e WHERE e.nip = 'E021';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.28, 3.54, 4.27, 3.50, 3.23, 93.00, 84.00, 86.70, 'B', 'medium', 'medium', ARRAY['Team player baik'], ARRAY['Tingkatkan leadership', 'Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'E022';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.58, 4.66, 3.63, 3.99, 4.85, 69.00, 75.00, 73.20, 'C', 'medium', 'medium', ARRAY['Komunikasi efektif', 'Problem solver handal'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'E023';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.73, 3.71, 4.02, 3.60, 4.75, 82.00, 91.00, 88.30, 'B', 'medium', 'medium', ARRAY['Team player baik', 'Problem solver handal'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'E024';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.91, 3.56, 4.82, 3.57, 3.52, 86.00, 92.00, 90.20, 'A', 'medium', 'medium', ARRAY['Team player baik'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'E025';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.57, 4.09, 3.50, 3.07, 4.32, 72.00, 94.00, 87.40, 'B', 'medium', 'medium', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Problem solver handal'], ARRAY['Lebih aktif kolaborasi', 'Tingkatkan akuntabilitas'] FROM employees e WHERE e.nip = 'E026';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.40, 3.28, 3.82, 4.22, 4.63, 86.00, 75.00, 78.30, 'C', 'medium', 'medium', ARRAY['Bertanggung jawab', 'Problem solver handal'], ARRAY['Tingkatkan leadership', 'Tingkatkan komunikasi'] FROM employees e WHERE e.nip = 'E027';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.03, 4.60, 4.51, 4.01, 4.11, 77.00, 68.00, 70.70, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Team player baik', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'E028';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.18, 3.15, 3.46, 3.10, 4.06, 87.00, 80.00, 82.10, 'B', 'medium', 'medium', ARRAY['Leadership kuat', 'Problem solver handal'], ARRAY['Tingkatkan komunikasi', 'Lebih aktif kolaborasi', 'Tingkatkan akuntabilitas'] FROM employees e WHERE e.nip = 'E029';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.09, 4.97, 3.15, 3.56, 3.48, 68.00, 64.00, 65.20, 'D', 'medium', 'medium', ARRAY['Komunikasi efektif'], ARRAY['Tingkatkan leadership', 'Lebih aktif kolaborasi', 'Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'E030';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.22, 4.54, 3.58, 4.82, 3.19, 95.00, 90.00, 91.50, 'A', 'low', 'high', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Bertanggung jawab'], ARRAY['Tingkatkan problem solving'] FROM employees e WHERE e.nip = 'E031';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.34, 3.40, 3.32, 3.48, 4.79, 87.00, 76.00, 79.30, 'C', 'medium', 'medium', ARRAY['Problem solver handal'], ARRAY['Tingkatkan leadership', 'Tingkatkan komunikasi', 'Lebih aktif kolaborasi', 'Tingkatkan akuntabilitas'] FROM employees e WHERE e.nip = 'E032';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.13, 3.01, 4.86, 3.29, 4.80, 65.00, 90.00, 82.50, 'B', 'medium', 'medium', ARRAY['Team player baik', 'Problem solver handal'], ARRAY['Tingkatkan leadership', 'Tingkatkan komunikasi', 'Tingkatkan akuntabilitas'] FROM employees e WHERE e.nip = 'E033';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.90, 4.63, 4.62, 3.98, 4.27, 77.00, 87.00, 84.00, 'B', 'low', 'high', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Team player baik', 'Problem solver handal'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'E034';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.93, 4.41, 4.27, 4.97, 3.68, 95.00, 92.00, 92.90, 'A', 'low', 'high', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Team player baik', 'Bertanggung jawab'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'E035';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.62, 4.46, 4.74, 3.48, 3.70, 92.00, 70.00, 76.60, 'C', 'medium', 'medium', ARRAY['Leadership kuat', 'Komunikasi efektif', 'Team player baik'], ARRAY['Tingkatkan akuntabilitas'] FROM employees e WHERE e.nip = 'E036';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.61, 4.54, 4.61, 4.34, 4.45, 82.00, 61.00, 67.30, 'D', 'medium', 'medium', ARRAY['Komunikasi efektif', 'Team player baik', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Pertahankan performa'] FROM employees e WHERE e.nip = 'E037';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.20, 3.15, 3.37, 4.52, 4.79, 75.00, 61.00, 65.20, 'D', 'medium', 'medium', ARRAY['Bertanggung jawab', 'Problem solver handal'], ARRAY['Tingkatkan leadership', 'Tingkatkan komunikasi', 'Lebih aktif kolaborasi'] FROM employees e WHERE e.nip = 'E038';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 4.37, 3.72, 4.79, 3.48, 4.77, 79.00, 89.00, 86.00, 'B', 'low', 'high', ARRAY['Leadership kuat', 'Team player baik', 'Problem solver handal'], ARRAY['Tingkatkan akuntabilitas'] FROM employees e WHERE e.nip = 'E039';

INSERT INTO feedback_summaries (id, cycle_id, employee_id, leadership_score, communication_score, collaboration_score, accountability_score, problem_solving_score, overall_360_score, kpi_score, final_score, final_grade, burnout_risk, promotion_potential, strengths, weaknesses) SELECT gen_random_uuid(), '7b8c9563-60e3-4e11-9233-5ef98fec9dc8', e.id, 3.88, 3.23, 4.08, 4.46, 4.56, 78.00, 93.00, 88.50, 'B', 'low', 'high', ARRAY['Team player baik', 'Bertanggung jawab', 'Problem solver handal'], ARRAY['Tingkatkan komunikasi'] FROM employees e WHERE e.nip = 'E040';

-- ============================================================
-- VERIFICATION QUERIES (Optional - run after import)
-- ============================================================
-- SELECT COUNT(*) FROM feedback_summaries; -- Should return 80
-- SELECT final_grade, COUNT(*) as count FROM feedback_summaries GROUP BY final_grade ORDER BY final_grade;
