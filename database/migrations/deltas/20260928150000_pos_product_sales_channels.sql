-- Channel penjualan per produk (owner 2026-09-28): menu bundling GoFood
-- (5/10 Pcs Bold/Light And Sweet) hanya dijual di GoFood — ada di POS supaya
-- order GoFood terpetakan & masuk KDS, tapi tidak tampil di kasir maupun
-- self-order. NULL = semua channel (perilaku lama, semua produk yang ada).
ALTER TABLE pos.pos_products
  ADD COLUMN IF NOT EXISTS sales_channels text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_products_sales_channels_check'
  ) THEN
    ALTER TABLE pos.pos_products
      ADD CONSTRAINT pos_products_sales_channels_check CHECK (
        sales_channels IS NULL
        OR sales_channels <@ ARRAY['pos', 'self_order', 'gofood', 'grabfood', 'shopeefood']::text[]
      );
  END IF;
END $$;

COMMENT ON COLUMN pos.pos_products.sales_channels IS
  'Channel penjualan (pos, self_order, gofood, grabfood, shopeefood). NULL = semua channel.';
