# Production module (BOM, WIP, batch HPP)

Date: 2026-10-19. Scope: a Go bounded context `production` that runs a
production order step by step (issue materials, hold them as WIP, receive
output in batches with scrap) and costs every batch.

## What NüHabit has today

- **Tables** (schema `manufacturing`): `bom_items` (product recipe),
  `raw_material_bom_items` (recipe of an intermediate raw material, unique per
  output and component, no self reference), `production_orders`,
  `production_order_materials`, `production_batches`,
  `production_output_variants`. View `public.v_production_orders` adds item
  names and counts.
- **Go handlers** in `backend/internal/modules/inventory/production` (a
  sub-package of the inventory module, ported from the TS routes):
  `GET/POST /api/purchasing/production/orders`,
  `GET/PATCH /api/purchasing/production/orders/{id}` with the actions
  `recheck_stock`, `release`, `start`, `complete`, `cancel`; recipe lists;
  `GET /api/purchasing/production/wip` (stock of WIP raw materials); COGS
  estimates and landed costs under `/api/purchasing/cogs`.
- **Lifecycle**: DRAFT, RELEASED (stock checked), IN_PROGRESS, COMPLETED or
  CANCELLED. `complete` does everything at once: takes every material out of
  stock, writes one batch `<order>-B01`, puts the output into stock (finished
  goods, a WIP raw material, or an intermediate raw material), computes the
  actual HPP and syncs it to the POS product.
- **Frontend**: hub, recipe and order detail pages under
  `/dashboard/items/{product,raw-material}/production`, feature code in
  `frontend/src/features/purchasing/production`.
- **Accounting**: production posts no journal. Accounting posts journals from
  outbox events (`internal/contracts/*`) through `PostFromMapping` and
  `accounting.journal_mappings`.

## What Habitat has

Habitat (`habitat-new-development`) is the source NüHabit's production code
was copied from. Its manufacturing domain (`packages/core/src/manufacturing`)
holds two constants files; the routes in `apps/api/src/modules/purchasing`
(`purchasing_production_*`, `*_bom*`, `purchasing_cogs_*`) and the four pages
in `apps/web/src/features/purchasing/production` match NüHabit's TS version
line for line, minus the variant split NüHabit added. Its migrations hold the
same `manufacturing` tables. Habitat has no material issue step, no WIP
balance per order, no partial receipts, no scrap or yield, and no journals;
its own progress note (`docs/purchasing/PURCHASING_PRODUCTION_PROGRESS_2026-05-24.md`)
lists WIP handling and movement history as future work.

So there is little to port. What comes from Habitat:

- the order lifecycle and its Indonesian status messages (already in NüHabit);
- the WIP material convention: an order with `output_type = WIP` produces a
  raw material with `material_type = 'WIP'` and `source_product_id` set,
  which later recipes use as a component. The multi-level explosion below
  follows that link.

Everything else in this note is new code.

## What the module adds

1. **Multi-level BOM explosion.** A product recipe lists raw materials; a raw
   material can have its own recipe (`raw_material_bom_items`) or be the WIP
   mirror of a product (`source_product_id`, then that product's
   `bom_items`). The explosion walks those links up to 8 levels, stops on a
   cycle with an error naming the item, and returns per node the gross
   quantity, stock on hand, shortage, average cost and the rolled-up cost of
   its children. The leaf list sums what has to be bought when every
   intermediate is made in-house, net of the intermediates already in stock.
2. **Material issue.** Staff issue part or all of an order's materials, in
   several issues if needed. Each issue takes stock out at the current
   average cost of the balance it draws from and records the issue number
   (`<order>-I01`, `-I02`, ...). The first issue on a RELEASED order starts
   it. Over-issue beyond the plan is allowed and shows as a variance.
3. **WIP tracking.** The WIP value of an order is issued material value minus
   the material value already received into stock or written off as scrap.
   `GET /api/production/wip` lists open orders with that balance.
4. **Output receipt in batches.** Each receipt records good quantity, scrap
   quantity and whether it is the final receipt. It creates a batch
   (`<order>-B01`, `-B02`, ...), puts the good quantity into stock and costs
   it. The final receipt completes the order.
5. **HPP per batch.** Batch cost = material cost + conversion cost
   (overhead, labor, packaging, waste cost of the order):
   - a non-final batch takes the standard material cost per unit (planned
     quantities at the issued unit costs) times the good quantity, capped by
     the WIP balance, plus its share of conversion cost
     (good quantity / planned quantity);
   - the final batch takes the whole remaining WIP balance and the remaining
     conversion cost, so the order's batches add up to what was issued;
   - scrap in a batch carries no cost of its own: normal loss raises the HPP
     of the good units. A final receipt with zero good units writes the
     remaining WIP off as scrap cost.
   - yield = good / (good + scrap) per batch and per order; planned yield =
     good / planned quantity.

## Data model

Reuse `production_orders`, `production_order_materials`,
`production_batches`, `production_output_variants`, `bom_items`,
`raw_material_bom_items`. One delta, `20261019100000_production_issue_receipt.sql`:

- `manufacturing.production_issues`: one row per issue (order, number,
  total cost, note, creator, time).
- `manufacturing.production_issue_lines`: order material line, raw material,
  quantity, unit and total cost, the inventory movement it wrote, warehouse.
- `production_order_materials`: `qty_issued`, `issued_cost` (running totals,
  kept in the issue transaction).
- `production_batches`: `qty_scrap`, `material_cost`, `conversion_cost`,
  `scrap_cost`, `is_final`, `catatan`. `qty_produced` stays the good
  quantity, `total_cost` = material + conversion, `hpp_per_unit` = total /
  good.
