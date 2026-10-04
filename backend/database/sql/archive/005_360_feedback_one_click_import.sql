-- ============================================================
-- 360° FEEDBACK SYSTEM - ONE CLICK IMPORT
-- Copy paste semua isi file ini ke psql atau SQL client
-- ============================================================

-- ============================================================
-- STEP 1: CREATE CORE SCHEMA (8 Tables)
-- ============================================================

-- 1. FEEDBACK CATEGORIES
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

-- 2. FEEDBACK CRITERIA
CREATE TABLE IF NOT EXISTS feedback_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES feedback_categories(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  description text,
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 3. FEEDBACK CYCLES
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

-- 4. FEEDBACK ASSIGNMENTS
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

-- 5. FEEDBACK RESPONSES
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

-- 6. FEEDBACK SUMMARIES
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

-- 7. DEVELOPMENT PLANS
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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_feedback_cycles_status ON feedback_cycles(status);
CREATE INDEX IF NOT EXISTS idx_feedback_assignments_cycle ON feedback_assignments(cycle_id);
CREATE INDEX IF NOT EXISTS idx_feedback_assignments_employee ON feedback_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_feedback_responses_assignment ON feedback_responses(assignment_id);
CREATE INDEX IF NOT EXISTS idx_feedback_summaries_cycle ON feedback_summaries(cycle_id);
CREATE INDEX IF NOT EXISTS idx_feedback_summaries_employee ON feedback_summaries(employee_id);
CREATE INDEX IF NOT EXISTS idx_development_plans_employee ON development_plans(employee_id);

-- Enable RLS
ALTER TABLE feedback_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE development_plans ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow all for now)
DROP POLICY IF EXISTS "allow all feedback_categories" ON feedback_categories;
DROP POLICY IF EXISTS "allow all feedback_criteria" ON feedback_criteria;
DROP POLICY IF EXISTS "allow all feedback_cycles" ON feedback_cycles;
DROP POLICY IF EXISTS "allow all feedback_assignments" ON feedback_assignments;
DROP POLICY IF EXISTS "allow all feedback_responses" ON feedback_responses;
DROP POLICY IF EXISTS "allow all feedback_summaries" ON feedback_summaries;
DROP POLICY IF EXISTS "allow all development_plans" ON development_plans;

CREATE POLICY "allow all feedback_categories" ON feedback_categories FOR ALL USING (true);
CREATE POLICY "allow all feedback_criteria" ON feedback_criteria FOR ALL USING (true);
CREATE POLICY "allow all feedback_cycles" ON feedback_cycles FOR ALL USING (true);
CREATE POLICY "allow all feedback_assignments" ON feedback_assignments FOR ALL USING (true);
CREATE POLICY "allow all feedback_responses" ON feedback_responses FOR ALL USING (true);
CREATE POLICY "allow all feedback_summaries" ON feedback_summaries FOR ALL USING (true);
CREATE POLICY "allow all development_plans" ON development_plans FOR ALL USING (true);

-- ============================================================
-- STEP 2: SEED CATEGORIES & CRITERIA
-- ============================================================

-- Insert Categories
INSERT INTO feedback_categories (name, description, weight, display_order) VALUES
  ('Leadership', 'Kemampuan memimpin, mengarahkan, dan menginspirasi tim', 20.00, 1),
  ('Communication', 'Efektivitas komunikasi verbal dan tertulis', 20.00, 2),
  ('Collaboration', 'Kemampuan bekerja sama dalam tim lintas fungsi', 20.00, 3),
  ('Accountability', 'Tanggung jawab atas hasil dan komitmen', 20.00, 4),
  ('Problem Solving', 'Kemampuan menganalisis dan menyelesaikan masalah', 20.00, 5)
ON CONFLICT (name) DO NOTHING;

-- Insert Criteria (auto-link to categories)
DO $$
DECLARE
  cat_id uuid;
