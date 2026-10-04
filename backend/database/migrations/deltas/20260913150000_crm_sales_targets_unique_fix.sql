-- EPIC-050 Fase 3 fix: UNIQUE (…, pipeline_id) tidak mencegah duplikat saat
-- pipeline_id NULL (NULL ≠ NULL). Ganti dengan unique index ber-COALESCE dan
-- bersihkan duplikat yang sudah terlanjur (pertahankan baris terbaru).
DELETE FROM crm.crm_sales_targets t
USING crm.crm_sales_targets d
WHERE t.company_id = d.company_id AND t.user_id = d.user_id AND t.period_month = d.period_month
  AND t.pipeline_id IS NULL AND d.pipeline_id IS NULL AND t.created_at < d.created_at;
ALTER TABLE crm.crm_sales_targets DROP CONSTRAINT IF EXISTS crm_sales_targets_company_id_user_id_period_month_pipeline_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_sales_targets_period
  ON crm.crm_sales_targets (company_id, user_id, period_month, COALESCE(pipeline_id, '00000000-0000-0000-0000-000000000000'::uuid));
