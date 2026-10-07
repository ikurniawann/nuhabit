-- =============================================================================
-- Business hierarchy scoping — Raw Material master (Branch level)
--   item.raw_materials → company_id + branch_id
--
-- Bahan baku berada di level Branch (daftar bahan bisa berbeda per outlet),
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

ALTER TABLE item.raw_materials
    ADD COLUMN IF NOT EXISTS company_id uuid,
    ADD COLUMN IF NOT EXISTS branch_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'raw_materials_company_id_fkey'
    ) THEN
        ALTER TABLE item.raw_materials
            ADD CONSTRAINT raw_materials_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES configuration.companies(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'raw_materials_branch_id_fkey'
    ) THEN
        ALTER TABLE item.raw_materials
            ADD CONSTRAINT raw_materials_branch_id_fkey
            FOREIGN KEY (branch_id) REFERENCES configuration.branches(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Ganti unique global lama (kode saja) dengan unique scope-aware
ALTER TABLE item.raw_materials DROP CONSTRAINT IF EXISTS raw_materials_kode_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_materials_scope_kode
    ON item.raw_materials (
        COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(branch_id,  '00000000-0000-0000-0000-000000000000'::uuid),
        kode
    )
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_raw_materials_company_id ON item.raw_materials (company_id);
CREATE INDEX IF NOT EXISTS idx_raw_materials_branch_id ON item.raw_materials (branch_id);