BEGIN
  -- Leadership criteria
  SELECT id INTO cat_id FROM feedback_categories WHERE name = 'Leadership';
  INSERT INTO feedback_criteria (category_id, name, description, display_order) VALUES
    (cat_id, 'Menetapkan arah dan tujuan yang jelas', 'Mampu menetapkan visi dan target yang jelas untuk tim', 1),
    (cat_id, 'Memberikan feedback konstruktif', 'Memberikan masukan yang membangun untuk perkembangan tim', 2),
    (cat_id, 'Menginspirasi dan memotivasi', 'Mampu memotivasi tim untuk mencapai target', 3)
  ON CONFLICT DO NOTHING;

  -- Communication criteria
  SELECT id INTO cat_id FROM feedback_categories WHERE name = 'Communication';
  INSERT INTO feedback_criteria (category_id, name, description, display_order) VALUES
    (cat_id, 'Komunikasi verbal yang efektif', 'Menyampaikan ide dengan jelas dalam diskusi/presentasi', 1),
    (cat_id, 'Komunikasi tertulis yang baik', 'Email, dokumen, dan laporan yang jelas dan terstruktur', 2),
    (cat_id, 'Mendengarkan aktif', 'Mendengarkan dan memahami perspektif orang lain', 3)
  ON CONFLICT DO NOTHING;

  -- Collaboration criteria
  SELECT id INTO cat_id FROM feedback_categories WHERE name = 'Collaboration';
  INSERT INTO feedback_criteria (category_id, name, description, display_order) VALUES
    (cat_id, 'Berbagi pengetahuan', 'Mau berbagi informasi dan expertise dengan tim', 1),
    (cat_id, 'Dukungan kepada rekan tim', 'Membantu rekan tim saat dibutuhkan', 2),
    (cat_id, 'Fleksibilitas dalam tim', 'Mampu beradaptasi dengan berbagai gaya kerja', 3)
  ON CONFLICT DO NOTHING;

  -- Accountability criteria
  SELECT id INTO cat_id FROM feedback_categories WHERE name = 'Accountability';
  INSERT INTO feedback_criteria (category_id, name, description, display_order) VALUES
    (cat_id, 'Memenuhi komitmen', 'Menyelesaikan tugas sesuai janji dan deadline', 1),
    (cat_id, 'Tanggung jawab atas kesalahan', 'Mengakui kesalahan dan belajar darinya', 2),
    (cat_id, 'Inisiatif dan proaktif', 'Tidak menunggu perintah, mengambil inisiatif', 3)
  ON CONFLICT DO NOTHING;

  -- Problem Solving criteria
  SELECT id INTO cat_id FROM feedback_categories WHERE name = 'Problem Solving';
  INSERT INTO feedback_criteria (category_id, name, description, display_order) VALUES
    (cat_id, 'Analisis masalah sistematis', 'Mengidentifikasi akar masalah dengan baik', 1),
    (cat_id, 'Solusi kreatif dan inovatif', 'Menawarkan solusi yang efektif dan kreatif', 2),
    (cat_id, 'Pengambilan keputusan', 'Mampu mengambil keputusan tepat waktu', 3)
  ON CONFLICT DO NOTHING;
END $$;

-- ============================================================
-- STEP 3: CREATE FEEDBACK CYCLE
-- ============================================================

INSERT INTO feedback_cycles (id, name, period_label, start_date, end_date, status, kpi_weight, feedback_weight, is_anonymous, allow_self_assessment, require_manager_review) VALUES
  ('550e8400-e29b-41d4-a716-446655440001', 'Q1 2026 Performance Review', 'Q1 2026', '2026-01-01', '2026-03-31', 'completed', 70.00, 30.00, true, true, true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STEP 4: VERIFY IMPORT
-- ============================================================

-- Check tables created
SELECT 
  '✅ Import Status' as check,
  (SELECT COUNT(*) FROM feedback_categories) as categories,
  (SELECT COUNT(*) FROM feedback_criteria) as criteria,
  (SELECT COUNT(*) FROM feedback_cycles) as cycles,
  (SELECT COUNT(*) FROM feedback_summaries) as summaries;

-- Show cycle info
SELECT 
  '📊 Cycle Info' as info,
  name,
  period_label,
  status,
  kpi_weight || '% + ' || feedback_weight || '%' as weights
FROM feedback_cycles
WHERE id = '550e8400-e29b-41d4-a716-446655440001';

-- Show grade distribution (after data import)
SELECT 
  '📈 Grade Distribution' as metric,
  final_grade as grade,
  COUNT(*) as count
FROM feedback_summaries
GROUP BY final_grade
ORDER BY final_grade;

-- ============================================================
-- NEXT STEP: Import employee data from Excel
-- Run: migrations/004_seed_360_combined.sql
-- ============================================================
