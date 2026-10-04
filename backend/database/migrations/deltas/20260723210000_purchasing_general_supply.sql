-- =============================================================================
-- EPIC-026 Task A — Purchasing Barang Operasional (module_type ketiga 'general')
--
-- Fondasi domain + master item. Menyalin pola scope 'product' (migrasi
-- 20260702130000 + 20260702140000):
--   1. Longgarkan CHECK module_type di purchase_requests & purchase_orders.
--   2. Master item baru item.supply_items (+ kategori) ber-flag `stockable`.
--   3. Kolom FK supply_item_id di purchase_order_items & pr_items; relaksasi
--      diskriminan item PO jadi "tepat satu dari tiga" via num_nonnulls().
--
-- Konvensi mengikuti master yang ADA (bukan spec idealis epic): kategori =
-- varchar denormalisasi (seperti raw_materials.kategori/products.kategori),
-- unit = satuan_id FK ke item.units. pr_items tidak punya CHECK diskriminan
-- (FK nullable saja) sehingga cukup tambah kolom. View v_purchase_orders
-- adalah level header (join vendor sudah ada) → tak perlu diubah.
-- Idempoten: aman dijalankan ulang.
-- =============================================================================

-- ── 1. module_type: tambah nilai 'general' ──────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requests_module_type_check') THEN
        ALTER TABLE purchasing.purchase_requests DROP CONSTRAINT purchase_requests_module_type_check;
    END IF;
    ALTER TABLE purchasing.purchase_requests
        ADD CONSTRAINT purchase_requests_module_type_check
        CHECK (module_type = ANY (ARRAY['raw_material'::text, 'product'::text, 'general'::text]));
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_module_type_check') THEN
        ALTER TABLE purchasing.purchase_orders DROP CONSTRAINT purchase_orders_module_type_check;
    END IF;
    ALTER TABLE purchasing.purchase_orders
        ADD CONSTRAINT purchase_orders_module_type_check
        CHECK (module_type = ANY (ARRAY['raw_material'::text, 'product'::text, 'general'::text]));
END $$;

-- ── 2. Master kategori barang operasional (mirror raw_material_categories) ───
CREATE TABLE IF NOT EXISTS item.supply_categories (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        varchar NOT NULL,
    nama        varchar NOT NULL,
    deskripsi   text,
    is_active   boolean DEFAULT true,
    company_id  uuid,
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now(),
    created_by  uuid,
    updated_by  uuid,
    deleted_at  timestamptz,
    deleted_by  uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS supply_categories_company_code_uq
    ON item.supply_categories (company_id, code)
    WHERE deleted_at IS NULL;

-- ── 3. Master item barang operasional ───────────────────────────────────────
-- stockable=false → di-expense saat diterima (ATK habis pakai);
-- stockable=true  → masuk inventory (spare part disimpan) — flow di Task C.
CREATE TABLE IF NOT EXISTS item.supply_items (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kode          varchar NOT NULL,
    nama          varchar NOT NULL,
    deskripsi     text,
    kategori      varchar,                      -- kode kategori (denormalisasi, pola master lain)
    satuan_id     uuid,                         -- FK item.units (satuan beli)
    stockable     boolean NOT NULL DEFAULT false,
    harga_beli    numeric NOT NULL DEFAULT 0,   -- harga beli terakhir/estimasi
    stok_minimum  numeric DEFAULT 0,            -- hanya relevan bila stockable
    is_active     boolean DEFAULT true,
    company_id    uuid,
    branch_id     uuid,
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now(),
    created_by    uuid,
    updated_by    uuid,
    deleted_at    timestamptz,
    deleted_by    uuid
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supply_items_satuan_id_fkey') THEN
        ALTER TABLE item.supply_items
            ADD CONSTRAINT supply_items_satuan_id_fkey
            FOREIGN KEY (satuan_id) REFERENCES item.units(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS supply_items_tenant_kode_uq
    ON item.supply_items (company_id, branch_id, kode)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_supply_items_tenant
    ON item.supply_items (company_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_supply_items_stockable
    ON item.supply_items (stockable);

-- ── 4. purchase_order_items: kolom supply_item_id + diskriminan 3-arah ───────
ALTER TABLE purchasing.purchase_order_items
    ADD COLUMN IF NOT EXISTS supply_item_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_items_supply_item_id_fkey') THEN
        ALTER TABLE purchasing.purchase_order_items
            ADD CONSTRAINT purchase_order_items_supply_item_id_fkey
            FOREIGN KEY (supply_item_id) REFERENCES item.supply_items(id) ON DELETE RESTRICT;
    END IF;
END $$;

-- Relaksasi XOR (raw_material xor product) → tepat SATU dari tiga target item.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_items_item_target_check') THEN
        ALTER TABLE purchasing.purchase_order_items DROP CONSTRAINT purchase_order_items_item_target_check;
    END IF;
    ALTER TABLE purchasing.purchase_order_items
        ADD CONSTRAINT purchase_order_items_item_target_check
        CHECK (num_nonnulls(raw_material_id, product_id, supply_item_id) = 1);
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_supply_item_id
    ON purchasing.purchase_order_items (supply_item_id);

-- ── 5. pr_items: kolom supply_item_id (tanpa CHECK diskriminan — FK nullable) ─
ALTER TABLE purchasing.pr_items
    ADD COLUMN IF NOT EXISTS supply_item_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pr_items_supply_item_id_fkey') THEN
        ALTER TABLE purchasing.pr_items
            ADD CONSTRAINT pr_items_supply_item_id_fkey
            FOREIGN KEY (supply_item_id) REFERENCES item.supply_items(id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pr_items_supply_item_id
    ON purchasing.pr_items (supply_item_id);

-- ── Dokumentasi kolom ───────────────────────────────────────────────────────
COMMENT ON TABLE item.supply_items IS 'Master barang operasional (non-F&B, non-jual) — EPIC-026';
COMMENT ON COLUMN item.supply_items.stockable IS 'true = dilacak stok via inventory; false = di-expense saat diterima';
COMMENT ON COLUMN purchasing.purchase_order_items.supply_item_id IS 'Target item scope general (barang operasional) — EPIC-026';
COMMENT ON COLUMN purchasing.pr_items.supply_item_id IS 'Target item scope general (barang operasional) — EPIC-026';
