# Promo Offer Rules — Implementation Plan

> Admin CRUD only; POS integration later.

**Spec:** `docs/superpowers/specs/2026-08-13-promo-offer-rules-design.md`

## Tasks

1. Migration `promo.offer_rules` + `offer_rule_items` + IAM menus under `crm.promo`
2. Lib types + pure validators (unit tests)
3. API `/api/promo/offers` + `/api/promo/offers/[id]`
4. Feature UI shared list/form; pages bundling / bxgy / volume
5. Apply migration; smoke list/create
