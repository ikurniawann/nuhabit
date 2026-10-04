-- =============================================================================
-- User business scope: Holding → Company → Branch data visibility
-- =============================================================================

ALTER TABLE configuration.users
    ADD COLUMN IF NOT EXISTS business_scope text,
    ADD COLUMN IF NOT EXISTS holding_id uuid,
    ADD COLUMN IF NOT EXISTS company_id uuid,
    ADD COLUMN IF NOT EXISTS branch_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_business_scope_check'
    ) THEN
        ALTER TABLE configuration.users
            ADD CONSTRAINT users_business_scope_check
            CHECK (business_scope IS NULL OR business_scope = ANY (ARRAY['holding'::text, 'company'::text, 'branch'::text]));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_holding_id_fkey'
    ) THEN
        ALTER TABLE configuration.users
            ADD CONSTRAINT users_holding_id_fkey
            FOREIGN KEY (holding_id) REFERENCES configuration.holdings(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_company_id_fkey'
    ) THEN
        ALTER TABLE configuration.users
            ADD CONSTRAINT users_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES configuration.companies(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_branch_id_fkey'
    ) THEN
        ALTER TABLE configuration.users
            ADD CONSTRAINT users_branch_id_fkey
            FOREIGN KEY (branch_id) REFERENCES configuration.branches(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_business_scope ON configuration.users(business_scope);
CREATE INDEX IF NOT EXISTS idx_users_holding_id ON configuration.users(holding_id);
CREATE INDEX IF NOT EXISTS idx_users_company_id ON configuration.users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_branch_id ON configuration.users(branch_id);
