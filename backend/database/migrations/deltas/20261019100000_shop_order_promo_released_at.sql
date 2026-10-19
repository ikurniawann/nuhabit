-- =============================================================================
-- Shop orders record when their promo hold went back to the code. The Go
-- shop module stamps promo_released_at after it releases the redemption of a
-- cancelled order, and its expiry sweep releases every cancelled order with a
-- promo code and no stamp (orders shop.release_expired_reservations()
-- cancelled, and releases that failed earlier). Idempotent.
-- =============================================================================

ALTER TABLE shop.orders
  ADD COLUMN IF NOT EXISTS promo_released_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_shop_orders_promo_unreleased
  ON shop.orders (updated_at)
  WHERE status = 'cancelled' AND promo_code IS NOT NULL AND promo_released_at IS NULL;
