-- Ensure default POS loyalty settings row exists
INSERT INTO pos.pos_loyalty_settings (
    id,
    ark_rate,
    topup_min_amount,
    topup_presets,
    topup_xp_enabled,
    topup_xp_mode,
    topup_xp_value,
    topup_xp_amount_step,
    spend_xp_enabled,
    spend_xp_amount_step,
    spend_xp_min,
    is_active
)
VALUES (
    'a0000000-0000-4000-8000-000000000001',
    1000,
    10000,
    '[50000, 100000, 200000, 500000, 1000000]'::jsonb,
    true,
    'per_amount',
    1,
    10000,
    true,
    10000,
    1,
    true
)
ON CONFLICT (id) DO UPDATE SET
    is_active = true,
    updated_at = now();
