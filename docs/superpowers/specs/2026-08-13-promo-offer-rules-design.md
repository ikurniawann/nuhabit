# Promo Offer Rules (Bundling / BXGY / Volume) — Admin CRUD

Date: 2026-08-13

## Goal

Master aturan promo berbasis produk dengan **periode berlaku**, terpisah dari engine kode voucher (EPIC-032). Integrasi kalkulasi kasir POS **di luar scope** ini.

## Offer types

| Type | Meaning | Stock / recipe |
|------|---------|----------------|
| `bundle` | Produk A+B (qty) dijual seharga `bundle_price` | Stok & resep tetap per komponen produk lama |
| `bxgy` | Beli X gratis Y (same item atau daftar produk free) | Same |
| `volume` | Beli N item **atau** min belanja → diskon % / nominal | Same |

## Data

- `promo.offer_rules` — header + field tipe-spesifik + `valid_from`/`valid_until`/`is_active`
- `promo.offer_rule_items` — baris produk (`role`: `component` \| `buy` \| `get` \| `eligible`)

## Menus (CRM → Promo)

- Bundling → `/dashboard/promo/bundling`
- Buy X Get Y → `/dashboard/promo/bxgy`
- Diskon Volume → `/dashboard/promo/volume`

Kampanye Promo (kode) tetap.

## Non-goals (fase berikut)

- Auto-apply di kasir / ticketing
- Stacking dengan kode promo
- Snapshot stok terpisah untuk bundle
