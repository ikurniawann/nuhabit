-- =============================================================================
-- Promo offer rules: bundling / buy-x-get-y / volume discount (admin CRUD).
-- POS auto-apply = later phase. Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS promo.offer_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  offer_type text NOT NULL
    CHECK (offer_type = ANY (ARRAY['bundle'::text, 'bxgy'::text, 'volume'::text])),
  name character varying(160) NOT NULL,
  description text,
  valid_from date,
  valid_until date,
  is_active boolean NOT NULL DEFAULT true,
  -- bundle
  bundle_price numeric(14, 2),
  -- bxgy
  buy_qty integer,
  get_qty integer,
  get_mode text
    CHECK (get_mode IS NULL OR get_mode = ANY (ARRAY['same_as_buy'::text, 'specific_products'::text])),
  -- volume
  volume_basis text
    CHECK (volume_basis IS NULL OR volume_basis = ANY (ARRAY['qty'::text, 'spend'::text])),
  volume_min numeric(14, 2),
  discount_type text
    CHECK (discount_type IS NULL OR discount_type = ANY (ARRAY['percent'::text, 'fixed'::text])),
  discount_value numeric(14, 4),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_rules_dates_chk CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until
  )
);

CREATE INDEX IF NOT EXISTS offer_rules_branch_type_idx
  ON promo.offer_rules (branch_id, offer_type, is_active);

CREATE TABLE IF NOT EXISTS promo.offer_rule_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES promo.offer_rules(id) ON DELETE CASCADE,
  role text NOT NULL
    CHECK (role = ANY (ARRAY[
      'component'::text,  -- bundle lines
      'buy'::text,        -- bxgy buy products
      'get'::text,        -- bxgy free products (when specific)
      'eligible'::text    -- volume eligible products (empty = all)
    ])),
  product_id uuid NOT NULL,
  qty numeric(14, 3) NOT NULL DEFAULT 1
    CHECK (qty > 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offer_rule_items_rule_idx
  ON promo.offer_rule_items (rule_id, role, sort_order);

COMMENT ON TABLE promo.offer_rules IS
  'Product-based promo rules (bundle/bxgy/volume). Period via valid_from/until. POS apply later.';
COMMENT ON COLUMN promo.offer_rules.bundle_price IS
  'Fixed sell price for whole bundle; stock/recipe still from component products.';

-- Menus under CRM → Promo
INSERT INTO iam.menus (
  code, menu_name, route_path, icon, menu_type, order_number,
  permission_context, module, level, is_active, is_visible
)
VALUES
  (
    'promo.offers.bundling',
    'Bundling',
    '/dashboard/promo/bundling',
    'cube',
    'sidebar',
    20,
    '{"actions":["read","create","update","delete"]}'::jsonb,
    'crm',
    2,
    true,
    true
  ),
  (
    'promo.offers.bxgy',
    'Buy X Get Y',
    '/dashboard/promo/bxgy',
    'gift',
    'sidebar',
    30,
    '{"actions":["read","create","update","delete"]}'::jsonb,
    'crm',
    2,
    true,
    true
  ),
  (
    'promo.offers.volume',
    'Diskon Volume',
    '/dashboard/promo/volume',
    'percent',
    'sidebar',
    40,
    '{"actions":["read","create","update","delete"]}'::jsonb,
    'crm',
    2,
    true,
    true
  )
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon,
  order_number = EXCLUDED.order_number,
  is_active = true,
  is_visible = true,
  deleted_at = NULL,
  updated_at = now();

UPDATE iam.menus child
SET parent_id = parent.id,
    module = 'crm',
    level = 2,
    updated_at = now()
FROM iam.menus parent
WHERE child.code IN ('promo.offers.bundling', 'promo.offers.bxgy', 'promo.offers.volume')
  AND parent.code = 'crm.promo';

-- Kampanye Promo first, then new offer menus
UPDATE iam.menus SET order_number = 10, updated_at = now()
WHERE code = 'promo.campaigns';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT rmp.role_id, m.id, '["read","create","update","delete"]'::jsonb
FROM iam.role_menu_permissions rmp
JOIN iam.menus campaigns ON campaigns.id = rmp.menu_id AND campaigns.code = 'promo.campaigns'
CROSS JOIN iam.menus m
WHERE m.code IN ('promo.offers.bundling', 'promo.offers.bxgy', 'promo.offers.volume')
  AND rmp.is_active
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();
