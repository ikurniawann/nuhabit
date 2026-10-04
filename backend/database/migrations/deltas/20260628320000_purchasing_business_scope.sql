-- =============================================================================
-- Business hierarchy scoping — modul Purchasing & Production (level Branch)
--
-- Menambahkan company_id + branch_id ke seluruh tabel master & header transaksi
-- purchasing/produksi. Mengikuti pola raw_materials/products:
--   company_id NULL & branch_id NULL  = template/global
--   company_id set  & branch_id set   = milik branch tertentu
--
-- Catatan:
--   - Nomor dokumen (pr_number, nomor_po, nomor_grn, dst.) tetap unik global
--     karena di-generate dengan prefix unik, sehingga unique constraint lama
--     dibiarkan.
--   - Hanya master ber-"kode" (suppliers, vendors) yang unique-nya dibuat
--     scope-aware per (company, branch).
-- =============================================================================

DO $$
DECLARE
    targets text[] := ARRAY[
        'purchasing.suppliers',
        'purchasing.vendors',
        'purchasing.supplier_price_lists',
        'purchasing.vendor_payments',
        'purchasing.purchase_requests',
        'purchasing.purchase_orders',
        'purchasing.deliveries',
        'purchasing.grn',
        'purchasing.goods_receipts',
        'purchasing.returns',
        'purchasing.purchase_returns',
        'purchasing.qc_inspections',
        'manufacturing.production_orders'
    ];
    tbl text;
    tname text;
BEGIN
    FOREACH tbl IN ARRAY targets LOOP
        IF to_regclass(tbl) IS NULL THEN
            CONTINUE;
        END IF;
        tname := split_part(tbl, '.', 2);

        EXECUTE format(
            'ALTER TABLE %s ADD COLUMN IF NOT EXISTS company_id uuid, ADD COLUMN IF NOT EXISTS branch_id uuid',
            tbl
        );

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = tname || '_company_id_fkey') THEN
            EXECUTE format(
                'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (company_id) REFERENCES configuration.companies(id) ON DELETE SET NULL',
                tbl, tname || '_company_id_fkey'
            );
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = tname || '_branch_id_fkey') THEN
            EXECUTE format(
                'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (branch_id) REFERENCES configuration.branches(id) ON DELETE SET NULL',
                tbl, tname || '_branch_id_fkey'
            );
        END IF;

        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (company_id)', 'idx_' || tname || '_company_id', tbl);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (branch_id)', 'idx_' || tname || '_branch_id', tbl);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Unique kode scope-aware untuk master ber-kode
-- -----------------------------------------------------------------------------

-- suppliers.kode (punya soft delete deleted_at)
ALTER TABLE purchasing.suppliers DROP CONSTRAINT IF EXISTS suppliers_kode_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_scope_kode
    ON purchasing.suppliers (
        COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(branch_id,  '00000000-0000-0000-0000-000000000000'::uuid),
        kode
    )
    WHERE deleted_at IS NULL;

-- vendors.code (tanpa soft delete)
ALTER TABLE purchasing.vendors DROP CONSTRAINT IF EXISTS vendors_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_scope_code
    ON purchasing.vendors (
        COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(branch_id,  '00000000-0000-0000-0000-000000000000'::uuid),
        code
    );
