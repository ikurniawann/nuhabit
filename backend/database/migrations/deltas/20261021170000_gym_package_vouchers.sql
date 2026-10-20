-- =============================================================================
-- Promo codes on gym credit package purchases. A campaign can be scoped to
-- the "gym" channel (class packages only); "semua" campaigns keep applying
-- everywhere. The gym-credits module holds a redemption per purchase
-- (context_type gym_purchase), captures it when the purchase is paid and
-- releases it when the purchase expires or fails. Idempotent.
-- =============================================================================

ALTER TABLE promo.promo_campaigns DROP CONSTRAINT IF EXISTS promo_campaigns_scope_check;
ALTER TABLE promo.promo_campaigns ADD CONSTRAINT promo_campaigns_scope_check
  CHECK (scope IN ('ticketing_online', 'ticketing_loket', 'pos', 'gym', 'semua'));

ALTER TABLE promo.promo_redemptions DROP CONSTRAINT IF EXISTS promo_redemptions_context_type_check;
ALTER TABLE promo.promo_redemptions ADD CONSTRAINT promo_redemptions_context_type_check
  CHECK (context_type IN ('ticket_booking', 'pos_order', 'shop_order', 'gym_purchase'));
