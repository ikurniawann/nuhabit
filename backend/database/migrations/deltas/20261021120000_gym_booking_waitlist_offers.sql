-- =============================================================================
-- Gym booking: waitlist offers that expire, and dated pass strikes
-- =============================================================================
-- 1. gym.bookings.promotion_expires_at: a seat offered from the waitlist is
--    held for the member until this time (rule waitlistOfferMinutes). Open
--    offers from before this file get the default 30 minutes from the offer.
-- 2. gym.bookings.pass_strike_at: when a late cancel or no-show counted as a
--    strike on a pass. Booking is suspended once a pass holder reaches the
--    strike limit inside the strike window. Strikes recorded before this
--    file are dated by the cancel time, else the last update.
-- 3. Indexes for the offer sweep and the strike lookup.
--
-- The new rule keys (maxConcurrentBookings, maxBookingsPerDay, strikeLimit,
-- strikeWindowDays, strikeSuspendDays, waitlistPromoteCutoffMin,
-- waitlistOfferMinutes) take their defaults in code until staff save them.
--
-- Idempotent: safe to run again.
-- =============================================================================

ALTER TABLE gym.bookings ADD COLUMN IF NOT EXISTS promotion_expires_at timestamptz;
ALTER TABLE gym.bookings ADD COLUMN IF NOT EXISTS pass_strike_at timestamptz;

UPDATE gym.bookings
   SET promotion_expires_at = promotion_offered_at + interval '30 minutes'
 WHERE status = 'waitlist' AND promotion_offered_at IS NOT NULL AND promotion_expires_at IS NULL;

UPDATE gym.bookings
   SET pass_strike_at = COALESCE(cancelled_at, updated_at)
 WHERE pass_strike AND pass_strike_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_gym_bookings_offer_expiry
  ON gym.bookings (promotion_expires_at) WHERE status = 'waitlist' AND promotion_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gym_bookings_pass_strikes
  ON gym.bookings (customer_id, pass_strike_at) WHERE pass_strike_at IS NOT NULL;
