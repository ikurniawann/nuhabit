-- =============================================================================
-- EPIC-039 Fase C — schema `shop` + settings modul kurir (Biteship/RajaOngkir).
-- =============================================================================
-- Keputusan owner (Automation Log 2 Agu): kurir via DUA provider — Biteship
-- (utama: tarif + buat pengiriman + webhook) dan RajaOngkir/Komerce
-- (alternatif: tarif + lacak resi, TANPA buat pengiriman → resi manual).
-- Provider aktif dipilih di settings; API key TIDAK disimpan di DB —
-- env server (BITESHIP_API_KEY / RAJAONGKIR_API_KEY).
--
-- Tabel shop.shipments + webhook tracking menyusul di Fase E (butuh
-- shop.orders dari Fase D). Idempoten, atomik (runner), dev.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS shop;

CREATE TABLE IF NOT EXISTS shop.shipping_settings (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider text NOT NULL DEFAULT 'biteship'
        CHECK (provider IN ('biteship', 'rajaongkir')),
    -- Origin: dua kolom id karena sistem area kedua provider berbeda
    origin_area_id text,           -- Biteship area id
    origin_district_id text,       -- RajaOngkir/Komerce district id
    origin_label text,             -- label area utk ditampilkan di UI
    origin_postal_code varchar(10),
    origin_address text,
    origin_contact_name varchar(120),
    origin_contact_phone varchar(30),
    -- Kode kurir aktif, dipisah koma (jne,jnt,sicepat,anteraja,gojek,grab)
    couriers text NOT NULL DEFAULT 'jne,jnt,sicepat',
    -- Markup ongkir flat per pengiriman (packing dsb.), 0 = tanpa markup
    markup_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (markup_amount >= 0),
    is_active boolean NOT NULL DEFAULT true,
    updated_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Satu baris settings aktif (scope global; per-venue menyusul bila perlu —
-- pola COALESCE billing profiles siap ditiru)
CREATE UNIQUE INDEX IF NOT EXISTS shop_shipping_settings_active_uidx
    ON shop.shipping_settings (is_active)
    WHERE is_active;

COMMENT ON TABLE shop.shipping_settings IS
  'EPIC-039 Fase C — konfigurasi modul kurir toko online: provider aktif '
  '(biteship|rajaongkir), alamat origin, kurir diaktifkan, markup ongkir.';

-- Menu Settings → Pengiriman (pola settings.billing)
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES (
    'settings.shipping',
    'Pengiriman (Kurir)',
    '/dashboard/settings/shipping',
    'truck',
    'sidebar',
    27,
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
WHERE code = 'settings.shipping';

UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'settings.shipping'
  AND parent.code = 'settings';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","update"]'::jsonb
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code = 'settings.shipping'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();
