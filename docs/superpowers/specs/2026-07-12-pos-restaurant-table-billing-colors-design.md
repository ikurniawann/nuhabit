# POS Restaurant Table Color States (Pre Settlement)

- **Date:** 2026-07-12
- **Status:** Approved
- **Parent:** `docs/superpowers/specs/2026-07-12-pos-restaurant-mode-design.md`
- **Scope:** Persist Pre Settlement and drive denah silhouette colors

---

## Color rules

| Condition | Board color | Display status |
|-----------|-------------|----------------|
| No active order / paid done | Green | `available` |
| Active order, not pre-settled | Orange (amber) | `occupied` |
| Pre Settlement done, no new order since | Red | `billing` |
| Pre Settlement then add order again | Orange | `occupied` (clear flag) |
| Reserved / maintenance (no active order) | Blue / slate | unchanged |

## Persistence

- Column: `pos.pos_orders.pre_settled_at timestamptz NULL`
- **Set** when Restaurant **Pre Settlement** succeeds
- Then print **preview bill** on restaurant (no cashier `pay=1` handoff)
- **Clear** when a new **open bill** is saved for the same `table_id` (add order again)
- **Paid** completes the order → table no longer active → green

## API / UI

- `POST/PATCH` helper or `POST /api/pos/orders/[id]/pre-settle` sets `pre_settled_at = now()`
- Tables list returns `active_order.pre_settled_at`
- Normalize board status: active + pre_settled → `billing`
- `FloorPlanCanvas` / `statusNodeTone`: `billing` → red
- Restaurant action rail Pre Settlement: call pre-settle API (toast on failure), refresh board to `billing`, print preview bill; stay on restaurant

## Non-goals

- Changing reserved/maintenance semantics
- New table master statuses in CRUD forms (derived at read time is enough)
