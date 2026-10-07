-- EPIC-010 Fase A: skema KPI Scorecard + seed katalog indikator DISETUJUI
-- owner 2026-07-19 (skor 0-100 tanpa grade, cadence bulanan semua role).
-- Engine attainment di src/lib/kpi/ (cap 120%, redistribusi bobot minimum-data).

-- ============================================================
-- 1. Katalog indikator (master data)
-- ============================================================
CREATE TABLE IF NOT EXISTS performance.kpi_indicators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(60) NOT NULL UNIQUE,
  name varchar(150) NOT NULL,
  description text,
  unit varchar(30),                                   -- %, hari, rupiah, rasio
  direction varchar(20) NOT NULL
    CHECK (direction IN ('higher_better', 'lower_better', 'boolean')),
  source_kind varchar(10) NOT NULL
    CHECK (source_kind IN ('auto', 'manual')),
  source_ref varchar(60),                             -- modul sumber (hint kolektor)
  default_target numeric(15, 4),                      -- target default sistem (overridable)
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

-- ============================================================
-- 2. Bobot indikator per role (Σ bobot aktif = 100 per role)
-- ============================================================
CREATE TABLE IF NOT EXISTS performance.kpi_role_indicators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_code varchar(50) NOT NULL,
  indicator_id uuid NOT NULL
    REFERENCES performance.kpi_indicators(id) ON DELETE CASCADE,
  weight numeric(5, 2) NOT NULL CHECK (weight >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  UNIQUE (role_code, indicator_id)
);

-- ============================================================
-- 3. Target per periode & scope (resolusi: paling spesifik menang —
--    employee > department > role > default; periode NULL = berlaku umum)
-- ============================================================
CREATE TABLE IF NOT EXISTS performance.kpi_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_id uuid NOT NULL
    REFERENCES performance.kpi_indicators(id) ON DELETE CASCADE,
  period_year int,
  period_month int CHECK (period_month BETWEEN 1 AND 12),
  role_code varchar(50),
  department_id uuid REFERENCES departments(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  target numeric(15, 4) NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_kpi_targets_indicator_period
  ON performance.kpi_targets (indicator_id, period_year, period_month);

-- ============================================================
-- 4. Snapshot aktual per karyawan-indikator-periode (angka BEKU utk audit;
--    pola snapshot payroll — skor tak berubah walau data mentah berubah)
-- ============================================================
CREATE TABLE IF NOT EXISTS performance.kpi_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  indicator_id uuid NOT NULL
    REFERENCES performance.kpi_indicators(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  actual numeric(15, 4),                              -- NULL = data tidak tersedia
  target numeric(15, 4),
  attainment numeric(6, 4),                           -- hasil computeAttainment (NULL = dikeluarkan)
  sample_size numeric(10, 2),                         -- utk aturan minimum data
  source_detail jsonb,                                -- jejak audit ke data sumber
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  UNIQUE (employee_id, indicator_id, period_year, period_month)
);

-- ============================================================
-- 5. Scorecard komposit per karyawan-periode
-- ============================================================
CREATE TABLE IF NOT EXISTS performance.kpi_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  role_code varchar(50) NOT NULL,                     -- role saat snapshot (audit)
  score numeric(5, 2),                                -- 0-100, NULL = semua komponen kosong
  raw_score numeric(6, 2),                            -- sebelum cap 100 (audit over-achievement)
  used_weight numeric(5, 2),
  breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,       -- ScorecardBreakdownRow[]
  status varchar(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'final')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  UNIQUE (employee_id, period_year, period_month)
);

-- ============================================================
-- 6. Seed katalog indikator (disetujui owner 2026-07-19)
-- ============================================================
INSERT INTO performance.kpi_indicators
  (code, name, unit, direction, source_kind, source_ref, default_target, is_active, notes)
