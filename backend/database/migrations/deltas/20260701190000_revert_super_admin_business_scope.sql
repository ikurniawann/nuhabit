-- =============================================================================
-- Super admin tetap unscoped (lihat semua). Scope cabang via user demo terpisah.
-- =============================================================================

UPDATE configuration.users
SET business_scope = NULL,
    holding_id = NULL,
    company_id = NULL,
    branch_id = NULL,
    updated_at = now()
WHERE role = 'super_admin';
