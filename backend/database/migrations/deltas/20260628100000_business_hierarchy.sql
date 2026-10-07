-- =============================================================================
-- Business hierarchy: Holding → Company → Branch → Warehouse
-- =============================================================================

CREATE TABLE IF NOT EXISTS configuration.holdings (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name text NOT NULL,
    code text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT holdings_code_unique UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS configuration.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    holding_id uuid NOT NULL REFERENCES configuration.holdings(id) ON DELETE CASCADE,
    name text NOT NULL,
    code text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT companies_holding_code_unique UNIQUE (holding_id, code)
);

CREATE TABLE IF NOT EXISTS configuration.branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    company_id uuid NOT NULL REFERENCES configuration.companies(id) ON DELETE CASCADE,
    name text NOT NULL,
    code text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT branches_company_code_unique UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS configuration.warehouses (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    branch_id uuid NOT NULL REFERENCES configuration.branches(id) ON DELETE CASCADE,
    name text NOT NULL,
    code text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT warehouses_branch_code_unique UNIQUE (branch_id, code)
);

CREATE INDEX IF NOT EXISTS idx_companies_holding_id ON configuration.companies(holding_id);
CREATE INDEX IF NOT EXISTS idx_branches_company_id ON configuration.branches(company_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_branch_id ON configuration.warehouses(branch_id);

-- Auto-create default warehouse when a branch is created
CREATE OR REPLACE FUNCTION configuration.ensure_default_warehouse_for_branch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO configuration.warehouses (branch_id, name, code, is_default, is_active)
    VALUES (NEW.id, 'Gudang 1', 'WH-01', true, true)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_branch_default_warehouse ON configuration.branches;
CREATE TRIGGER trg_branch_default_warehouse
    AFTER INSERT ON configuration.branches
    FOR EACH ROW
    EXECUTE FUNCTION configuration.ensure_default_warehouse_for_branch();

-- Seed example data (idempotent)
INSERT INTO configuration.holdings (name, code)
VALUES ('Prologe', 'PROLOGE')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = now();

DO $$
DECLARE
    v_holding_id uuid;
    v_sulu_id uuid;
    v_bandung_id uuid;
BEGIN
    SELECT id INTO v_holding_id FROM configuration.holdings WHERE code = 'PROLOGE';

    INSERT INTO configuration.companies (holding_id, name, code)
    VALUES (v_holding_id, 'Sulu', 'SULU')
    ON CONFLICT (holding_id, code) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    RETURNING id INTO v_sulu_id;
    IF v_sulu_id IS NULL THEN
        SELECT id INTO v_sulu_id FROM configuration.companies WHERE holding_id = v_holding_id AND code = 'SULU';
    END IF;

    INSERT INTO configuration.branches (company_id, name, code)
    VALUES (v_sulu_id, 'Sulu Bandung', 'SULU-BANDUNG')
    ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    RETURNING id INTO v_bandung_id;
END $$;
