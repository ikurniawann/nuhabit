# POS Loyalty Settings — ARK & XP Master

## Goal
Configurable master for ARK conversion / topup presets and XP earning from topup + POS spend.

## Table
`pos.pos_loyalty_settings` — singleton active row.

## Fields
- `ark_rate` (default 1000) — IDR per 1 ARK
- `topup_min_amount` (10000)
- `topup_presets` (jsonb array of IDR amounts)
- `topup_xp_enabled`, `topup_xp_mode` (`fixed`|`per_amount`), `topup_xp_value`, `topup_xp_amount_step`
- `spend_xp_enabled`, `spend_xp_amount_step`, `spend_xp_min`

## Consumers
- Settings UI `/dashboard/pos/loyalty-settings`
- Topup page + `/api/pos/topup`
- CRM loyalty engine fallback for order/split XP when no `crm_xp_rules` match
- Cashier / orders ARK display helpers

## Defaults
Match previous hardcodes: 1 ARK = Rp 1.000; spend ≈ 1 XP / Rp 10.000 (min 1).
