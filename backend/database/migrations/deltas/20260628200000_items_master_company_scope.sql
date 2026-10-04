-- =============================================================================
-- Business hierarchy scoping — Items master data (Company level)
--   item.units                    → company_id (Company scope)
--   item.raw_material_categories  → company_id (Company scope)
--   item.storage_conditions       → company_id (Company scope)
--
-- company_id NULL  = template global (berlaku untuk semua company)
-- company_id <uuid> = master khusus company tersebut
--
-- Unique code di-scope per company. Dua index dipakai agar baris global
-- (company_id IS NULL) tetap unik per kode sementara baris per-company unik
-- per (company_id, kode).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- item.units
-- ---------------------------------------------------------------------------
ALTER TABLE item.units
    ADD COLUMN IF NOT EXISTS company_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'units_company_id_fkey'
    ) THEN
        ALTER TABLE item.units
            ADD CONSTRAINT units_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES configuration.companies(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Buang unique global lama (kode saja) bila masih ada
ALTER TABLE item.units DROP CONSTRAINT IF EXISTS units_kode_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_units_company_kode
    ON item.units (company_id, kode)
    WHERE deleted_at IS NULL AND company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_units_global_kode
    ON item.units (kode)
    WHERE deleted_at IS NULL AND company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_units_company_id ON item.units (company_id);

-- ---------------------------------------------------------------------------
-- item.raw_material_categories
-- ---------------------------------------------------------------------------
ALTER TABLE item.raw_material_categories
    ADD COLUMN IF NOT EXISTS company_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'raw_material_categories_company_id_fkey'
    ) THEN
        ALTER TABLE item.raw_material_categories
            ADD CONSTRAINT raw_material_categories_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES configuration.companies(id) ON DELETE CASCADE;
    END IF;
END $$;

ALTER TABLE item.raw_material_categories DROP CONSTRAINT IF EXISTS raw_material_categories_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rmc_company_code
    ON item.raw_material_categories (company_id, code)
    WHERE deleted_at IS NULL AND company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rmc_global_code
    ON item.raw_material_categories (code)
    WHERE deleted_at IS NULL AND company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_rmc_company_id ON item.raw_material_categories (company_id);

-- ---------------------------------------------------------------------------
-- item.storage_conditions
-- ---------------------------------------------------------------------------
ALTER TABLE item.storage_conditions
    ADD COLUMN IF NOT EXISTS company_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'storage_conditions_company_id_fkey'
    ) THEN
        ALTER TABLE item.storage_conditions
            ADD CONSTRAINT storage_conditions_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES configuration.companies(id) ON DELETE CASCADE;
    END IF;
END $$;

ALTER TABLE item.storage_conditions DROP CONSTRAINT IF EXISTS storage_conditions_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_storage_company_code
    ON item.storage_conditions (company_id, code)
    WHERE deleted_at IS NULL AND company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_storage_global_code
    ON item.storage_conditions (code)
    WHERE deleted_at IS NULL AND company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_storage_company_id ON item.storage_conditions (company_id);
