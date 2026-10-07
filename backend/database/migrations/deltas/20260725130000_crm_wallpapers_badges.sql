-- EPIC-014 Task 5 (wallpaper) + Task 6 (badge by XP).
-- Keputusan owner: tabel terpisah per jenis aset; aturan tetap satu di
-- src/lib/crm/collectibles.ts.

CREATE TABLE IF NOT EXISTS crm.crm_collectible_wallpapers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  rarity          text NOT NULL DEFAULT 'common',
  image_url       text NOT NULL,
  thumbnail_url   text,
  min_lifetime_xp integer,
  required_tier_id uuid REFERENCES crm.crm_membership_tiers(id) ON DELETE SET NULL,
  stock_total     integer,
  stock_redeemed  integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  starts_at       timestamptz,
  ends_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm.crm_member_wallpaper_inventory (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id          uuid NOT NULL REFERENCES crm.crm_member_profiles(id) ON DELETE CASCADE,
  wallpaper_id       uuid NOT NULL REFERENCES crm.crm_collectible_wallpapers(id) ON DELETE CASCADE,
  acquisition_source text NOT NULL DEFAULT 'entitlement',
  acquired_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, wallpaper_id)
);

-- Definisi badge (admin builder) — tanpa stok, tanpa jendela: murni ambang XP.
CREATE TABLE IF NOT EXISTS crm.crm_badges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  image_url       text,
  min_lifetime_xp integer NOT NULL CHECK (min_lifetime_xp >= 0),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Pemberian badge: otomatis, sekali per badge per member, TANPA jatah.
CREATE TABLE IF NOT EXISTS crm.crm_member_badges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  member_id    uuid REFERENCES crm.crm_member_profiles(id) ON DELETE SET NULL,
  badge_id     uuid NOT NULL REFERENCES crm.crm_badges(id) ON DELETE CASCADE,
  awarded_at   timestamptz NOT NULL DEFAULT now(),
  is_showcased boolean NOT NULL DEFAULT false,
  UNIQUE (customer_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_member_badges_customer
  ON crm.crm_member_badges (customer_id, awarded_at DESC);
