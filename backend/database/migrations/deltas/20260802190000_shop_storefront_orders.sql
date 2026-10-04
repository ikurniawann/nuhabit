-- =============================================================================
-- EPIC-039 Fase D — storefront publik: toko, distribusi katalog, order online,
-- reservasi stok ber-TTL.
-- =============================================================================
-- Keputusan owner: storefront bisa SATUAN per venue ATAU GABUNGAN —
-- `storefronts.venue_ids` NULL = semua venue; berisi 1+ branch id = toko
-- satuan. Distribusi katalog meniru pola ticketing ticket_product_channels
-- (is_distributed per channel). Reservasi stok reuse fungsi klaim Fase A/B
-- (pos_sell_merchandise_stock / _sku_stock): reservasi = klaim + baris TTL;
-- expired → restore + order dibatalkan. Idempoten, dev.
-- =============================================================================

-- 1) Toko online ber-slug
CREATE TABLE IF NOT EXISTS shop.storefronts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug varchar(60) NOT NULL,
    name varchar(120) NOT NULL,
    description text,
    venue_ids uuid[],              -- NULL = gabungan semua venue
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_storefronts_slug
  ON shop.storefronts (lower(slug));

INSERT INTO shop.storefronts (slug, name, description)
SELECT 'toko', 'Toko Online', 'Storefront merchandise default'
WHERE NOT EXISTS (SELECT 1 FROM shop.storefronts);

-- 2) Channel penjualan (kasir bawaan; web dipakai Fase D; shopee Fase F)
CREATE TABLE IF NOT EXISTS shop.channels (
    code varchar(20) PRIMARY KEY,
    name varchar(60) NOT NULL,
    is_active boolean NOT NULL DEFAULT true
);

INSERT INTO shop.channels (code, name) VALUES
  ('kasir', 'Kasir POS'),
  ('web', 'Toko Online'),
  ('shopee', 'Shopee')
ON CONFLICT (code) DO NOTHING;

-- 3) Distribusi produk per channel (pola ticket_product_channels)
CREATE TABLE IF NOT EXISTS shop.product_channels (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id uuid NOT NULL REFERENCES pos.pos_products(id) ON DELETE CASCADE,
    channel_code varchar(20) NOT NULL REFERENCES shop.channels(code),
    is_distributed boolean NOT NULL DEFAULT true,
    price_override numeric(15,2),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_shop_product_channels UNIQUE (product_id, channel_code)
);

-- 4) Order online
CREATE SEQUENCE IF NOT EXISTS shop.order_number_seq;

CREATE OR REPLACE FUNCTION shop.generate_order_number()
RETURNS text
LANGUAGE sql
AS $$
  SELECT 'SHOP-' || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYMMDD') || '-'
         || lpad((nextval('shop.order_number_seq') % 100000)::text, 5, '0');
$$;

CREATE TABLE IF NOT EXISTS shop.orders (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number varchar(30) NOT NULL DEFAULT shop.generate_order_number(),
    storefront_id uuid REFERENCES shop.storefronts(id),
    -- token halaman status publik (pola access_token booking)
    access_token uuid NOT NULL DEFAULT uuid_generate_v4(),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','paid','packing','shipped','completed','cancelled','refund')),
    customer_name varchar(120) NOT NULL,
    customer_phone varchar(30) NOT NULL,
    customer_email varchar(160),
    -- Tertaut member CRM bila nomor WA cocok (kebijakan XP tetap ikut CRM)
    customer_id uuid REFERENCES pos.pos_customers(id),
    shipping_address text NOT NULL,
    shipping_area_id text,
    shipping_area_label text,
    shipping_postal_code varchar(10),
    shipping_provider text,
    courier_code varchar(30),
    courier_service varchar(60),
    subtotal numeric(15,2) NOT NULL DEFAULT 0,
    shipping_cost numeric(12,2) NOT NULL DEFAULT 0,
    total numeric(15,2) NOT NULL DEFAULT 0,
    xendit_invoice_id text,
    xendit_invoice_url text,
    invoice_expires_at timestamptz,
    paid_at timestamptz,
    waybill varchar(60),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_orders_number ON shop.orders (order_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_orders_token ON shop.orders (access_token);
CREATE INDEX IF NOT EXISTS idx_shop_orders_status ON shop.orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS shop.order_items (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id uuid NOT NULL REFERENCES shop.orders(id) ON DELETE CASCADE,
    product_id uuid REFERENCES pos.pos_products(id),
    sku_id uuid REFERENCES pos.pos_product_skus(id) ON DELETE SET NULL,
    product_name varchar(200) NOT NULL,
    sku_name varchar(120),
    sku_code varchar(60),
    quantity numeric(10,2) NOT NULL CHECK (quantity > 0),
    unit_price numeric(15,2) NOT NULL DEFAULT 0,
    total numeric(15,2) NOT NULL DEFAULT 0,
    weight_gram numeric(10,2)
);

CREATE INDEX IF NOT EXISTS idx_shop_order_items_order ON shop.order_items (order_id);

-- 5) Reservasi stok ber-TTL. Baris held = stok SUDAH diklaim (fungsi klaim
--    Fase A/B); committed = order dibayar (klaim final); released = stok
--    sudah dikembalikan (expired/batal).
CREATE TABLE IF NOT EXISTS shop.stock_reservations (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id uuid NOT NULL REFERENCES shop.orders(id) ON DELETE CASCADE,
    product_id uuid NOT NULL,
    sku_id uuid,
    qty numeric(10,2) NOT NULL CHECK (qty > 0),
    status text NOT NULL DEFAULT 'held'
        CHECK (status IN ('held','committed','released')),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_reservations_expiry
  ON shop.stock_reservations (expires_at)
  WHERE status = 'held';

-- 6) Rilis reservasi kedaluwarsa: kembalikan stok (fungsi restore Fase A/B),
--    tandai released, batalkan order pending-nya. Dipanggil opportunistik
--    dari API katalog/checkout — tanpa cron. Idempoten (klaim-dulu per baris).
CREATE OR REPLACE FUNCTION shop.release_expired_reservations()
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    -- FOR UPDATE SKIP LOCKED: dua request bersamaan tidak merilis dobel
    SELECT id, order_id, product_id, sku_id, qty
    FROM shop.stock_reservations
    WHERE status = 'held' AND expires_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Klaim baris dulu (transisi status), baru kembalikan stok
    UPDATE shop.stock_reservations
    SET status = 'released', updated_at = now()
    WHERE id = v_row.id AND status = 'held';

    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_row.sku_id IS NOT NULL THEN
      PERFORM public.pos_sell_merchandise_sku_stock(v_row.sku_id, -v_row.qty);
    ELSE
      PERFORM public.pos_sell_merchandise_stock(v_row.product_id, -v_row.qty);
    END IF;

    UPDATE shop.orders
    SET status = 'cancelled', updated_at = now()
    WHERE id = v_row.order_id AND status = 'pending';

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;
