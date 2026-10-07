-- EPIC-050 Fase 1 (T-1.1 + T-1.5 skema): fondasi objek CRM Advance.
--   • crm_accounts  — entitas instansi/perusahaan (B2B) terpisah dari lead
--   • crm_contacts  — PIC lintas account; satu account banyak contact
--   • crm_sales_leads mendapat account_id/contact_id + custom jsonb
--   • crm_sales_activities digeneralisasi menjadi Tasks: subject polimorfik,
--     title, priority, status, recurrence, reminder_at, reminder_channels
--   • migrasi data idempoten: org_name/PIC yang ada → account/contact
-- Keputusan owner 2026-09-13 (lihat docs/epics/EPIC-050-*.md): tenant-scoped
-- (company_id + branch_id WAJIB) mengikuti EPIC-022; email DITUNDA sehingga
-- reminder_channels default hanya wa + in_app.

-- ============================================================
-- 1. Accounts — instansi / perusahaan
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  name varchar(200) NOT NULL,
  account_type varchar(30) NOT NULL DEFAULT 'corporate'
    CHECK (account_type IN ('corporate', 'sekolah', 'komunitas', 'travel-agent',
                            'pemerintah', 'perorangan', 'lainnya')),
  industry varchar(100),
  address text,
  city varchar(100),
  phone varchar(30),
  email varchar(150),
  website varchar(200),
  npwp varchar(40),
  notes text,
  owner_user_id uuid REFERENCES configuration.users(id),
  -- Fase 3: custom fields (registry crm_custom_fields) — nilai disimpan di sini
  custom jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES configuration.users(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Satu nama instansi = satu account aktif per company (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_accounts_company_name
  ON crm.crm_accounts (company_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_accounts_branch ON crm.crm_accounts (branch_id);
CREATE INDEX IF NOT EXISTS idx_crm_accounts_owner ON crm.crm_accounts (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_crm_accounts_type ON crm.crm_accounts (account_type);

-- ============================================================
-- 2. Contacts — PIC; boleh tanpa account (perorangan) tapi umumnya ada
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  account_id uuid REFERENCES crm.crm_accounts(id),
  name varchar(150) NOT NULL,
  title varchar(100),
  -- nomor WA kanonik 62… (normalizePhone di src/lib/sales-funnel/server.ts)
  phone varchar(30) NOT NULL,
  email varchar(150),
  is_primary boolean NOT NULL DEFAULT false,
  -- tautan opsional ke member loyalty (global by design EPIC-011)
  customer_id uuid REFERENCES pos.pos_customers(id),
  notes text,
  owner_user_id uuid REFERENCES configuration.users(id),
  custom jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES configuration.users(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Satu nomor WA = satu contact aktif per company (selaras uq_crm_sales_leads_phone)
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_contacts_company_phone
  ON crm.crm_contacts (company_id, phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_contacts_account ON crm.crm_contacts (account_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_branch ON crm.crm_contacts (branch_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_customer ON crm.crm_contacts (customer_id);

-- ============================================================
-- 3. Leads → tautan ke account/contact + custom
-- ============================================================
ALTER TABLE crm.crm_sales_leads
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES crm.crm_accounts(id),
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES crm.crm_contacts(id),
  ADD COLUMN IF NOT EXISTS custom jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_crm_sales_leads_account ON crm.crm_sales_leads (account_id);
CREATE INDEX IF NOT EXISTS idx_crm_sales_leads_contact ON crm.crm_sales_leads (contact_id);

ALTER TABLE crm.crm_sales_deals
  ADD COLUMN IF NOT EXISTS custom jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================
-- 4. Migrasi data: org_name → account, PIC → contact (idempoten)
-- ============================================================
-- 4a. Account per (company, lower(org_name)) — ambil lead tertua sebagai sumber
INSERT INTO crm.crm_accounts
  (company_id, branch_id, name, account_type, city, owner_user_id, created_by, created_at)
SELECT DISTINCT ON (l.company_id, lower(l.org_name))
       l.company_id, l.branch_id, l.org_name, l.org_type, l.city,
       l.owner_user_id, l.created_by, l.created_at
FROM crm.crm_sales_leads l
WHERE l.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM crm.crm_accounts a
    WHERE a.company_id = l.company_id
      AND lower(a.name) = lower(l.org_name)
      AND a.deleted_at IS NULL
  )
ORDER BY l.company_id, lower(l.org_name), l.created_at ASC;

-- 4b. Contact per (company, pic_phone) — lead tertua sebagai sumber
INSERT INTO crm.crm_contacts
  (company_id, branch_id, account_id, name, title, phone, email, is_primary,
   customer_id, owner_user_id, created_by, created_at)
SELECT DISTINCT ON (l.company_id, l.pic_phone)
       l.company_id, l.branch_id, a.id, l.pic_name, l.pic_title, l.pic_phone,
       NULLIF(l.pic_email, ''), true, l.customer_id, l.owner_user_id,
       l.created_by, l.created_at
FROM crm.crm_sales_leads l
LEFT JOIN crm.crm_accounts a
  ON a.company_id = l.company_id
 AND lower(a.name) = lower(l.org_name)
 AND a.deleted_at IS NULL
WHERE l.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM crm.crm_contacts c
    WHERE c.company_id = l.company_id
      AND c.phone = l.pic_phone
      AND c.deleted_at IS NULL
  )
ORDER BY l.company_id, l.pic_phone, l.created_at ASC;

-- 4c. Tautkan lead ke account & contact
UPDATE crm.crm_sales_leads l
SET account_id = a.id, updated_at = now()
FROM crm.crm_accounts a
WHERE l.account_id IS NULL
  AND a.company_id = l.company_id
  AND lower(a.name) = lower(l.org_name)
  AND a.deleted_at IS NULL;

UPDATE crm.crm_sales_leads l
SET contact_id = c.id, updated_at = now()
FROM crm.crm_contacts c
WHERE l.contact_id IS NULL
  AND c.company_id = l.company_id
  AND c.phone = l.pic_phone
  AND c.deleted_at IS NULL;

-- Hanya satu contact utama per account
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY account_id ORDER BY created_at ASC) AS rn
  FROM crm.crm_contacts WHERE account_id IS NOT NULL AND deleted_at IS NULL
)
UPDATE crm.crm_contacts c SET is_primary = (r.rn = 1)
FROM ranked r WHERE r.id = c.id AND c.is_primary IS DISTINCT FROM (r.rn = 1);

-- ============================================================
-- 5. Activities → Tasks (generalisasi, kompatibel ke belakang)
-- ============================================================
ALTER TABLE crm.crm_sales_activities
  ADD COLUMN IF NOT EXISTS subject_type varchar(20)
    CHECK (subject_type IN ('lead', 'deal', 'account', 'contact', 'member')),
  ADD COLUMN IF NOT EXISTS subject_id uuid,
  ADD COLUMN IF NOT EXISTS title varchar(200),
  ADD COLUMN IF NOT EXISTS priority varchar(10) NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  -- {"freq":"daily|weekly|monthly","interval":1,"until":"YYYY-MM-DD"|null}
  ADD COLUMN IF NOT EXISTS recurrence jsonb,
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES crm.crm_sales_activities(id),
  ADD COLUMN IF NOT EXISTS reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_channels jsonb NOT NULL DEFAULT '["wa","in_app"]'::jsonb,
  ADD COLUMN IF NOT EXISTS in_app_notified_at timestamptz;

-- Jenis aktivitas diperluas: 'tugas' (task umum) dan 'email' (log manual; kirim
-- email sesungguhnya menyusul Fase 7)
ALTER TABLE crm.crm_sales_activities
  DROP CONSTRAINT IF EXISTS crm_sales_activities_activity_type_check;
ALTER TABLE crm.crm_sales_activities
  ADD CONSTRAINT crm_sales_activities_activity_type_check
  CHECK (activity_type IN ('telepon', 'wa', 'meeting', 'catatan', 'tugas', 'email'));

-- Subjek boleh account/contact/member tanpa lead/deal
DO $$
DECLARE conname_found text;
BEGIN
  SELECT conname INTO conname_found
  FROM pg_constraint
  WHERE conrelid = 'crm.crm_sales_activities'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%lead_id IS NOT NULL%deal_id IS NOT NULL%';
  IF conname_found IS NOT NULL THEN
    EXECUTE format('ALTER TABLE crm.crm_sales_activities DROP CONSTRAINT %I', conname_found);
  END IF;
END $$;
ALTER TABLE crm.crm_sales_activities
  ADD CONSTRAINT crm_sales_activities_subject_check
  CHECK (lead_id IS NOT NULL OR deal_id IS NOT NULL OR subject_id IS NOT NULL);

-- Backfill: subjek dari deal/lead, status dari done_at, reminder = due
UPDATE crm.crm_sales_activities
SET subject_type = CASE WHEN deal_id IS NOT NULL THEN 'deal' ELSE 'lead' END,
    subject_id = COALESCE(deal_id, lead_id)
WHERE subject_id IS NULL AND (deal_id IS NOT NULL OR lead_id IS NOT NULL);

UPDATE crm.crm_sales_activities
SET status = 'done'
WHERE done_at IS NOT NULL AND status <> 'done';

UPDATE crm.crm_sales_activities
SET reminder_at = due_at
WHERE reminder_at IS NULL AND due_at IS NOT NULL AND reminder_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_crm_sales_activities_subject
  ON crm.crm_sales_activities (subject_type, subject_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_sales_activities_owner_status
  ON crm.crm_sales_activities (owner_user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_sales_activities_reminder
  ON crm.crm_sales_activities (reminder_at)
  WHERE deleted_at IS NULL AND status IN ('open', 'in_progress') AND reminder_sent_at IS NULL;
