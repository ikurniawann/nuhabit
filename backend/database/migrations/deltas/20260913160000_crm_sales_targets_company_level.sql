-- EPIC-050 Fase 3 lanjutan: target perusahaan per bulan.
-- user_id NULL = target perusahaan (seluruh tim) untuk periode/pipeline tsb.
ALTER TABLE crm.crm_sales_targets ALTER COLUMN user_id DROP NOT NULL;
DROP INDEX IF EXISTS crm.uq_crm_sales_targets_period;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_sales_targets_period
  ON crm.crm_sales_targets (
    company_id,
    COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_month,
    COALESCE(pipeline_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
COMMENT ON COLUMN crm.crm_sales_targets.user_id IS 'NULL = target perusahaan (bukan per salesperson)';
