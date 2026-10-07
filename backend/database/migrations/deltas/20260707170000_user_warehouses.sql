-- =============================================================================
-- User stall assignment: which warehouses (stalls) a user is activated at
-- =============================================================================

CREATE TABLE IF NOT EXISTS configuration.user_warehouses (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES configuration.users(id) ON DELETE CASCADE,
    warehouse_id uuid NOT NULL REFERENCES configuration.warehouses(id) ON DELETE CASCADE,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT user_warehouses_unique UNIQUE (user_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_user_warehouses_user_id
    ON configuration.user_warehouses(user_id);

CREATE INDEX IF NOT EXISTS idx_user_warehouses_warehouse_id
    ON configuration.user_warehouses(warehouse_id);
