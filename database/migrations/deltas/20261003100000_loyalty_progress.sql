-- =============================================================================
-- EPIC-066 Fase 1 — NüHabit Progress: XP konsistensi, tier, leaderboard
--
-- Keputusan owner 2026-10-02:
--  1. Tier dari XP seumur hidup, kecuali member diblokir (suspended) / banned.
--  2. Nilai XP & nilai tukar reward dikonfigurasi dari backoffice.
--  3. ARK Coin dimatikan (bisa diaktifkan lagi — data tidak dihapus).
--  4. Leaderboard (opt-in member).
--
-- Model XP NüHabit: XP lifetime (tier; kanonik pos_customers.total_xp, mirror
-- crm_member_profiles.lifetime_xp) + saldo XP yang bisa ditukar
-- (crm_member_profiles.xp_balance). Baris ledger source_channel 'studio'
-- menyimpan saldo XP di balance_before/after.
-- =============================================================================

-- ── Sumber XP 'studio' ─────────────────────────────────────────────────────
ALTER TABLE crm.crm_xp_rules DROP CONSTRAINT IF EXISTS crm_xp_rules_source_channel_check;
ALTER TABLE crm.crm_xp_rules ADD CONSTRAINT crm_xp_rules_source_channel_check
  CHECK (source_channel = ANY (ARRAY['pos','photobooth','studio_game','manual','campaign','studio']));
ALTER TABLE crm.crm_xp_ledger DROP CONSTRAINT IF EXISTS crm_xp_ledger_source_channel_check;
ALTER TABLE crm.crm_xp_ledger ADD CONSTRAINT crm_xp_ledger_source_channel_check
  CHECK (source_channel = ANY (ARRAY['pos','photobooth','studio_game','manual','campaign','redemption','studio']));

-- ── Saldo XP & status member ───────────────────────────────────────────────
ALTER TABLE crm.crm_member_profiles ADD COLUMN IF NOT EXISTS xp_balance integer NOT NULL DEFAULT 0;
ALTER TABLE crm.crm_member_profiles DROP CONSTRAINT IF EXISTS crm_member_profiles_xp_balance_positive;
ALTER TABLE crm.crm_member_profiles ADD CONSTRAINT crm_member_profiles_xp_balance_positive CHECK (xp_balance >= 0);
ALTER TABLE crm.crm_member_profiles DROP CONSTRAINT IF EXISTS crm_member_profiles_status_check;
ALTER TABLE crm.crm_member_profiles ADD CONSTRAINT crm_member_profiles_status_check
  CHECK (status = ANY (ARRAY['active','inactive','suspended','merged','banned']));
ALTER TABLE crm.crm_member_profiles ADD COLUMN IF NOT EXISTS status_reason text;
ALTER TABLE crm.crm_member_profiles ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
ALTER TABLE crm.crm_member_profiles ADD COLUMN IF NOT EXISTS status_changed_by uuid;

-- ── Tier NüHabit (kode BCD dipertahankan — dipakai tampilan lama) ─────────
-- metadata: early_booking_days (booking dibuka lebih awal), cancel_window_hours
-- (null = ikut Aturan Booking), waitlist_priority (didahulukan saat naik waitlist).
UPDATE crm.crm_membership_tiers SET name = 'Starter', min_lifetime_xp = 0, discount_percent = 0, xp_multiplier = 1,
  display_color = '#A9B5A7', metadata = metadata || '{"early_booking_days":0,"cancel_window_hours":null,"waitlist_priority":false}'::jsonb
WHERE code = 'regular';
UPDATE crm.crm_membership_tiers SET name = 'Open', min_lifetime_xp = 1000, discount_percent = 5, xp_multiplier = 1,
  display_color = '#ABDE67', metadata = metadata || '{"early_booking_days":1,"cancel_window_hours":null,"waitlist_priority":false}'::jsonb
WHERE code = 'bronze';
UPDATE crm.crm_membership_tiers SET name = 'Pro', min_lifetime_xp = 3000, discount_percent = 10, xp_multiplier = 1,
  display_color = '#DAFF59', metadata = metadata || '{"early_booking_days":2,"cancel_window_hours":null,"waitlist_priority":true}'::jsonb
WHERE code = 'silver';
UPDATE crm.crm_membership_tiers SET name = 'Elite', min_lifetime_xp = 7500, discount_percent = 15, xp_multiplier = 1,
  display_color = '#C9A227', metadata = metadata || '{"early_booking_days":3,"cancel_window_hours":6,"waitlist_priority":true}'::jsonb
WHERE code = 'gold';

-- ── Aturan XP studio (nilai default — diubah dari Program Loyalitas) ──────
INSERT INTO crm.crm_xp_rules (code, name, source_channel, source_type, xp_mode, xp_value, amount_step, tier_multiplier_enabled, priority, metadata)
VALUES
  ('studio_class_attended',  'Hadir kelas',                      'studio', 'class_attended',  'fixed',      50,  1,     false, 10, '{}'),
  ('studio_pt_attended',     'Hadir Personal Training',          'studio', 'pt_attended',     'fixed',      80,  1,     false, 20, '{}'),
  ('studio_offpeak',         'Bonus kelas jam sepi',             'studio', 'offpeak_attended','fixed',      20,  1,     false, 30, '{"start":"10:00","end":"16:00"}'),
  ('studio_weekly_streak',   'Streak mingguan',                  'studio', 'weekly_streak',   'fixed',      100, 1,     false, 40, '{"min_sessions":3}'),
  ('studio_streak_4w',       'Streak 4 minggu berturut-turut',   'studio', 'streak_4w',       'fixed',      300, 1,     false, 50, '{}'),
  ('studio_pass_purchase',   'Beli paket',                       'studio', 'pass_purchase',   'per_amount', 1,   10000, false, 60, '{}'),
  ('studio_early_renewal',   'Perpanjang sebelum paket habis',   'studio', 'early_renewal',   'fixed',      150, 1,     false, 70, '{}')
ON CONFLICT (code) DO NOTHING;

-- ── ARK Coin mati untuk NüHabit (saklar CRM → Pengaturan) ─────────────────
INSERT INTO crm.crm_settings (key, value, description, updated_at)
VALUES ('ark_coin_enabled', 'false'::jsonb, 'NüHabit: ARK Coin dimatikan (keputusan owner 2026-10-02) — saldo paket dipegang Member Pass', now())
ON CONFLICT (key) DO UPDATE SET value = 'false'::jsonb, updated_at = now();

-- ── Leaderboard opt-in ─────────────────────────────────────────────────────
ALTER TABLE studio.member_prefs ADD COLUMN IF NOT EXISTS leaderboard_opt_in boolean NOT NULL DEFAULT false;

-- ── Menu: Program Loyalitas ────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('studio.loyalty', 'Program Loyalitas', '/dashboard/studio/loyalty', 'chart-bar', 'sidebar', 55,
        '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'studio', level = 2 WHERE code = 'studio.loyalty';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'studio.loyalty' AND parent.code = 'studio';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb), true
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'direksi') AND m.code = 'studio.loyalty'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
