-- Konfigurasi KPI per DEPARTEMEN (permintaan owner 2026-08-31 —
-- menggantikan konfigurasi per peran di halaman Konfigurasi KPI).
-- Mesin snapshot memakai pemetaan departemen bila ada; departemen yang
-- belum dikonfigurasi memakai pemetaan peran lama sebagai bawaan,
-- sehingga scorecard berjalan tidak pernah terputus.

CREATE TABLE IF NOT EXISTS performance.kpi_department_indicators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES hris.departments(id),
  indicator_id uuid NOT NULL REFERENCES performance.kpi_indicators(id),
  weight numeric(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
  updated_by varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, indicator_id)
);
CREATE INDEX IF NOT EXISTS idx_kpi_dept_indicators_dept
  ON performance.kpi_department_indicators(department_id);

-- Sembunyikan menu KPI Templates, Logbook, dan Logbook List dari sidebar
-- (permintaan owner 2026-08-31). Halaman & datanya tetap ada — hanya tak
-- tampil di menu; bisa dimunculkan lagi dengan is_visible = true.
UPDATE iam.menus SET is_visible = false, updated_at = now()
WHERE code IN (
  'hris.performance.kpi-templates',
  'hris.performance.logbook',
  'hris.performance.logbook-list'
);
