-- EPIC-050 Fase 2: Scoring, Workflow Automation & Approval diskon quotation.
--   • crm_events            — log event internal (event bus) → scoring & workflow
--   • crm_scoring_rules     — aturan poin lead (field & event); leads.score
--   • crm_workflow_rules    — trigger → kondisi → aksi; runs; scheduled_actions
--   • crm_approval_rules    — ambang diskon berjenjang (default 10% admin, 20% owner)
--   • crm_approval_requests / steps; quotation: discount_*, approval_status
--   • menu: Lead Scoring, Workflow Rules, Approval Rules (Pengaturan CRM), Approval (Sales)
-- Keputusan owner 2026-09-13: email DITUNDA → sinyal scoring tanpa email;
-- approval process pertama hanya diskon quotation.

-- ============================================================
-- 1. Event bus
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id),
  branch_id uuid REFERENCES configuration.branches(id),
  event_type varchar(60) NOT NULL,          -- lead.created, deal.stage_changed, task.done, ...
  subject_type varchar(20) NOT NULL,        -- lead | deal | account | contact | task | quotation | member
  subject_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_events_subject ON crm.crm_events (subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_events_type ON crm.crm_events (event_type, created_at DESC);

-- ============================================================
-- 2. Lead scoring
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_scoring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id),   -- NULL = berlaku semua company
  name varchar(120) NOT NULL,
  kind varchar(10) NOT NULL CHECK (kind IN ('field', 'event')),
  -- kind=field: field lead (source, org_type, temperature, status, city, pic_email, account_type)
  field varchar(60),
  operator varchar(20) CHECK (operator IN ('eq', 'neq', 'in', 'contains', 'not_empty', 'gt', 'lt')),
  value jsonb,
  -- kind=event: task_done (value = activity_type opsional), wa_inbound, deal_created, quotation_sent
  event_type varchar(60),
  window_days int,                           -- hanya hitung event dalam N hari terakhir (NULL = semua)
  max_count int NOT NULL DEFAULT 1,          -- event dihitung maksimal N kali
  points int NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'field' AND field IS NOT NULL AND operator IS NOT NULL) OR (kind = 'event' AND event_type IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_crm_scoring_rules_company ON crm.crm_scoring_rules (company_id) WHERE is_active;

ALTER TABLE crm.crm_sales_leads
  ADD COLUMN IF NOT EXISTS score int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS score_updated_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_crm_sales_leads_score ON crm.crm_sales_leads (score DESC) WHERE deleted_at IS NULL;

-- Aturan default (global) — bisa diubah dari Pengaturan CRM → Lead Scoring
INSERT INTO crm.crm_scoring_rules (name, kind, field, operator, value, event_type, window_days, max_count, points, sort_order)
SELECT * FROM (VALUES
  ('Sumber: referral',            'field', 'source',      'eq',        '"referral"'::jsonb,            NULL,             NULL, 1, 15, 10),
  ('Sumber: WhatsApp masuk',      'field', 'source',      'eq',        '"wa"'::jsonb,                  NULL,             NULL, 1, 10, 11),
  ('Sumber: Instagram',           'field', 'source',      'eq',        '"instagram"'::jsonb,           NULL,             NULL, 1,  5, 12),
  ('Jenis: corporate/pemerintah', 'field', 'org_type',    'in',        '["corporate","pemerintah"]'::jsonb, NULL,        NULL, 1, 10, 20),
  ('Jenis: sekolah/komunitas',    'field', 'org_type',    'in',        '["sekolah","komunitas"]'::jsonb, NULL,           NULL, 1,  8, 21),
  ('Suhu: panas',                 'field', 'temperature', 'eq',        '"panas"'::jsonb,               NULL,             NULL, 1, 30, 30),
  ('Suhu: hangat',                'field', 'temperature', 'eq',        '"hangat"'::jsonb,              NULL,             NULL, 1, 10, 31),
  ('Email PIC terisi',            'field', 'pic_email',   'not_empty', NULL,                           NULL,             NULL, 1,  5, 40),
  ('Balasan WA (30 hari)',        'event', NULL,          NULL,        NULL,                           'wa_inbound',       30, 3, 10, 50),
  ('Meeting selesai',             'event', NULL,          NULL,        '"meeting"'::jsonb,             'task_done',        90, 2, 20, 51),
  ('Telepon selesai',             'event', NULL,          NULL,        '"telepon"'::jsonb,             'task_done',        90, 3,  5, 52),
  ('Deal dibuat',                 'event', NULL,          NULL,        NULL,                           'deal_created',   NULL, 1, 20, 60),
  ('Quotation terkirim',          'event', NULL,          NULL,        NULL,                           'quotation_sent', NULL, 1, 15, 61)
) AS v(name, kind, field, operator, value, event_type, window_days, max_count, points, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM crm.crm_scoring_rules);

-- ============================================================
-- 3. Workflow automation
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_workflow_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id),   -- NULL = semua company
  name varchar(120) NOT NULL,
  description text,
  object varchar(20) NOT NULL CHECK (object IN ('lead', 'deal', 'account', 'contact', 'task', 'quotation')),
  trigger_type varchar(30) NOT NULL
    CHECK (trigger_type IN ('created', 'updated', 'stage_changed', 'status_changed',
                            'score_reached', 'inactive_days', 'due_soon')),
  -- {"days": 3} utk inactive_days/due_soon, {"score": 70} utk score_reached,
  -- {"to_stage": "nego-survey"} utk stage_changed (opsional)
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{"field":"source","op":"eq","value":"wa"}, ...] — semua harus terpenuhi (AND)
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{"type":"send_wa","to":"owner","message":"..."}, {"type":"create_task",...}, {"type":"wait","hours":24}, ...]
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  run_once_per_record boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  run_count int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_workflow_rules_active ON crm.crm_workflow_rules (object, trigger_type) WHERE is_active;