VALUES
  -- Umum / absensi
  ('att_ontime',            'Ketepatan Hadir',                    '%',      'higher_better', 'auto',   'hris.attendance',        0.95, true,  'shift on-time / shift terjadwal; cuti approved & libur tidak menghukum'),
  ('att_late_ratio',        'Rasio Menit Telat',                  'rasio',  'lower_better',  'auto',   'hris.attendance',        0.02, true,  'menit telat / menit kerja terjadwal'),
  ('leave_request_discipline','Kepatuhan Pengajuan Cuti/Lembur',  '%',      'higher_better', 'auto',   'hris.leaves',            0.90, true,  'pengajuan sebelum H (bukan susulan) / total pengajuan'),
  ('logbook_compliance',    'Kepatuhan Checklist Logbook',        '%',      'higher_better', 'auto',   'hris.logbook',           0.90, true,  '% item logbook selesai'),
  ('logbook_submitted_daily','Logbook Harian Ter-submit',         '%',      'higher_better', 'auto',   'hris.logbook',           0.95, true,  '% hari kerja dgn logbook submitted'),
  ('supervisor_rubric',     'Penilaian Atasan',                   'skala',  'higher_better', 'manual', 'performance.review',     NULL, true,  'rubrik 1-5 → dinormalisasi /5; dari Performance Review'),
  -- POS
  ('pos_cash_variance',     'Selisih Kas Closing',                'rasio',  'lower_better',  'auto',   'pos.closing',            0.005, true, 'Σ|selisih| / Σ setoran seharusnya; default ≤0,5%'),
  ('pos_sales_shift',       'Sales per Shift Dijaga',             'rupiah', 'higher_better', 'auto',   'pos.orders',             NULL, true,  'actual / target sales shift (target per outlet)'),
  ('pos_void_rate',         'Void/Refund Rate',                   'rasio',  'lower_better',  'auto',   'pos.orders',             0.02, true,  'nilai void / total sales'),
  ('outlet_revenue',        'Omzet Outlet vs Target',             'rupiah', 'higher_better', 'auto',   'pos.dashboard',          NULL, true,  'target di-set super_admin/direksi per outlet'),
  ('outlet_margin',         'Profit Margin Outlet',               '%',      'higher_better', 'auto',   'pos.profit',             NULL, true,  NULL),
  ('team_ontime',           'Disiplin Tim (% On-Time)',           '%',      'higher_better', 'auto',   'hris.attendance',        0.95, true,  'seluruh anggota binaan'),
  ('outlet_cash_variance',  'Total Selisih Kas Outlet',           'rasio',  'lower_better',  'auto',   'pos.closing',            0.005, true, NULL),
  ('closing_validated_ontime','Closing Tervalidasi ≤ H+1',        '%',      'higher_better', 'auto',   'pos.closing',            0.95, true,  NULL),
  -- Inventory / warehouse
  ('opname_accuracy',       'Akurasi Stock Opname',               '%',      'higher_better', 'auto',   'inventory.opname',       0.98, true,  '1 − (|variance| / nilai stok dihitung)'),
  ('opname_variance_pos',   'Selisih Opname Area POS',            'rasio',  'lower_better',  'auto',   'inventory.opname',       0.02, true,  NULL),
  ('grn_speed',             'Kecepatan Pencatatan GRN',           'hari',   'lower_better',  'auto',   'purchasing.grn',         1,    true,  'rata-rata hari barang tiba → GRN dicatat'),
  ('adjustment_unexplained','Adjustment Tak Terjelaskan',         'rasio',  'lower_better',  'auto',   'inventory.adjustment',   0.01, true,  'nilai adjustment non-opname / nilai stok'),
  -- Purchasing
  ('po_fulfillment',        'PO Fulfillment Rate',                '%',      'higher_better', 'auto',   'purchasing.po',          0.95, true,  'qty diterima / qty dipesan (lib po-fulfillment-progress)'),
  ('po_leadtime',           'Lead Time PO → Lengkap',             'hari',   'lower_better',  'auto',   'purchasing.po_grn',      7,    true,  NULL),
  ('vendor_pay_ontime',     'Ketepatan Bayar Vendor',             '%',      'higher_better', 'auto',   'purchasing.payments',    0.95, true,  'dibayar ≤ jatuh tempo / total'),
  ('vendor_pay_sla',        'SLA Proses Vendor Payment',          'hari',   'lower_better',  'auto',   'purchasing.payments',    3,    true,  'rata-rata hari invoice masuk → dibayar'),
  ('price_efficiency',      'Efisiensi Harga Pembelian',          'rasio',  'lower_better',  'auto',   'purchasing.po_history',  NULL, false, '⚠ NONAKTIF - TODO owner 2026-07-19: aktifkan saat baseline harga per item tersedia; kembalikan bobot purchasing_manager ke 20/15/15'),
  -- Finance / payroll
  ('payroll_paid_ontime',   'Payroll Dibayar Tepat Jadwal',       '%',      'higher_better', 'auto',   'hris.payroll',           1,    true,  'paid_at ≤ tanggal gajian / total run'),
  ('payroll_ready_h2',      'Payroll Siap ≤ H-2',                 '%',      'higher_better', 'auto',   'hris.payroll',           1,    true,  'run approved sebelum deadline'),
  -- HRD / recruitment
  ('leave_sla',             'SLA Approval Cuti',                  'hari',   'lower_better',  'auto',   'hris.leaves',            2,    true,  'rata-rata hari pengajuan → keputusan'),
  ('contract_decided_ontime','Kontrak Diputuskan ≤ H-14',         '%',      'higher_better', 'auto',   'hris.contracts',         1,    true,  'PKWT diperpanjang/diputus sebelum jatuh tempo / total'),
  ('time_to_hire',          'Time-to-Hire',                       'hari',   'lower_better',  'auto',   'recruitment.pipeline',   30,   true,  'vacancy buka → offer accepted'),
  ('pipeline_hygiene',      'Kebersihan Pipeline Rekrutmen',      '%',      'higher_better', 'auto',   'recruitment.pipeline',   0.90, true,  '% kandidat tanpa status basi > 7 hari'),
  ('kpi_review_ontime',     'Review KPI Tim Tepat Waktu',         '%',      'higher_better', 'auto',   'performance.kpi',        1,    true,  '% scorecard direview ≤ tgl 5'),
  -- QC
  ('qc_checklist',          'Kepatuhan Checklist QC',             '%',      'higher_better', 'auto',   'hris.logbook',           0.95, true,  'template logbook QC'),
  ('qc_findings_closed',    'Temuan QC Ditindaklanjuti',          '%',      'higher_better', 'manual', 'hris.logbook',           0.90, true,  'sementara manual via notes logbook; tabel temuan = fase lanjut')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 7. Seed bobot per role (Σ = 100 per role; matriks disetujui owner)
