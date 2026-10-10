-- =============================================================================
-- Shop browsing round: product sale prices and flags, the restock marker,
-- the storefront promo banner, product reviews and member wishlists.
-- Idempotent.
-- =============================================================================

-- 1) Product settings: sale price with an optional end, featured and new
--    flags, and when stock last came back from zero.
ALTER TABLE shop.product_settings
  ADD COLUMN IF NOT EXISTS sale_price_idr numeric(15,2) CHECK (sale_price_idr IS NULL OR sale_price_idr >= 0),
  ADD COLUMN IF NOT EXISTS sale_until timestamptz,
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_new boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS restocked_at timestamptz;

-- 2) restocked_at follows every stock writer (POS sale functions, GRN,
--    opname, SKU matrix, shop cancellations) through triggers on the stock
--    columns: a merchandise product or SKU moving from 0 (or NULL) to above
--    0 stamps its product.
CREATE OR REPLACE FUNCTION shop.mark_product_restocked(p_product_id uuid)
RETURNS void
LANGUAGE sql
AS $function$
  INSERT INTO shop.product_settings (product_id, restocked_at)
  VALUES (p_product_id, now())
  ON CONFLICT (product_id) DO UPDATE SET restocked_at = now(), updated_at = now();
$function$;

CREATE OR REPLACE FUNCTION shop.product_stock_restocked()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.product_kind = 'merchandise'
     AND COALESCE(OLD.inventory_quantity, 0) <= 0
     AND COALESCE(NEW.inventory_quantity, 0) > 0 THEN
    PERFORM shop.mark_product_restocked(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shop.sku_stock_restocked()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF COALESCE(OLD.stock_quantity, 0) <= 0 AND COALESCE(NEW.stock_quantity, 0) > 0 THEN
    PERFORM shop.mark_product_restocked(NEW.product_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_shop_product_restocked ON pos.pos_products;
CREATE TRIGGER trg_shop_product_restocked
  AFTER UPDATE OF inventory_quantity ON pos.pos_products
  FOR EACH ROW EXECUTE FUNCTION shop.product_stock_restocked();

DROP TRIGGER IF EXISTS trg_shop_sku_restocked ON pos.pos_product_skus;
CREATE TRIGGER trg_shop_sku_restocked
  AFTER UPDATE OF stock_quantity ON pos.pos_product_skus
  FOR EACH ROW EXECUTE FUNCTION shop.sku_stock_restocked();

-- 3) Storefront promo banner (no headline = no banner).
ALTER TABLE shop.storefront_settings
  ADD COLUMN IF NOT EXISTS banner_headline text,
  ADD COLUMN IF NOT EXISTS banner_text text,
  ADD COLUMN IF NOT EXISTS banner_code text;

-- 4) Product reviews by members with a paid order, moderated by staff.
CREATE TABLE IF NOT EXISTS shop.product_reviews (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id uuid NOT NULL REFERENCES pos.pos_products(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
    order_id uuid NOT NULL REFERENCES shop.orders(id) ON DELETE CASCADE,
    rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (customer_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_shop_product_reviews_product
  ON shop.product_reviews (product_id, created_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_shop_product_reviews_status
  ON shop.product_reviews (status, created_at DESC);

-- 5) Member wishlists (guests keep theirs in the browser).
CREATE TABLE IF NOT EXISTS shop.wishlists (
    customer_id uuid PRIMARY KEY REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
    product_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);
