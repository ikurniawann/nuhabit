-- =============================================================================
-- Business hierarchy scoping — Produk master (Branch level)
--   item.products → company_id + branch_id
--
-- Produk (menu) berada di level Branch (menu bisa berbeda per outlet),
-- company_id diikutkan untuk filter cepat & konsistensi hierarki.
--
-- Scope kombinasi:
--   company_id NULL & branch_id NULL  = template global
--   company_id set  & branch_id NULL  = master level company
--   company_id set  & branch_id set   = master khusus branch
--
-- Unique kode di-scope per (company, branch) memakai sentinel UUID agar NULL
-- ikut diperhitungkan.
-- =============================================================================

ALTER TABLE item.products
    ADD COLUMN IF NOT EXISTS company_id uuid,
    ADD COLUMN IF NOT EXISTS branch_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'products_company_id_fkey'
    ) THEN
        ALTER TABLE item.products
            ADD CONSTRAINT products_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES configuration.companies(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'products_branch_id_fkey'
    ) THEN
        ALTER TABLE item.products
            ADD CONSTRAINT products_branch_id_fkey
            FOREIGN KEY (branch_id) REFERENCES configuration.branches(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Ganti unique global lama (kode saja) dengan unique scope-aware
ALTER TABLE item.products DROP CONSTRAINT IF EXISTS products_kode_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_scope_kode
    ON item.products (
        COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(branch_id,  '00000000-0000-0000-0000-000000000000'::uuid),
        kode
    )
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_company_id ON item.products (company_id);
CREATE INDEX IF NOT EXISTS idx_products_branch_id ON item.products (branch_id);

-- -----------------------------------------------------------------------------
-- Sertakan kolom scope di view v_products_cogs (ditambahkan di akhir agar
-- kompatibel dengan CREATE OR REPLACE).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW "public"."v_products_cogs" AS
 SELECT p.id,
    p.kode,
    p.nama,
    p.deskripsi,
    p.kategori,
    p.satuan_id,
    p.harga_jual,
    p.is_active,
    p.created_at,
    p.updated_at,
    p.created_by,
    p.updated_by,
    p.deleted_at,
    p.deleted_by,
    u.nama AS satuan_nama,
    COALESCE(bom.total_bahan, 0::bigint) AS total_bahan_baku,
    COALESCE(bom.estimated_cogs, 0::numeric) AS estimated_cogs,
    COALESCE(bom.estimated_cogs, 0::numeric) AS hpp_estimasi,
    p.harga_modal,
    p.markup_persen,
    p.company_id,
    p.branch_id
   FROM products p
     LEFT JOIN units u ON p.satuan_id = u.id
     LEFT JOIN ( SELECT bi.product_id,
            count(*) AS total_bahan,
            sum(bi.qty_required * (1::numeric + COALESCE(bi.waste_factor, 0::numeric)) * COALESCE(i.unit_cost, 0::numeric)) AS estimated_cogs
           FROM bom_items bi
             LEFT JOIN raw_materials rm ON bi.raw_material_id = rm.id
             LEFT JOIN ( SELECT inventory.raw_material_id,
                    avg(inventory.unit_cost) AS unit_cost
                   FROM inventory
                  WHERE inventory.is_active = true
                  GROUP BY inventory.raw_material_id) i ON rm.id = i.raw_material_id
          WHERE bi.is_active = true
          GROUP BY bi.product_id) bom ON p.id = bom.product_id
  WHERE p.deleted_at IS NULL;
