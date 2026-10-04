-- Rename legacy branch codes to Sulu Bandung (single operational branch)

DO $$
DECLARE
    v_company_id uuid;
    v_branch_id uuid;
BEGIN
    SELECT id INTO v_company_id
    FROM configuration.companies
    WHERE code = 'SULU'
    LIMIT 1;

    IF v_company_id IS NULL THEN
        RAISE NOTICE 'Company SULU tidak ditemukan — skip rename branch';
        RETURN;
    END IF;

    SELECT id INTO v_branch_id
    FROM configuration.branches
    WHERE company_id = v_company_id
      AND code IN ('SULU-BRAGA', 'SULU-DAGO')
    ORDER BY CASE code WHEN 'SULU-BRAGA' THEN 0 WHEN 'SULU-DAGO' THEN 1 ELSE 2 END
    LIMIT 1;

    IF v_branch_id IS NULL THEN
        INSERT INTO configuration.branches (company_id, name, code)
        VALUES (v_company_id, 'Sulu Bandung', 'SULU-BANDUNG')
        ON CONFLICT (company_id, code) DO UPDATE
            SET name = EXCLUDED.name, is_active = true, updated_at = now();
        RAISE NOTICE 'Cabang SULU-BANDUNG dibuat';
        RETURN;
    END IF;

    UPDATE configuration.branches
    SET name = 'Sulu Bandung',
        code = 'SULU-BANDUNG',
        is_active = true,
        updated_at = now()
    WHERE id = v_branch_id;

    RAISE NOTICE 'Cabang legacy di-rename ke SULU-BANDUNG';
END $$;