- journal mappings `PRODUCTION_MATERIAL_ISSUE`, `PRODUCTION_CONVERSION_COST`,
  `PRODUCTION_OUTPUT_RECEIPT`, `PRODUCTION_SCRAP` for every company that has
  `PURCHASE_GRN`, inventory and COGS accounts copied from the existing
  mappings, WIP and applied overhead accounts left empty.
- menus `items.{product,raw-material}.production.wip` and
  `.batches`, granted to the roles that hold the production hub menu, and
  added to the keep list in `backend/database/seeders/iam-menus.sql`.

The same delta indexes issues by order, issue lines by order material, and
batches by creation time for the batch list.

## Endpoints (module `production`, prefix `/api/production`)

| Method | Path | Guard | Purpose |
| --- | --- | --- | --- |
| GET | `/api/production/bom/explode?product_id=&raw_material_id=&qty=` | read | multi-level explosion |
| GET | `/api/production/orders/{id}/flow` | read | order, material lines with issued and remaining quantity, issues, batches, WIP summary |
| POST | `/api/production/orders/{id}/issues` | update | issue materials |
| POST | `/api/production/orders/{id}/receipts` | update | receive a batch (good, scrap, final, variants, conversion overrides on the final one) |
| GET | `/api/production/wip?production_context=&search=` | read | open orders with WIP value |
| GET | `/api/production/batches?production_context=&order_id=&search=&limit=` | read | batches with cost and yield |
| GET | `/api/production/batches/{id}` | read | one batch: cost split, material share per line, yield, variants |

Read = a granted menu under `iam.ItemsProduction`
(`items.product.production`, `items.raw-material.production`); update = the
`update` action on one of those menus (the hub menus grant it).

The legacy order routes stay in the inventory module. Once an order has an
issue, the legacy `complete` and `cancel` actions refuse it, so stock leaves
through one path only. Moving the legacy routes into this module is a
follow-up; until then both packages write `manufacturing.*`.

## Inventory

The module never writes `inventory.*` or `item.*`. It declares ports in its
own package and `internal/app` adapts the inventory ledger:

- `Stock.Issue`: takes a quantity out of one raw material balance (the
  requested warehouse, else the order's branch, else the largest balance),
  locks the row, refuses a shortage, writes an `out` movement with reference
  `production_issue`, and returns the movement id and unit cost. New in
  `inventory/ledger` as `IssueToProduction`.
- `Stock.ReceiveMaterial`: an intermediate or WIP raw material comes in at
  the batch HPP (weighted average), idempotent per batch. Reuses
  `ledger.AddFromProduction` with the batch id as reference.
- `Stock.ReceiveGoods`: finished goods in at the weighted average, plus one
  movement per posted variant. New `ledger.AddFinishedGoodsFromProduction`
  (the body of the legacy `postFinishedGoods`, which now calls it too).
- `Stock.WipMaterial`: the WIP raw material mirroring a product, created on
  first use (the legacy `ensureWip`, exported).
- `Catalog.Materials` / `Catalog.Item`: names, units, stock on hand and
  average cost for the explosion and the flow view.
- `Pos.Variants`, `Pos.AddSkuStock`, `Pos.SyncHpp`: the merchandise SKUs of a
  product, SKU stock for the variant split, and the HPP sync after the final
  receipt (the existing `inventoryPosOutput` adapter).

The ports run on the caller's transaction, so an issue or receipt is atomic
with its stock movements.

## Accounting

Accounting has no synchronous posting port; it posts from outbox events. The
module publishes in the issue or receipt transaction (contracts in
`internal/contracts/production`):

- `production.materials.issued` (issue id, number, order, company, date,
  total) -> `PRODUCTION_MATERIAL_ISSUE`: debit WIP, credit inventory.
- `production.output.received` (batch id, number, order, company, date,
  material, conversion and scrap cost) ->
  `PRODUCTION_CONVERSION_COST` (debit WIP, credit applied overhead),
  `PRODUCTION_OUTPUT_RECEIPT` (debit inventory, credit WIP, material +
  conversion), `PRODUCTION_SCRAP` (debit COGS, credit WIP) when scrap cost is
  above zero. Each is keyed by the batch id, so a redelivery finds the entry
  it already wrote.

Until an accountant fills the WIP and applied overhead accounts, the mapping
is incomplete and the journal is not written (the handler logs the reason),
the same rule the other mappings follow.

## Frontend

- Order detail page: a "Langkah Produksi" card with "Keluarkan Bahan"
  (issue dialog, per line remaining quantity and stock) and "Terima Hasil"
  (good, scrap, final, variants, conversion costs on the final receipt), the
  WIP balance and the batch list. The legacy one-shot "Terima Output" stays
  for orders without issues.
- New pages per context: `production/wip` (WIP per order) and
  `production/batches` plus `production/batches/[id]` (batch cost).
- `/api/production` routes reach Go through the route manifest.

## Tests

- `production/domain`: explosion (levels, cycle, depth, net leaves), receipt
  costing (non-final cap, final remainder, zero-good write-off, conversion
  split), yield, numbering.
- `production_integration_test.go`: issue, partial and final receipts for a
  product, a WIP output and a raw material output; shortage and status
  errors; legacy guard; outbox events.
- accounting: `TestProductionJournals` posts the four journals from the
  events.

## Open questions

1. Scrap is treated as normal loss and raises HPP. Should abnormal scrap
   above a tolerance go to COGS instead?
2. Returning unused issued materials to stock: not built. A final receipt
   leaves the remaining WIP on the batch cost.
3. Which COA accounts hold WIP and applied overhead?
4. BOM units: production orders (legacy and new) use `qty_required` as is;
   the COGS view converts BOM units to the stock unit. Should orders convert
   too?
5. Should the explosion create sub-orders for intermediate shortages?
