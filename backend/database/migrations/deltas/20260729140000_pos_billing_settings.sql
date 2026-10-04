-- =============================================================================
-- POS Billing Config — profiles per branch/stall + dynamic charge lines
-- Tax / service / uniqcode fee / rounding; order snapshot columns.
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pos.pos_billing_profiles (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id uuid,
    warehouse_id uuid,
    name character varying(120) NOT NULL DEFAULT 'Default',
    is_active boolean NOT NULL DEFAULT true,
    updated_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE pos.pos_billing_profiles IS
  'Billing profile scope: system default (both NULL), branch-wide (warehouse NULL), or stall override.';

CREATE UNIQUE INDEX IF NOT EXISTS pos_billing_profiles_scope_active_uidx
    ON pos.pos_billing_profiles (
      COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
      COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
    WHERE is_active;

CREATE INDEX IF NOT EXISTS pos_billing_profiles_branch_idx
    ON pos.pos_billing_profiles (branch_id)
    WHERE is_active;

CREATE TABLE IF NOT EXISTS pos.pos_billing_charges (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id uuid NOT NULL REFERENCES pos.pos_billing_profiles(id) ON DELETE CASCADE,
    code character varying(40) NOT NULL,
    name character varying(120) NOT NULL,
    charge_kind text NOT NULL
        CHECK (charge_kind = ANY (ARRAY['tax'::text, 'service'::text, 'fee'::text, 'rounding'::text])),
    calc_method text NOT NULL
        CHECK (calc_method = ANY (ARRAY[
          'percent'::text, 'fixed'::text, 'round_nearest'::text, 'round_up'::text
        ])),
    rate numeric(14, 4) NOT NULL DEFAULT 0
        CHECK (rate >= 0),
    amount numeric(14, 2) NOT NULL DEFAULT 0
        CHECK (amount >= 0),
    apply_order integer NOT NULL DEFAULT 100,
    is_enabled boolean NOT NULL DEFAULT true,
    is_optional boolean NOT NULL DEFAULT false,
    base text NOT NULL DEFAULT 'subtotal_after_discount'
        CHECK (base = ANY (ARRAY[
          'subtotal_after_discount'::text, 'subtotal_plus_fees'::text
        ])),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT pos_billing_charges_profile_code_key UNIQUE (profile_id, code)
);

COMMENT ON TABLE pos.pos_billing_charges IS
  'Charge lines for a billing profile. code = uniqcode for fee items billed to customer.';

CREATE INDEX IF NOT EXISTS pos_billing_charges_profile_order_idx
    ON pos.pos_billing_charges (profile_id, apply_order, code);

ALTER TABLE pos.pos_orders
    ADD COLUMN IF NOT EXISTS other_charges_amount numeric(12, 2) DEFAULT 0;

ALTER TABLE pos.pos_orders
    ADD COLUMN IF NOT EXISTS charges_breakdown jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN pos.pos_orders.other_charges_amount IS
  'Sum of fee charges + rounding adjustment at checkout.';
COMMENT ON COLUMN pos.pos_orders.charges_breakdown IS
  'Snapshot of applied charges [{code,name,kind,amount}] for receipt/history.';

-- System default profile
INSERT INTO pos.pos_billing_profiles (id, branch_id, warehouse_id, name, is_active)
VALUES (
    'b0000000-0000-4000-8000-000000000001',
    NULL,
    NULL,
    'System Default',
    true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pos.pos_billing_charges (
    id, profile_id, code, name, charge_kind, calc_method, rate, amount,
    apply_order, is_enabled, is_optional, base
)
VALUES
    (
      'b0000000-0000-4000-8000-000000000011',
      'b0000000-0000-4000-8000-000000000001',
      'TAX', 'Tax (PPN)', 'tax', 'percent', 10, 0,
      200, true, true, 'subtotal_after_discount'
    ),
    (
      'b0000000-0000-4000-8000-000000000012',
      'b0000000-0000-4000-8000-000000000001',
      'SERVICE', 'Service Charge', 'service', 'percent', 0, 0,
      100, false, true, 'subtotal_after_discount'
    ),
    (
      'b0000000-0000-4000-8000-000000000013',
      'b0000000-0000-4000-8000-000000000001',
      'ROUND', 'Rounding', 'rounding', 'round_nearest', 0, 0,
      900, false, false, 'subtotal_plus_fees'
    )
ON CONFLICT (id) DO NOTHING;

-- Menu: Settings → Billing Config (tax / service / uniqcode / rounding)
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES (
    'settings.billing',
    'Billing Config',
    '/dashboard/settings/billing',
    'banknotes',
    'sidebar',
    26,
    '{"actions":["read","update"]}'::jsonb
)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number,
  is_active = true,
  is_visible = true,
  deleted_at = NULL,
  updated_at = now();

UPDATE iam.menus SET module = 'settings', level = 2
WHERE code = 'settings.billing';

UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'settings.billing'
  AND parent.code = 'settings';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","update"]'::jsonb
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code = 'settings.billing'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();

-- Soft-retire early POS loyalty placement if it was seeded previously
UPDATE iam.menus
SET is_active = false,
    is_visible = false,
    deleted_at = COALESCE(deleted_at, now()),
    updated_at = now()
WHERE code = 'pos.loyalty.billing-settings';
