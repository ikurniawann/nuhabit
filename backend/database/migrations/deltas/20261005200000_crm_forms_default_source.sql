-- Public CRM forms defaulted their lead source to 'website', which
-- crm_sales_leads_source_check rejects, so a submission without a known
-- utm_source failed with 400. Web and unknown traffic map to 'lainnya', the
-- existing catch-all, and forms may only default to a valid lead source.
UPDATE crm.crm_forms
   SET default_source = 'lainnya'
 WHERE default_source NOT IN ('wa', 'instagram', 'referral', 'google', 'pameran', 'canvassing', 'lainnya');

ALTER TABLE crm.crm_forms ALTER COLUMN default_source SET DEFAULT 'lainnya';

ALTER TABLE crm.crm_forms DROP CONSTRAINT IF EXISTS crm_forms_default_source_check;
ALTER TABLE crm.crm_forms ADD CONSTRAINT crm_forms_default_source_check
    CHECK (default_source IN ('wa', 'instagram', 'referral', 'google', 'pameran', 'canvassing', 'lainnya'));
