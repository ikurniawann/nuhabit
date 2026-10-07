-- EPIC-011 Fase A: seed 4 tier default (Regular sudah dari delta sebelumnya).
-- Nama & ambang bisa diubah Super Admin (Fase B); nilai awal = CRM_DEFAULT_TIERS.
INSERT INTO crm.crm_membership_tiers
  (code, name, rank, min_lifetime_xp, min_total_spend, xp_multiplier,
   discount_percent, display_color)
VALUES
  ('bronze', 'Bronze', 1, 100, 0, 1, 0, '#B7791F'),
  ('silver', 'Silver', 2, 10000, 2000000, 1.2, 5, '#94A3B8'),
  ('gold',   'Gold',   3, 30000, 7000000, 1.5, 10, '#F59E0B')
ON CONFLICT (code) DO NOTHING;
