-- Backfill venue untuk topup lama yang tersimpan TANPA company/branch
-- (sebelum perbaikan 2026-09-04: topup dari halaman Topup tidak menandai
-- venue, sehingga muncul sebagai "Tanpa venue" di Rekonsiliasi ARK).
--
-- Strategi: tandai ke venue default CRM (crm_settings default_company_id /
-- default_branch_id) — venue yang sama dengan fallback kasir tanpa cabang.
-- Jalankan PREVIEW dulu; UPDATE hanya bila hasil preview sesuai harapan.
-- Opsional & aman diulang (hanya menyentuh baris yang company_id-nya NULL).

-- ===== 1. PREVIEW: apa yang akan ditandai =====
WITH def AS (
  SELECT
    (SELECT trim(both '"' FROM value::text) FROM crm.crm_settings WHERE key = 'default_company_id')::uuid AS company_id,
    (SELECT trim(both '"' FROM value::text) FROM crm.crm_settings WHERE key = 'default_branch_id')::uuid  AS branch_id
)
SELECT w.id, w.type, w.payment_method, w.amount, w.created_at::date,
       co.name AS akan_ke_company, br.name AS akan_ke_branch
FROM pos.pos_wallet_transactions w
CROSS JOIN def
LEFT JOIN configuration.companies co ON co.id = def.company_id
LEFT JOIN configuration.branches br ON br.id = def.branch_id
WHERE w.company_id IS NULL AND w.type IN ('topup', 'topup_bonus')
ORDER BY w.created_at;

-- ===== 2. UPDATE (jalankan setelah preview dicek) =====
-- UPDATE pos.pos_wallet_transactions w
-- SET company_id = (SELECT trim(both '"' FROM value::text) FROM crm.crm_settings WHERE key = 'default_company_id')::uuid,
--     branch_id  = (SELECT trim(both '"' FROM value::text) FROM crm.crm_settings WHERE key = 'default_branch_id')::uuid
-- WHERE w.company_id IS NULL AND w.type IN ('topup', 'topup_bonus');
