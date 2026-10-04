-- =============================================================================
-- Table: item.product_categories
-- Master kategori produk jadi (lookup Items → Product → Kategori)
--
-- Di-scope per company (sama seperti raw_material_categories & storage_conditions):
--   company_id NULL  = template global (berlaku untuk semua company)
--   company_id <uuid> = master khusus company tersebut
-- =============================================================================

CREATE TABLE IF NOT EXISTS "item"."product_categories" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "code" character varying(30) NOT NULL,
    "nama" character varying(100) NOT NULL,
    "deskripsi" text,
    "company_id" uuid,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "created_by" uuid,
    "updated_by" uuid,
    "deleted_at" timestamp with time zone,
    "deleted_by" uuid
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_categories_pkey'
      AND conrelid = 'item.product_categories'::regclass
  ) THEN
    ALTER TABLE ONLY "item"."product_categories"
      ADD CONSTRAINT "product_categories_pkey" PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_categories_company_id_fkey'
  ) THEN
    ALTER TABLE item.product_categories
      ADD CONSTRAINT product_categories_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES configuration.companies(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Unique code di-scope per company; baris global (company_id NULL) unik per kode.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pc_company_code
    ON item.product_categories (company_id, code)
    WHERE deleted_at IS NULL AND company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pc_global_code
    ON item.product_categories (code)
    WHERE deleted_at IS NULL AND company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_pc_company_id ON item.product_categories (company_id);

CREATE INDEX IF NOT EXISTS idx_product_categories_not_deleted
    ON item.product_categories USING btree (is_active, nama)
    WHERE (deleted_at IS NULL);