CREATE TABLE IF NOT EXISTS crm.crm_workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES crm.crm_workflow_rules(id) ON DELETE CASCADE,
  event_id uuid REFERENCES crm.crm_events(id) ON DELETE SET NULL,
  subject_type varchar(20) NOT NULL,
  subject_id uuid NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('success', 'partial', 'failed', 'skipped', 'scheduled')),
  actions_result jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_workflow_runs_rule ON crm.crm_workflow_runs (rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_workflow_runs_subject ON crm.crm_workflow_runs (rule_id, subject_id);

CREATE TABLE IF NOT EXISTS crm.crm_scheduled_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid REFERENCES crm.crm_workflow_rules(id) ON DELETE CASCADE,
  run_id uuid REFERENCES crm.crm_workflow_runs(id) ON DELETE SET NULL,
  company_id uuid,
  branch_id uuid,
  subject_type varchar(20) NOT NULL,
  subject_id uuid NOT NULL,
  -- aksi yang tersisa setelah "wait" (dieksekusi berurutan saat jatuh tempo)
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_at timestamptz NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed', 'cancelled')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_crm_scheduled_actions_due ON crm.crm_scheduled_actions (run_at) WHERE status = 'pending';

-- ============================================================
-- 4. Approval diskon quotation
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_approval_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id),   -- NULL = semua company
  object varchar(20) NOT NULL DEFAULT 'quotation' CHECK (object IN ('quotation')),
  name varchar(120) NOT NULL,
  level int NOT NULL CHECK (level BETWEEN 1 AND 5),
  min_discount_percent numeric(5,2) NOT NULL,   -- diskon > ambang ini butuh tingkat ini
  approver_role varchar(40),                    -- role IAM (admin, super_admin, ...) ATAU
  approver_user_id uuid REFERENCES configuration.users(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (approver_role IS NOT NULL OR approver_user_id IS NOT NULL)
);
INSERT INTO crm.crm_approval_rules (name, level, min_discount_percent, approver_role)
SELECT * FROM (VALUES
  ('Diskon > 10% — persetujuan manajer/admin', 1, 10.00, 'admin'),
  ('Diskon > 20% — persetujuan owner',         2, 20.00, 'super_admin')
) AS v(name, level, min_discount_percent, approver_role)
WHERE NOT EXISTS (SELECT 1 FROM crm.crm_approval_rules);

CREATE TABLE IF NOT EXISTS crm.crm_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid REFERENCES configuration.branches(id),
  object varchar(20) NOT NULL DEFAULT 'quotation',
  subject_id uuid NOT NULL,
  requested_by uuid REFERENCES configuration.users(id),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  current_level int NOT NULL DEFAULT 1,
  discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  amount numeric(14,2),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES configuration.users(id)
);
CREATE INDEX IF NOT EXISTS idx_crm_approval_requests_subject ON crm.crm_approval_requests (object, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_approval_requests_pending ON crm.crm_approval_requests (company_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS crm.crm_approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES crm.crm_approval_requests(id) ON DELETE CASCADE,
  level int NOT NULL,
  approver_role varchar(40),
  approver_user_id uuid REFERENCES configuration.users(id),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
  decided_by uuid REFERENCES configuration.users(id),
  decided_at timestamptz,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_approval_steps_request ON crm.crm_approval_steps (request_id, level);

ALTER TABLE crm.crm_sales_quotations
  ADD COLUMN IF NOT EXISTS discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_nominal numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approval_status varchar(20) NOT NULL DEFAULT 'none'
    CHECK (approval_status IN ('none', 'pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approval_request_id uuid REFERENCES crm.crm_approval_requests(id);

-- ============================================================
-- 5. Menu + grant
-- ============================================================
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('crm.settings.scoring',   'Lead Scoring',   '/dashboard/crm/settings/scoring',   'star',
   'sidebar', 30, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('crm.settings.workflows', 'Workflow Rules', '/dashboard/crm/settings/workflows', 'sitemap',
   'sidebar', 40, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('crm.settings.approvals', 'Approval Rules', '/dashboard/crm/settings/approvals', 'check-circle',
   'sidebar', 50, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('sales-funnel.approvals', 'Approval',       '/dashboard/sales-funnel/approvals', 'clipboard-document-check',
   'sidebar', 45, '{"actions":["read","approve"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'crm' WHERE code LIKE 'crm.settings.%' AND module IS DISTINCT FROM 'crm';
UPDATE iam.menus SET module = 'sales-funnel' WHERE code = 'sales-funnel.approvals';

UPDATE iam.menus child SET parent_id = parent.id, updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'crm.settings'
  AND child.code IN ('crm.settings.scoring', 'crm.settings.workflows', 'crm.settings.approvals');
UPDATE iam.menus child SET parent_id = parent.id, updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'sales-funnel' AND child.code = 'sales-funnel.approvals';

WITH RECURSIVE tree AS (
  SELECT id, 1 AS lvl FROM iam.menus WHERE code = 'crm'
  UNION ALL
  SELECT m.id, t.lvl + 1 FROM iam.menus m JOIN tree t ON m.parent_id = t.id
)
UPDATE iam.menus m SET level = t.lvl, updated_at = now()
FROM tree t WHERE t.id = m.id AND m.level IS DISTINCT FROM t.lvl;

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code IN ('crm.settings.scoring', 'crm.settings.workflows', 'crm.settings.approvals', 'sales-funnel.approvals')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- sales: melihat status approval quotation-nya (inbox hanya menampilkan miliknya)
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'sales' AND m.code = 'sales-funnel.approvals'
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, updated_at = now();
