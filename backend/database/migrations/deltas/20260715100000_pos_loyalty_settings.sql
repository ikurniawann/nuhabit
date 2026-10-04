-- POS loyalty settings (ARK conversion + XP from topup / spend)
CREATE TABLE IF NOT EXISTS pos.pos_loyalty_settings (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    ark_rate numeric(14, 2) NOT NULL DEFAULT 1000
        CHECK (ark_rate > 0),
    topup_min_amount numeric(14, 2) NOT NULL DEFAULT 10000
        CHECK (topup_min_amount >= 0),
    topup_presets jsonb NOT NULL DEFAULT '[50000, 100000, 200000, 500000, 1000000]'::jsonb,
    topup_xp_enabled boolean NOT NULL DEFAULT true,
    topup_xp_mode text NOT NULL DEFAULT 'per_amount'
        CHECK (topup_xp_mode = ANY (ARRAY['fixed'::text, 'per_amount'::text])),
    topup_xp_value numeric(14, 4) NOT NULL DEFAULT 1
        CHECK (topup_xp_value >= 0),
    topup_xp_amount_step numeric(14, 2) NOT NULL DEFAULT 10000
        CHECK (topup_xp_amount_step > 0),
    spend_xp_enabled boolean NOT NULL DEFAULT true,
    spend_xp_amount_step numeric(14, 2) NOT NULL DEFAULT 10000
        CHECK (spend_xp_amount_step > 0),
    spend_xp_min integer NOT NULL DEFAULT 1
        CHECK (spend_xp_min >= 0),
    is_active boolean NOT NULL DEFAULT true,
    updated_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_loyalty_settings_one_active_idx
    ON pos.pos_loyalty_settings ((true))
    WHERE is_active;

COMMENT ON TABLE pos.pos_loyalty_settings IS
  'Singleton master config for ARK rate, topup presets, and XP from topup/spend.';

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
ON CONFLICT (id) DO NOTHING;