-- ============================================================
WITH weights (role_code, indicator_code, weight) AS (
  VALUES
    -- pos (POS Cashier)
    ('pos', 'att_ontime', 20), ('pos', 'pos_cash_variance', 25),
    ('pos', 'pos_sales_shift', 20), ('pos', 'pos_void_rate', 10),
    ('pos', 'logbook_compliance', 10), ('pos', 'supervisor_rubric', 15),
    -- pos_supervisor
    ('pos_supervisor', 'outlet_revenue', 25), ('pos_supervisor', 'outlet_margin', 15),
    ('pos_supervisor', 'team_ontime', 15), ('pos_supervisor', 'outlet_cash_variance', 10),
    ('pos_supervisor', 'logbook_submitted_daily', 10),
    ('pos_supervisor', 'opname_variance_pos', 10), ('pos_supervisor', 'supervisor_rubric', 15),
    -- warehouse_staff / warehouse_admin
    ('warehouse_staff', 'att_ontime', 20), ('warehouse_staff', 'opname_accuracy', 30),
    ('warehouse_staff', 'grn_speed', 15), ('warehouse_staff', 'adjustment_unexplained', 10),
    ('warehouse_staff', 'logbook_compliance', 10), ('warehouse_staff', 'supervisor_rubric', 15),
    ('warehouse_admin', 'att_ontime', 20), ('warehouse_admin', 'opname_accuracy', 30),
    ('warehouse_admin', 'grn_speed', 15), ('warehouse_admin', 'adjustment_unexplained', 10),
    ('warehouse_admin', 'logbook_compliance', 10), ('warehouse_admin', 'supervisor_rubric', 15),
    -- purchasing_staff / purchasing_admin
    ('purchasing_staff', 'po_fulfillment', 30), ('purchasing_staff', 'po_leadtime', 20),
    ('purchasing_staff', 'vendor_pay_ontime', 10), ('purchasing_staff', 'att_ontime', 15),
    ('purchasing_staff', 'logbook_compliance', 10), ('purchasing_staff', 'supervisor_rubric', 15),
    ('purchasing_admin', 'po_fulfillment', 30), ('purchasing_admin', 'po_leadtime', 20),
    ('purchasing_admin', 'vendor_pay_ontime', 10), ('purchasing_admin', 'att_ontime', 15),
    ('purchasing_admin', 'logbook_compliance', 10), ('purchasing_admin', 'supervisor_rubric', 15),
    -- purchasing_manager (redistribusi sementara tanpa price_efficiency —
    -- lihat TODO di kpi_indicators.price_efficiency)
    ('purchasing_manager', 'po_fulfillment', 30), ('purchasing_manager', 'po_leadtime', 20),
    ('purchasing_manager', 'vendor_pay_ontime', 15), ('purchasing_manager', 'att_ontime', 10),
    ('purchasing_manager', 'logbook_compliance', 10), ('purchasing_manager', 'supervisor_rubric', 15),
    -- finance_staff
    ('finance_staff', 'payroll_paid_ontime', 25), ('finance_staff', 'vendor_pay_sla', 20),
    ('finance_staff', 'closing_validated_ontime', 20), ('finance_staff', 'att_ontime', 15),
    ('finance_staff', 'supervisor_rubric', 20),
    -- hrd
    ('hrd', 'leave_sla', 20), ('hrd', 'payroll_ready_h2', 15),
    ('hrd', 'contract_decided_ontime', 15), ('hrd', 'time_to_hire', 10),
    ('hrd', 'pipeline_hygiene', 5), ('hrd', 'kpi_review_ontime', 10),
    ('hrd', 'att_ontime', 10), ('hrd', 'supervisor_rubric', 15),
    -- hiring_manager
    ('hiring_manager', 'time_to_hire', 40), ('hiring_manager', 'pipeline_hygiene', 20),
    ('hiring_manager', 'kpi_review_ontime', 15), ('hiring_manager', 'att_ontime', 10),
    ('hiring_manager', 'supervisor_rubric', 15),
    -- qc_staff
    ('qc_staff', 'att_ontime', 25), ('qc_staff', 'qc_checklist', 35),
    ('qc_staff', 'qc_findings_closed', 15), ('qc_staff', 'supervisor_rubric', 25),
    -- employee (scorecard minimum)
    ('employee', 'att_ontime', 30), ('employee', 'att_late_ratio', 15),
    ('employee', 'leave_request_discipline', 15), ('employee', 'logbook_compliance', 10),
    ('employee', 'supervisor_rubric', 30)
)
INSERT INTO performance.kpi_role_indicators (role_code, indicator_id, weight)
SELECT w.role_code, i.id, w.weight
FROM weights w
JOIN performance.kpi_indicators i ON i.code = w.indicator_code
ON CONFLICT (role_code, indicator_id) DO NOTHING;
