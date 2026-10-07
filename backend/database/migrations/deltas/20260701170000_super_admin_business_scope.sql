-- =============================================================================
-- Super admin default business scope: Prologe → Sulu → Sulu Bandung
-- =============================================================================

DO $$
DECLARE
    v_holding_id uuid;
    v_company_id uuid;
    v_branch_id uuid;
BEGIN
    SELECT id INTO v_holding_id
    FROM configuration.holdings
    WHERE code = 'PROLOGE';

    SELECT id INTO v_company_id
    FROM configuration.companies
    WHERE holding_id = v_holding_id AND code = 'SULU';

    SELECT id INTO v_branch_id
    FROM configuration.branches
    WHERE company_id = v_company_id AND code = 'SULU-BANDUNG';

    IF v_holding_id IS NULL OR v_company_id IS NULL OR v_branch_id IS NULL THEN
        RAISE NOTICE 'Prologe / Sulu / Sulu Bandung belum ada — skip super admin scope update';
        RETURN;
    END IF;

    UPDATE configuration.users
    SET business_scope = 'branch',
        holding_id = v_holding_id,
        company_id = v_company_id,
        branch_id = v_branch_id,
        updated_at = now()
    WHERE role = 'super_admin';
END $$;
