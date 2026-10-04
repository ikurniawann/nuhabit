-- Buang constraint UNIQUE bawaan (nama terpotong oleh Postgres sehingga DROP di
-- 20260913150000 tidak mengenainya). Unik yang berlaku: uq_crm_sales_targets_period.
ALTER TABLE crm.crm_sales_targets DROP CONSTRAINT IF EXISTS crm_sales_targets_company_id_user_id_period_month_pipeline__key;
ALTER TABLE crm.crm_sales_targets DROP CONSTRAINT IF EXISTS crm_sales_targets_company_id_user_id_period_month_pipeline_id_key;
