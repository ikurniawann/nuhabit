-- =============================================================================
-- Backfill master items & inventory ke Company Sulu / Branch Sulu Bandung
-- =============================================================================

DO $$
DECLARE
    v_company_id uuid;
    v_branch_id uuid;
    v_warehouse_id uuid;
BEGIN
    SELECT c.id, b.id
    INTO v_company_id, v_branch_id
    FROM configuration.companies c
    JOIN configuration.branches b ON b.company_id = c.id
    WHERE c.code = 'SULU'
      AND b.code = 'SULU-BANDUNG'
      AND c.is_active = true
      AND b.is_active = true
    LIMIT 1;

    IF v_company_id IS NULL OR v_branch_id IS NULL THEN
        RAISE NOTICE 'Sulu / Sulu Bandung tidak ditemukan — skip backfill items scope';
        RETURN;
    END IF;

    SELECT id INTO v_warehouse_id
    FROM configuration.warehouses
    WHERE branch_id = v_branch_id
      AND is_active = true
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1;

    UPDATE item.raw_materials
    SET company_id = v_company_id,
        branch_id = v_branch_id,
        updated_at = now()
    WHERE deleted_at IS NULL
      AND (company_id IS NULL OR branch_id IS NULL);

    UPDATE item.products
    SET company_id = v_company_id,
        branch_id = v_branch_id,
        updated_at = now()
    WHERE deleted_at IS NULL
      AND (company_id IS NULL OR branch_id IS NULL);

    UPDATE item.units
    SET company_id = v_company_id,
        updated_at = now()
    WHERE deleted_at IS NULL
      AND company_id IS NULL;

    UPDATE item.raw_material_categories
    SET company_id = v_company_id,
        updated_at = now()
    WHERE deleted_at IS NULL
      AND company_id IS NULL;

    UPDATE item.product_categories
    SET company_id = v_company_id,
        updated_at = now()
    WHERE deleted_at IS NULL
      AND company_id IS NULL;

    IF v_warehouse_id IS NOT NULL THEN
        UPDATE inventory.inventory
        SET branch_id = v_branch_id,
            warehouse_id = v_warehouse_id,
            updated_at = now()
        WHERE branch_id IS NULL
           OR warehouse_id IS NULL;

        UPDATE inventory.inventory_movements
        SET branch_id = v_branch_id,
            warehouse_id = COALESCE(warehouse_id, v_warehouse_id),
            updated_at = now()
        WHERE branch_id IS NULL;
    ELSE
        UPDATE inventory.inventory
        SET branch_id = v_branch_id,
            updated_at = now()
        WHERE branch_id IS NULL;
    END IF;
END $$;
