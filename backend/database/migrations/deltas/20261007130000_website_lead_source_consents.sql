-- Public site trial funnel: 'website' becomes a real lead source, each
-- marketing consent a prospect gives is recorded, and branches get the slug
-- the public site addresses them by.

-- 1. 'website' joins the lead sources (crm_sales_leads and the form default).
ALTER TABLE crm.crm_sales_leads DROP CONSTRAINT IF EXISTS crm_sales_leads_source_check;
ALTER TABLE crm.crm_sales_leads ADD CONSTRAINT crm_sales_leads_source_check
    CHECK (source IN ('wa', 'instagram', 'referral', 'google', 'pameran', 'canvassing', 'website', 'lainnya'));

ALTER TABLE crm.crm_forms DROP CONSTRAINT IF EXISTS crm_forms_default_source_check;
ALTER TABLE crm.crm_forms ADD CONSTRAINT crm_forms_default_source_check
    CHECK (default_source IN ('wa', 'instagram', 'referral', 'google', 'pameran', 'canvassing', 'website', 'lainnya'));
ALTER TABLE crm.crm_forms ALTER COLUMN default_source SET DEFAULT 'website';

-- A form decides how warm its leads start (the franchise form is hot).
ALTER TABLE crm.crm_forms ADD COLUMN IF NOT EXISTS lead_temperature varchar(10) NOT NULL DEFAULT 'hangat';
ALTER TABLE crm.crm_forms DROP CONSTRAINT IF EXISTS crm_forms_lead_temperature_check;
ALTER TABLE crm.crm_forms ADD CONSTRAINT crm_forms_lead_temperature_check
    CHECK (lead_temperature IN ('panas', 'hangat', 'dingin'));

-- 2. Consents: one row per channel per submission, with the proof a
-- regulator asks for (text version, hashed IP, user agent, page).
CREATE TABLE IF NOT EXISTS crm.lead_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES crm.crm_sales_leads(id) ON DELETE CASCADE,
  channel varchar(10) NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  granted boolean NOT NULL,
  consent_text_version text NOT NULL,
  ip_hash varchar(64),
  user_agent varchar(300),
  source_path varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_consents_lead ON crm.lead_consents (lead_id, created_at DESC);

-- 3. Branch slug for public URLs (/locations/<slug>, timetable, trial).
ALTER TABLE configuration.branches ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS branches_slug_unique ON configuration.branches (slug) WHERE slug IS NOT NULL;
