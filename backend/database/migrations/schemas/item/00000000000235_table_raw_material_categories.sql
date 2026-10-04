-- =============================================================================
-- Table: item.raw_material_categories
-- Master kategori bahan baku (lookup Items → Raw Material → Kategori)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "item"."raw_material_categories" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "code" character varying(30) NOT NULL,
    "nama" character varying(100) NOT NULL,
    "deskripsi" text,
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
    WHERE conname = 'raw_material_categories_code_key'
      AND conrelid = 'item.raw_material_categories'::regclass
  ) THEN
    ALTER TABLE ONLY "item"."raw_material_categories"
      ADD CONSTRAINT "raw_material_categories_code_key" UNIQUE (code);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'raw_material_categories_pkey'
      AND conrelid = 'item.raw_material_categories'::regclass
  ) THEN
    ALTER TABLE ONLY "item"."raw_material_categories"
      ADD CONSTRAINT "raw_material_categories_pkey" PRIMARY KEY (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_raw_material_categories_not_deleted
  ON item.raw_material_categories USING btree (is_active, nama)
  WHERE (deleted_at IS NULL);
