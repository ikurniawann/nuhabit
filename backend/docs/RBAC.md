# Staff API access per sub-module

A role gets IAM menu codes (`iam.role_menu_permissions`). The dashboard opens a page when the role holds its menu (`frontend/src/app/dashboard/(dashboard)/layout.tsx`), and each staff API route accepts only the menu codes of the pages that call it. Access is per sub-module: a role with Items > Produk cannot call purchase order routes, and a role with Payroll cannot call Recruitment routes. Actions (`create`, `update`, …) stay as they were; only routes that already checked an action still do.

Shared lookups (units, warehouses, employee picker, member search, products) accept every sub-module whose pages use them. Guards match by prefix, so a code also covers the codes below it (`gym.schedule` covers `gym.schedule.templates`).

Each module has a `TestSubModuleGuards` or `rbac_integration_test.go` that proves the owning menu passes and a sibling menu gets 403. When you add a route, add its codes here and to that test.

**Roles with only a group code** (for example `pos`, `crm.settings` or `accounting` without any leaf) no longer pass these guards. The seeded roles grant whole modules, leaves included. Check custom roles before deploying (see DEPLOY.md).

## Items: purchasing, inventory, production

### RBAC map: Items procurement, inventory and production routes

Guard per route = Items sub-modules (menu code prefixes) whose dashboard pages call it. A role passes when it holds that menu code or any menu below it.
"pages" lists the sub-modules found calling the path (import-graph scan of frontend/src from each dashboard page, symbol-aware through barrels); a path-level caller set can be wider than one method.

Legend: product = items.product.*, raw = items.raw-material.*, general = items.general.*.

| Method | Path | Sub-module menu codes allowed | Notes |
|---|---|---|---|
| GET | `/api/inventory` | items.product.inventory, items.raw-material.inventory | orphan page /dashboard/inventory (no menu); kept on both inventory sub-modules |
| GET | `/api/inventory/batches` | items.raw-material.inventory | pages: items.raw-material.inventory |
| GET | `/api/inventory/expiry` | items.raw-material.inventory | pages: items.raw-material.inventory |
| GET | `/api/inventory/finished-goods` | items.product.inventory | pages: items.product.inventory |
| POST | `/api/inventory/finished-goods/adjustment` | items.product.inventory | pages: items.product.inventory |
| GET | `/api/inventory/low-stock` | items.product.inventory, items.raw-material.inventory | orphan page /dashboard/inventory/low-stock (no menu); kept on both inventory sub-modules |
| GET | `/api/inventory/materials` | items.raw-material.inventory | pages: items.raw-material.inventory |
| GET | `/api/inventory/movements` | items.raw-material.inventory | pages: items.raw-material.inventory |
| GET | `/api/inventory/product-stock-opnames` | items.product.inventory | pages: items.product.inventory |
| POST | `/api/inventory/product-stock-opnames` | items.product.inventory | pages: items.product.inventory |
| GET | `/api/inventory/product-stock-opnames/preview` | items.product.inventory | pages: items.product.inventory |
| GET | `/api/inventory/product-stock-opnames/{id}` | items.product.inventory | pages: items.product.inventory |
| PATCH | `/api/inventory/product-stock-opnames/{id}` | items.product.inventory | pages: items.product.inventory |
| POST | `/api/inventory/product-stock-opnames/{id}/complete` | items.product.inventory | pages: items.product.inventory |
| GET | `/api/inventory/raw-materials` | items.raw-material.inventory | pages: items.raw-material.inventory |
| GET | `/api/inventory/scrap` | items.raw-material.inventory | pages: items.raw-material.inventory |
| POST | `/api/inventory/scrap` | items.raw-material.inventory | pages: items.raw-material.inventory |
| GET | `/api/inventory/stock-opnames` | items.raw-material.inventory | pages: items.raw-material.inventory |
| POST | `/api/inventory/stock-opnames` | items.raw-material.inventory | pages: items.raw-material.inventory |
| GET | `/api/inventory/stock-opnames/preview` | items.raw-material.inventory | pages: items.raw-material.inventory |
| GET | `/api/inventory/stock-opnames/{id}` | items.raw-material.inventory | pages: items.raw-material.inventory |
| PATCH | `/api/inventory/stock-opnames/{id}` | items.raw-material.inventory | pages: items.raw-material.inventory |
| POST | `/api/inventory/stock-opnames/{id}/complete` | items.raw-material.inventory | pages: items.raw-material.inventory |
| GET | `/api/inventory/{id}/{sub}` | items.product.inventory, items.raw-material.inventory | pages: items.product.inventory, items.raw-material.inventory |
| GET | `/api/production/batches` | items.product.production, items.raw-material.production | pages: items.product.production, items.raw-material.production |
| GET | `/api/production/batches/{id}` | items.product.production, items.raw-material.production | pages: items.product.production, items.raw-material.production |
| GET | `/api/production/bom/explode` | items.product.production, items.raw-material.production | pages: items.product.production, items.raw-material.production |
| GET | `/api/production/orders/{id}/flow` | items.product.production, items.raw-material.production | pages: items.product.production, items.raw-material.production |
| POST | `/api/production/orders/{id}/issues` | items.product.production, items.raw-material.production | writer: update action on a production menu (unchanged) |
| POST | `/api/production/orders/{id}/receipts` | items.product.production, items.raw-material.production | writer: update action on a production menu (unchanged) |
| POST | `/api/production/orders/{id}/returns` | items.product.production, items.raw-material.production | writer: update action on a production menu (unchanged) |
| POST | `/api/production/orders/{id}/sub-orders` | items.product.production, items.raw-material.production | writer: update action on a production menu (unchanged) |
| GET | `/api/production/recipe-settings` | items.product.master, items.raw-material.master | product_id: items.product.master; raw_material_id: items.raw-material.master (BOM editors) |
| PUT | `/api/production/recipe-settings` | items.product.master, items.raw-material.master | product_id: items.product.master; raw_material_id: items.raw-material.master (BOM editors) |
| GET | `/api/production/wip` | items.product.production, items.raw-material.production | pages: items.product.production, items.raw-material.production |
| DELETE | `/api/purchasing/bom/{id}` | items.product.master, pos.catalog | pages: items.product.master, items.reports, pos |
| PUT | `/api/purchasing/bom/{id}` | items.product.master, pos.catalog | pages: items.product.master, items.reports, pos |
| GET | `/api/purchasing/cogs/additional-cost` | items.product.production, items.raw-material.production, items.raw-material.master | pages: items.product.production, items.raw-material.master, items.raw-material.production |
| POST | `/api/purchasing/cogs/additional-cost` | items.product.production, items.raw-material.production, items.raw-material.master | pages: items.product.production, items.raw-material.master, items.raw-material.production |
| DELETE | `/api/purchasing/cogs/additional-cost/{id}` | items.product.production, items.raw-material.production, items.raw-material.master | pages: items.product.production, items.raw-material.production |
| GET | `/api/purchasing/cogs/product/{produk_id}` | items.product.production, items.raw-material.production | pages: items.product.production, items.raw-material.production |
| GET | `/api/purchasing/cogs/raw-material/{id}` | items.product.production, items.raw-material.production | pages: items.product.production, items.raw-material.production |
| GET | `/api/purchasing/dashboard` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing, items.product.approval, items.raw-material.approval | page /dashboard/purchasing has no menu row; purchasing + approval sub-modules |
| GET | `/api/purchasing/deliveries` | items.product.purchasing, items.raw-material.purchasing | no dashboard caller found; owner sub-module |
| POST | `/api/purchasing/deliveries` | items.product.purchasing, items.raw-material.purchasing | no dashboard caller found; owner sub-module |
| DELETE | `/api/purchasing/deliveries/{id}` | items.product.purchasing, items.raw-material.purchasing | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/deliveries/{id}` | items.product.purchasing, items.raw-material.purchasing | no dashboard caller found; owner sub-module |
| PUT | `/api/purchasing/deliveries/{id}` | items.product.purchasing, items.raw-material.purchasing | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/delivery` | items.product.purchasing, items.raw-material.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| POST | `/api/purchasing/delivery` | items.product.purchasing, items.raw-material.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| GET | `/api/purchasing/delivery/for-grn` | items.product.purchasing, items.raw-material.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| GET | `/api/purchasing/delivery/po-options` | items.product.purchasing, items.raw-material.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| DELETE | `/api/purchasing/delivery/{id}` | items.product.purchasing, items.raw-material.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| GET | `/api/purchasing/delivery/{id}` | items.product.purchasing, items.raw-material.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| PUT | `/api/purchasing/delivery/{id}` | items.product.purchasing, items.raw-material.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| POST | `/api/purchasing/delivery/{id}/arrive` | items.product.purchasing, items.raw-material.purchasing | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/docs/spec` | unchanged (410/400 stub or public spec) | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/export/products` | items.product.master | pages: items.product.master |
| GET | `/api/purchasing/export/raw-materials` | items.raw-material.master | pages: items.raw-material.master |
| GET | `/api/purchasing/export/suppliers` | items.raw-material.purchasing | pages: items.raw-material.purchasing |
| GET | `/api/purchasing/grn` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing, items.product.production, items.raw-material.production | pages: items.general.purchasing, items.product.production, items.product.purchasing, items.raw-material.production, items.raw-material.purchasing |
| PATCH | `/api/purchasing/grn` | unchanged (410/400 stub or public spec) | pages: items.general.purchasing, items.product.production, items.product.purchasing, items.raw-material.production, items.raw-material.purchasing |
| POST | `/api/purchasing/grn` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.general.purchasing, items.product.production, items.product.purchasing, items.raw-material.production, items.raw-material.purchasing |
| DELETE | `/api/purchasing/grn/{id}` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| GET | `/api/purchasing/grn/{id}` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| PATCH | `/api/purchasing/grn/{id}` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| GET | `/api/purchasing/grn/{id}/items` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | no dashboard caller found; owner sub-module |
| POST | `/api/purchasing/grn/{id}/items` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/grn/{id}/qc` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| POST | `/api/purchasing/grn/{id}/qc` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| GET | `/api/purchasing/grn/{id}/returnable-items` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| GET | `/api/purchasing/grn/{id}/vendor-credits` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| POST | `/api/purchasing/import/products` | items.product.master | pages: items.product.master |
| POST | `/api/purchasing/import/raw-materials` | items.raw-material.master | pages: items.raw-material.master |
| POST | `/api/purchasing/import/suppliers` | items.raw-material.purchasing | pages: items.raw-material.purchasing |
| POST | `/api/purchasing/import/units` | items.product.master, items.raw-material.master | pages: items.product.master, items.raw-material.master |
| GET | `/api/purchasing/inventory` | items.raw-material.inventory | no dashboard caller found; owner sub-module |
| POST | `/api/purchasing/inventory/adjustment` | items.raw-material.inventory | pages: items.raw-material.inventory |
| GET | `/api/purchasing/inventory/movements` | items.raw-material.inventory | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/inventory/supply` | items.general.inventory | pages: items.general.inventory |
| POST | `/api/purchasing/inventory/supply-adjustment` | items.general.inventory | pages: items.general.inventory |
| GET | `/api/purchasing/inventory/supply-usage` | items.general.inventory | was any signed-in user; now general inventory only |
| POST | `/api/purchasing/inventory/supply-usage` | items.general.inventory | pages: items.general.inventory |
| GET | `/api/purchasing/inventory/supply/form-data` | items.general.inventory | pages: items.general.inventory |
| GET | `/api/purchasing/inventory/supply/{id}` | items.general.inventory | pages: items.general.inventory |
| GET | `/api/purchasing/inventory/transfer` | items.raw-material.inventory | pages: items.raw-material.inventory |
| POST | `/api/purchasing/inventory/transfer` | items.raw-material.inventory | pages: items.raw-material.inventory |
| GET | `/api/purchasing/inventory/transfer/preview` | items.raw-material.inventory | pages: items.raw-material.inventory |
| GET | `/api/purchasing/inventory/{id}` | items.raw-material.inventory | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/inventory/{id}/{sub}` | items.raw-material.inventory, items.general.inventory | pages: items.general.inventory |
| GET | `/api/purchasing/items/{lookup}` | items.product.master, items.raw-material.master, items.general.master | pages: items.general.master, items.product.master, items.raw-material.master |
| POST | `/api/purchasing/items/{lookup}` | items.product.master, items.raw-material.master, items.general.master | pages: items.general.master, items.product.master, items.raw-material.master |
| DELETE | `/api/purchasing/items/{lookup}/{id}` | items.product.master, items.raw-material.master, items.general.master | no dashboard caller found; owner sub-module |
| PUT | `/api/purchasing/items/{lookup}/{id}` | items.product.master, items.raw-material.master, items.general.master | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/materials` | items.raw-material.master | no dashboard caller found; owner sub-module |
| POST | `/api/purchasing/materials` | items.raw-material.master | no dashboard caller found; owner sub-module |
| DELETE | `/api/purchasing/materials/{id}` | items.raw-material.master | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/materials/{id}` | items.raw-material.master | no dashboard caller found; owner sub-module |
| PUT | `/api/purchasing/materials/{id}` | items.raw-material.master | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/po` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing, items.product.approval, items.raw-material.approval, items.product.production, items.raw-material.production | pages: items.general.purchasing, items.product.approval, items.product.production, items.product.purchasing, items.raw-material.approval, items.raw-material.production, items.raw-material.purchasing |
| POST | `/api/purchasing/po` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.general.purchasing, items.product.approval, items.product.production, items.product.purchasing, items.raw-material.approval, items.raw-material.production, items.raw-material.purchasing |
| GET | `/api/purchasing/po-items` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.product.purchasing |
| GET | `/api/purchasing/po/form-data` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.general.purchasing, items.product.purchasing |
| DELETE | `/api/purchasing/po/items/{item_id}` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | no dashboard caller found; owner sub-module |
| PUT | `/api/purchasing/po/items/{item_id}` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | no dashboard caller found; owner sub-module |
| DELETE | `/api/purchasing/po/{id}` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: accounting.accounts-payable, items.general.purchasing, items.product.purchasing, items.raw-material.purchasing |
| GET | `/api/purchasing/po/{id}` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing, accounting.accounts-payable | pages: accounting.accounts-payable, items.general.purchasing, items.product.purchasing, items.raw-material.purchasing |
| PUT | `/api/purchasing/po/{id}` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: accounting.accounts-payable, items.general.purchasing, items.product.purchasing, items.raw-material.purchasing |
| POST | `/api/purchasing/po/{id}/approve` | action("update", iam.ItemsApproval...) | action guard kept: update on an approval menu (ItemsApproval) |
| POST | `/api/purchasing/po/{id}/cancel` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing, accounting.accounts-payable | pages: accounting.accounts-payable, items.general.purchasing, items.product.purchasing, items.raw-material.purchasing |
| POST | `/api/purchasing/po/{id}/close` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing, accounting.accounts-payable | pages: accounting.accounts-payable, items.raw-material.purchasing |
| GET | `/api/purchasing/po/{id}/items` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| POST | `/api/purchasing/po/{id}/items` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| GET | `/api/purchasing/po/{id}/payment-terms` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing, accounting.accounts-payable | pages: accounting.accounts-payable, items.raw-material.purchasing |
| POST | `/api/purchasing/po/{id}/payment-terms` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing, accounting.accounts-payable | pages: accounting.accounts-payable, items.raw-material.purchasing |
| DELETE | `/api/purchasing/po/{id}/payment-terms/{termId}` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing, accounting.accounts-payable | pages: accounting.accounts-payable, items.raw-material.purchasing |
| POST | `/api/purchasing/po/{id}/payments` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | no dashboard caller found; owner sub-module |
| POST | `/api/purchasing/po/{id}/receive` | unchanged (410/400 stub or public spec) | no dashboard caller found; owner sub-module |
| POST | `/api/purchasing/po/{id}/send` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing, accounting.accounts-payable | pages: accounting.accounts-payable, items.general.purchasing, items.product.purchasing, items.raw-material.purchasing |
| GET | `/api/purchasing/pr` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing, items.product.approval, items.raw-material.approval | pages: items.general.purchasing, items.product.approval, items.product.purchasing, items.raw-material.approval, items.raw-material.purchasing |
| POST | `/api/purchasing/pr` | action("create", iam.ItemsPr...) | action guard kept: create on a PR menu (ItemsPr) |
| GET | `/api/purchasing/pr/for-po` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.general.purchasing, items.product.purchasing |
| GET | `/api/purchasing/pr/form-data` | action("create", iam.ItemsPr...) | action guard kept: create on a PR menu (ItemsPr) |
| GET | `/api/purchasing/pr/{id}` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.general.purchasing, items.product.purchasing, items.raw-material.purchasing |
| PUT | `/api/purchasing/pr/{id}` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.general.purchasing, items.product.purchasing, items.raw-material.purchasing |
| POST | `/api/purchasing/pr/{id}/approve` | action("update", iam.ItemsPrApproval...) | action guard kept: update on a PR approval menu (ItemsPrApproval) |
| POST | `/api/purchasing/pr/{id}/convert-to-po` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | no dashboard caller found; owner sub-module |
| POST | `/api/purchasing/pr/{id}/revise` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.general.purchasing, items.product.purchasing, items.raw-material.purchasing |
| POST | `/api/purchasing/pr/{id}/submit` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.raw-material.purchasing |
| GET | `/api/purchasing/production/orders` | items.product.production, items.raw-material.production | pages: items.product.production, items.raw-material.production |
| POST | `/api/purchasing/production/orders` | items.product.production, items.raw-material.production | pages: items.product.production, items.raw-material.production |
| GET | `/api/purchasing/production/orders/{id}` | items.product.production, items.raw-material.production | pages: items.product.production, items.raw-material.production |
| PATCH | `/api/purchasing/production/orders/{id}` | items.product.production, items.raw-material.production | pages: items.product.production, items.raw-material.production |
| GET | `/api/purchasing/production/product-recipes` | items.product.production, items.raw-material.production, items.product.master, items.raw-material.master | pages: items.product.master, items.product.production, items.raw-material.master, items.raw-material.production |
| GET | `/api/purchasing/production/raw-material-recipes` | items.product.production, items.raw-material.production, items.product.master, items.raw-material.master | pages: items.product.master, items.product.production, items.raw-material.master, items.raw-material.production |
| GET | `/api/purchasing/production/wip` | items.product.production, items.raw-material.production | pages: items.product.production, items.raw-material.production |
| GET | `/api/purchasing/products` | items.product.master, items.reports, pos.catalog | pages: items.product.master, items.reports, pos, pos.catalog |
| POST | `/api/purchasing/products` | items.product.master | pages: items.product.master, items.reports, pos, pos.catalog |
| DELETE | `/api/purchasing/products/{id}` | items.product.master | pages: items.product.master, items.reports |
| GET | `/api/purchasing/products/{id}` | items.product.master, items.reports | pages: items.product.master, items.reports |
| PUT | `/api/purchasing/products/{id}` | items.product.master | pages: items.product.master, items.reports |
| POST | `/api/purchasing/products/{id}/apply-recipe-hpp` | items.product.master, items.reports | pages: items.product.master, items.reports |
| GET | `/api/purchasing/products/{id}/bom` | items.product.master, pos.catalog, items.reports | pages: items.product.master, items.reports, pos |
| POST | `/api/purchasing/products/{id}/bom` | items.product.master, pos.catalog | pages: items.product.master, items.reports, pos |
| GET | `/api/purchasing/qc` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | no dashboard caller found; owner sub-module |
| POST | `/api/purchasing/qc` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/qc/{id}` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | no dashboard caller found; owner sub-module |
| DELETE | `/api/purchasing/raw-material-bom/{id}` | items.raw-material.master | pages: items.raw-material.master |
| PUT | `/api/purchasing/raw-material-bom/{id}` | items.raw-material.master | pages: items.raw-material.master |
| GET | `/api/purchasing/raw-materials` | items.product.master, items.raw-material.master, items.raw-material.purchasing, items.reports, pos.catalog | pages: items.product.master, items.raw-material.master, items.raw-material.purchasing, items.reports, pos |
| POST | `/api/purchasing/raw-materials` | items.raw-material.master | pages: items.product.master, items.raw-material.master, items.raw-material.purchasing, items.reports, pos |
| DELETE | `/api/purchasing/raw-materials/{id}` | items.raw-material.master | pages: items.raw-material.master |
| GET | `/api/purchasing/raw-materials/{id}` | items.raw-material.master | pages: items.raw-material.master |
| PATCH | `/api/purchasing/raw-materials/{id}` | items.raw-material.master | pages: items.raw-material.master |
| PUT | `/api/purchasing/raw-materials/{id}` | items.raw-material.master | pages: items.raw-material.master |
| GET | `/api/purchasing/raw-materials/{id}/bom` | items.raw-material.master, items.raw-material.purchasing | pages: items.raw-material.master, items.raw-material.purchasing |
| POST | `/api/purchasing/raw-materials/{id}/bom` | items.raw-material.master | pages: items.raw-material.master, items.raw-material.purchasing |
| GET | `/api/purchasing/raw-materials/{id}/price-history` | items.raw-material.master, items.raw-material.purchasing | pages: items.raw-material.master, items.raw-material.purchasing |
| GET | `/api/purchasing/raw-materials/{id}/purchase-price` | items.raw-material.master, items.raw-material.purchasing | pages: items.raw-material.master, items.raw-material.purchasing |
| POST | `/api/purchasing/receipt-scan` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/receipts/{path...}` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing, accounting.accounts-payable | pages: accounting.accounts-payable, items.raw-material.purchasing |
| GET | `/api/purchasing/receiving-workspace` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| GET | `/api/purchasing/reports/inventory-valuation` | items.reports | pages: items.reports |
| GET | `/api/purchasing/reports/po-detail` | items.reports | pages: items.reports |
| GET | `/api/purchasing/reports/po-summary` | items.reports | pages: items.reports |
| GET | `/api/purchasing/reports/production-in-house` | items.reports | pages: items.reports |
| GET | `/api/purchasing/reports/stock-card` | items.reports | pages: items.reports |
| GET | `/api/purchasing/reports/supplier-performance` | items.reports | pages: items.reports |
| GET | `/api/purchasing/return` | unchanged (410/400 stub or public spec) | no dashboard caller found; owner sub-module |
| POST | `/api/purchasing/return` | unchanged (410/400 stub or public spec) | no dashboard caller found; owner sub-module |
| DELETE | `/api/purchasing/return/{id}` | unchanged (410/400 stub or public spec) | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/return/{id}` | unchanged (410/400 stub or public spec) | no dashboard caller found; owner sub-module |
| PUT | `/api/purchasing/return/{id}` | unchanged (410/400 stub or public spec) | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/returns` | items.product.purchasing, items.raw-material.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| POST | `/api/purchasing/returns` | items.product.purchasing, items.raw-material.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| GET | `/api/purchasing/returns/grn-options` | items.product.purchasing, items.raw-material.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| GET | `/api/purchasing/returns/{id}` | items.product.purchasing, items.raw-material.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| PATCH | `/api/purchasing/returns/{id}` | items.product.purchasing, items.raw-material.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| PATCH | `/api/purchasing/returns/{id}/approve` | items.product.purchasing, items.raw-material.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| PATCH | `/api/purchasing/returns/{id}/reject` | items.product.purchasing, items.raw-material.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| POST | `/api/purchasing/returns/{id}/revise` | items.product.purchasing, items.raw-material.purchasing | pages: items.product.purchasing, items.raw-material.purchasing |
| GET | `/api/purchasing/suppliers` | items.product.purchasing, items.raw-material.purchasing, items.reports | pages: items.product.purchasing, items.raw-material.purchasing, items.reports |
| POST | `/api/purchasing/suppliers` | items.raw-material.purchasing | pages: items.product.purchasing, items.raw-material.purchasing, items.reports |
| DELETE | `/api/purchasing/suppliers/{id}` | items.raw-material.purchasing | pages: items.raw-material.purchasing |
| GET | `/api/purchasing/suppliers/{id}` | items.raw-material.purchasing | pages: items.raw-material.purchasing |
| PUT | `/api/purchasing/suppliers/{id}` | items.raw-material.purchasing | pages: items.raw-material.purchasing |
| GET | `/api/purchasing/suppliers/{id}/price-history` | items.raw-material.purchasing | pages: items.raw-material.purchasing |
| GET | `/api/purchasing/supply-items` | items.general.master | pages: items.general.master |
| POST | `/api/purchasing/supply-items` | items.general.master | pages: items.general.master |
| DELETE | `/api/purchasing/supply-items/{id}` | items.general.master | pages: items.general.master |
| GET | `/api/purchasing/supply-items/{id}` | items.general.master | pages: items.general.master |
| PATCH | `/api/purchasing/supply-items/{id}` | items.general.master | pages: items.general.master |
| GET | `/api/purchasing/units` | items.product.master, items.raw-material.master, items.general.master, items.raw-material.purchasing, items.reports | pages: items.general.master, items.product.master, items.raw-material.master, items.raw-material.purchasing, items.reports |
| POST | `/api/purchasing/units` | items.product.master, items.raw-material.master | pages: items.general.master, items.product.master, items.raw-material.master, items.raw-material.purchasing, items.reports |
| DELETE | `/api/purchasing/units/{id}` | items.product.master, items.raw-material.master | pages: items.product.master, items.raw-material.master |
| GET | `/api/purchasing/units/{id}` | items.product.master, items.raw-material.master | pages: items.product.master, items.raw-material.master |
| PUT | `/api/purchasing/units/{id}` | items.product.master, items.raw-material.master | pages: items.product.master, items.raw-material.master |
| GET | `/api/purchasing/vendor-credits/apply` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing, accounting.accounts-payable | no dashboard caller found; owner sub-module |
| POST | `/api/purchasing/vendor-credits/apply` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing, accounting.accounts-payable | no dashboard caller found; owner sub-module |
| PATCH | `/api/purchasing/vendor-credits/{id}/approve` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing, accounting.accounts-payable | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/vendor-payments` | items.product.purchasing, items.general.purchasing, accounting.accounts-payable | pages: accounting.accounts-payable, items.general.purchasing, items.product.purchasing |
| GET | `/api/purchasing/vendor-price-list` | items.product.purchasing | no dashboard caller found; owner sub-module |
| POST | `/api/purchasing/vendor-price-list` | items.product.purchasing | no dashboard caller found; owner sub-module |
| DELETE | `/api/purchasing/vendor-price-list/{id}` | items.product.purchasing | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/vendor-price-list/{id}` | items.product.purchasing | no dashboard caller found; owner sub-module |
| PUT | `/api/purchasing/vendor-price-list/{id}` | items.product.purchasing | no dashboard caller found; owner sub-module |
| GET | `/api/purchasing/vendors` | items.product.purchasing | pages: items.product.purchasing |
| POST | `/api/purchasing/vendors` | items.product.purchasing | pages: items.product.purchasing |
| DELETE | `/api/purchasing/vendors/{id}` | items.product.purchasing | pages: items.product.purchasing |
| GET | `/api/purchasing/vendors/{id}` | items.product.purchasing | pages: items.product.purchasing |
| PUT | `/api/purchasing/vendors/{id}` | items.product.purchasing | pages: items.product.purchasing |
| GET | `/api/purchasing/warehouses` | items.product.purchasing, items.raw-material.purchasing, items.general.purchasing, items.product.inventory, items.raw-material.inventory, items.product.master, items.reports, pos.catalog, settings.users | was items.product / items.raw-material / pos.catalog / settings.users |

### Notes

- 186 of 212 routes changed guard. The rest are action guards kept as they were (PR create, PR/PO approve, production writer), 410/400 stubs, the public OpenAPI spec, and `/api/inventory`, `/api/inventory/low-stock`, `/api/inventory/{id}/movements` (still both inventory sub-modules).
- Product and raw material purchasing share the transactional PR/PO/GRN/delivery/return routes (the `module_type` parameter picks the side), so both pass those routes.
- Pages that needed a code the old guard lacked: Accounting payables (`/dashboard/accounting/accounts-payable`, `/po/[id]`) opens PO detail, PO actions, payment terms, receipts and vendor payments. The old `items` guard refused an Accounting-only role; `accounting.accounts-payable` now passes those routes (key `itemsPayables` in prefixes.ts).
- `/dashboard/shop/marketplace` reads `GET /api/purchasing/products` but `shop.*` was never allowed there; left out (not an Items page), so a shop-only role still gets 403 as before.
- `GET /api/purchasing/inventory/supply-usage` used to accept any signed-in user; it now needs `items.general.inventory`.
- Recipe settings (`/api/production/recipe-settings`) follow the BOM editors that show them: product master for a product, raw material master for a raw material. The production pages do not call them.
- No Next API route under `frontend/src/app/api` guards with `requireIam*`; only the static OpenAPI docs page lives there.

## HR, payroll, recruitment

### HR RBAC map: routes to sub-modules

Branch `rbac-hr`. Guards check leaf menu codes (iam.menus) through `RequireMenuPrefix`; a leaf code matches itself only. Keys live in `frontend/src/lib/iam/prefixes.ts` (HRIS per sub-modul section) and `backend/internal/platform/iam/prefixes_gen.go`.

Legend:
- **actor**: any signed-in user; the handler scopes rows to self, direct reports, or HR roles (`IsHR` by role). Unchanged; serves ESS (`/dashboard/me/*`) and the HR pages alike.
- **user**: any signed-in user, no scoping. Unchanged.
- **public/token**: candidate portal or public endpoint. Not staff RBAC; unchanged.
- Groups used below:
  - `EMP_RECORDS` = hris.kepegawaian.users, settings.users (the users feature is shared by /dashboard/employees and Settings → Users)
  - `EMP_PICKER` = EMP_RECORDS + hris.kepegawaian.loans, hris.kepegawaian.overtime, hris.workforce.attendance, hris.workforce.leaves, hris.compensation.salary, hris.organization.org-chart, hris.performance.feedback-360, ticketing.settings
  - `RECRUITERS` = hris.recruitment.candidates, hris.recruitment.pipeline (the two pages share the candidate detail panels)

### Kepegawaian → Karyawan (hris.kepegawaian.users), /dashboard/employees

| Method | Path | Allowed | Before | Notes |
|---|---|---|---|---|
| GET | /api/hris/employees | EMP_PICKER | kepegawaian, settings.users, workforce, compensation, organization, ticketing | shared lookup; feedback-360 and loans/overtime were missing or implicit |
| POST | /api/hris/employees | EMP_RECORDS | same | |
| PUT, DELETE | /api/hris/employees/{id} | EMP_RECORDS | same | |
| GET | /api/hris/employees/{id} | EMP_RECORDS or self | same | requireEmployeeAccess |
| GET | /api/hris/employees/documents | EMP_RECORDS or self | same | |
| POST | /api/hris/employees/documents | hris.kepegawaian.users | hris.kepegawaian | |
| PATCH, DELETE | /api/hris/employees/documents/{doc_id} | hris.kepegawaian.users | hris.kepegawaian | |
| GET, POST | /api/hris/employees/{id}/contracts | hris.kepegawaian.users | hris.kepegawaian | profile contracts tab |
| GET | /api/hris/employees/{id}/recruitment-documents | hris.kepegawaian.users | hris.kepegawaian | |
| GET | /api/hris/employees/{id}/lifecycle | EMP_RECORDS or self | same | |
| GET, PUT | /api/hris/employees/{id}/shifts | hris.kepegawaian.users, else direct manager | kepegawaian, workforce | ESS Shift Tim passes as manager |
| GET, POST | /api/hris/employees/import(/template) | create on EMP_RECORDS | same | |
| GET | /api/hris/employment-history | EMP_RECORDS or self | same | |
| POST | /api/hris/employment-history | hris.kepegawaian.users | hris.kepegawaian | |
| PATCH, DELETE | /api/hris/contracts/{id} | hris.kepegawaian.users | hris.kepegawaian | |
| GET | /api/hris/contracts/{id}/document | hris.kepegawaian.users | hris.kepegawaian | |
| GET, POST, DELETE | /api/hris/contracts/{id}/signed-document | hris.kepegawaian.users | hris.kepegawaian | |
| GET, POST, PUT | /api/hris/onboarding/{employee_id}, /api/hris/offboarding/{employee_id} | EMP_RECORDS or self | EMP_RECORDS + hris.recruitment | no recruitment page calls them; the pages are orphan routes |
| GET | /api/candidates/{id}/report | RECRUITERS + hris.kepegawaian.users | hris.recruitment | profile recruitment-documents section opens it |

### Kepegawaian, other leaves

| Method | Path | Allowed | Before |
|---|---|---|---|
| GET | /api/hris/contracts | hris.kepegawaian.contracts | hris.kepegawaian |
| GET | /api/hris/contracts/expiring | hris.kepegawaian.contracts, hris.kepegawaian.users | hris.kepegawaian |
| GET | /api/hris/kpi/recommendation | hris.kepegawaian.contracts | hris.performance |
| POST | /api/hris/shifts, PATCH/DELETE /api/hris/shifts/{id} | hris.kepegawaian.shifts | hris.kepegawaian |
| GET | /api/hris/shifts | actor | unchanged |
| POST, PATCH, DELETE | /api/hris/holidays(/{id}), GET/POST /api/hris/holidays/import | hris.kepegawaian.holidays | hris.kepegawaian |
| GET | /api/hris/holidays | user | unchanged |
| POST | /api/hris/loans/{id}/approve | hris.kepegawaian.loans | hris.compensation |
| GET, POST | /api/hris/loans | actor | unchanged |
| GET, POST | /api/hris/overtime, POST /api/hris/overtime/decide | actor | unchanged |
| GET, POST | /api/hris/announcements, PATCH/DELETE /{id}, POST /cover | hris.kepegawaian.announcements | hris.kepegawaian |
| GET | /api/hris/announcements/feed, /{id}, /cover/{path}, POST /{id}/read, GET unread-count | actor / session | unchanged (ESS) |

### Kehadiran & Cuti (hris.workforce.*)

| Method | Path | Allowed | Before |
|---|---|---|---|
| GET | /api/hris/attendance/export | hris.workforce.attendance | hris.workforce |
| GET | /api/hris/leaves/export | hris.workforce.leaves | hris.workforce |
| * | /api/hris/attendance(/…), /api/hris/leaves(/…), /api/hris/leave-balances/{id} | actor | unchanged (ESS + HR) |

### Organisasi, Master Data

| Method | Path | Allowed | Before |
|---|---|---|---|
| GET | /api/master/departments | hris.master.departments, hris.master.positions, hris.recruitment.job-portal, hris.organization.org-chart, EMP_RECORDS | any hris.*, settings.users |
| POST, PUT, DELETE | /api/master/departments(/{id}), import + template | hris.master.departments | hris.master |
| GET | /api/master/positions | hris.master.positions, hris.recruitment.job-portal, EMP_RECORDS | any hris.*, settings.users |
| POST, PUT, DELETE | /api/master/positions(/{id}), import + template | hris.master.positions | hris.master |
| GET | /api/master/employment-statuses | hris.master.employment-statuses, EMP_RECORDS | any hris.*, settings.users |
| POST, PUT, DELETE | /api/master/employment-statuses(/{id}) | hris.master.employment-statuses | hris.master |
| GET | /api/positions | hris.master.positions, hris.recruitment.job-portal | any hris.* | no frontend caller |
| POST | /api/positions | hris.master.positions | hris.master | no frontend caller |
| GET | /api/hris/departments | user | unchanged (announcement form) |

### Penggajian (hris.compensation.*)

| Method | Path | Allowed | Before |
|---|---|---|---|
| GET, POST | /api/hris/payroll; GET, PUT, DELETE /{id}; POST /{id}/calculate | hris.compensation.payroll | hris.compensation |
| GET, PUT | /api/hris/payroll-settings | hris.compensation.payroll (+ role check on PUT) | hris.compensation |
| POST | /api/hris/payslips/notify | hris.compensation.payroll | hris.compensation |
| GET | /api/hris/payslips, /api/hris/payslips/{id}/pdf | actor | unchanged (ESS slip gaji) |
| * | /api/hris/employee-salary(/{id}) | hris.compensation.salary | hris.compensation |

### Kinerja (hris.performance.*)

| Method | Path | Allowed | Before |
|---|---|---|---|
| GET, POST, DELETE | /api/hris/kpi/targets | hris.performance.kpi-scorecard | hris.performance |
| PATCH | /api/hris/kpi/scorecards | hris.performance.kpi-scorecard | hris.performance |
| POST | /api/hris/kpi/snapshot | hris.performance.kpi-scorecard | hris.performance |
| GET | /api/hris/kpi/scorecards, POST /api/hris/kpi/rubric | actor | unchanged (ESS KPI) |
| GET, PUT | /api/hris/kpi-config | hris.performance.kpi-config (+ KPI role) | any hris.* |
| GET | /api/hris/dept-tasks/kpi/contributions | read on tasks, tasks.kpi, or hris.performance.kpi-scorecard | hris.performance |
| * | /api/hris/feedback-{categories,cycles,assignments,responses,summaries,approvals} | hris.performance.feedback-360 | feedback-360, kpi-scorecard, kpi-config |
| * | /api/hris/me/feedback-360 | session | unchanged (ESS) |
| * | /api/hris/performance/*, /api/hris/dept-tasks (board, occurrences), /api/hris/logbook | actor | unchanged |
| * | /api/hris/dept-tasks/{meta,items,monitor,kpi,occurrences/…} | tasks / tasks.team / tasks.kpi grants | unchanged |

Also `KpiAll` (contribution scope) reads hris.performance.kpi-scorecard instead of hris.performance.

### Rekrutmen (hris.recruitment.*)

| Method | Path | Allowed | Before |
|---|---|---|---|
| GET | /api/candidates | RECRUITERS + hris.recruitment.talent-pool | hris.recruitment |
| POST | /api/candidates/{id}/stage | RECRUITERS + hris.recruitment.talent-pool | hris.recruitment |
| POST | /api/candidates; GET, PUT, DELETE /{id}; notes, activities, screening, psikotes, interview, offers, cv-upload, cv-extract, ai-analysis | RECRUITERS | hris.recruitment |
| GET | /api/interview/files/{path}, /api/psikotes/files/{path}, /api/interview/sessions/{id}/recordings, proctor-events, session-tests answers/review/ai-insight | RECRUITERS | hris.recruitment |
| PUT | /api/offers/{id}/response | RECRUITERS | hris.recruitment |
| POST | /api/hris/promote | RECRUITERS | hris.recruitment |
| GET | /api/psikotes/instruments | RECRUITERS + hris.recruitment.psikotes | hris.recruitment |
| PUT | /api/psikotes/instruments/{id}; GET, POST /{id}/questions; PUT, DELETE /api/psikotes/questions/{id} | hris.recruitment.psikotes | hris.recruitment |
| * | /api/hris/job-openings(/{id}) | hris.recruitment.job-portal | hris.recruitment |
| * | /api/recruitment/live-monitoring(/…) | hris.recruitment.live-monitoring | hris.recruitment |
| POST | /api/notifications/send | role list (notifyRoles) | unchanged; role check, not IAM |
| * | /api/psikotes/session/{token}…, /api/interview/session/{token}…, /api/offer/session/{token}…, /api/portal/*, /api/job-openings/public | public/token | unchanged |

### Laporan (hris.insights.*)

| Method | Path | Allowed | Before |
|---|---|---|---|
| GET | /api/analytics/{brands,overview,sources} | hris.insights.analytics | hris.insights |
| GET | /api/dashboard/{attention,funnel,sources,stats,weekly} | RECRUITERS + hris.insights.analytics | hris.recruitment, hris.insights | /dashboard/rekrutmen has no menu; mapped to the recruitment pages plus analytics |
| GET | /api/hris/reports | hris.insights.reports | hris.insights |

### ESS (/dashboard/me/*)

All ESS calls go through actor/session routes listed above (attendance, leaves, overtime, loans, payslips, announcements feed, me/beranda, me/team, shifts, holidays, KPI scorecards/rubric, performance, me/feedback-360). None of them changed.

### Pages fixed (requireIamPage)

| Page | Before | After | Why |
|---|---|---|---|
| /dashboard/hris/loans | hrisCompensation | hrisLoans | menu is hris.kepegawaian.loans; a loans-only role was redirected |
| /dashboard/hris/holidays | hrisWorkforce | hrisHolidays | menu is hris.kepegawaian.holidays; a holidays-only role was redirected |
| /dashboard/hris/contracts | hrisKepegawaian | hrisContracts | leaf |
| /dashboard/hris/pengumuman | hrisKepegawaian | hrisAnnouncements | leaf |
| /dashboard/hris/shifts | hrisKepegawaian | hrisShifts | leaf |
| /dashboard/hris/overtime | hrisKepegawaian | hrisOvertime | leaf |

### Out of scope / not changed

- /api/brands, /api/sections (configuration module) still guard on `hris` / `hris.organization`.
- Redirect-only menus (kpi-templates → kpi-config, schedules → shifts, logbook-list → logbook, sections → employees) open nothing on their own because the layout guard blocks the target path.
- Seeder `iam-menus.sql` retired hris.performance.feedback-360 and ess.feedback-360 (missing from its canonical list); added them.

## POS, stored value, CRM, sales funnel, resort, ticketing

### RBAC per sub-module: POS, promo, wallet, CRM, sales funnel, resort, ticketing

Each staff route accepts the leaf menu codes whose dashboard pages call it. Codes come from keys in `frontend/src/lib/iam/prefixes.ts` (generated into `backend/internal/platform/iam/prefixes_gen.go`). A check is a prefix match, so a parent leaf such as `pos.loyalty.wallet` also passes for its child pages, and a role holding only a group code (`pos`, `pos.operations`, `pos.kitchen`, `crm.promo`) passes nothing.

Cashier = `pos.operations.cashier`, `pos.operations.cashier-classic`, `pos.operations.restaurant`, `pos.cashier.central` (key `posCashier`; tablet, classic, restaurant board and central cashier pages share one code base).

Routes ported from `getPosSession` still answer a missing grant with 401; the rest answer 403.

### POS sales (backend/internal/modules/possales)

| Method | Path | Allowed codes | Notes |
|---|---|---|---|
| GET | /api/pos/orders | Cashier, pos.operations.orders | open bills, favourites, self-order queue (orders page and WA deep link) |
| POST | /api/pos/orders | Cashier | was any pos.* |
| POST | /api/pos/orders/open-bill | Cashier | |
| GET | /api/pos/orders/{id} | Cashier, pos.operations.orders, pos.reports.transactions, pos.reports.voids | had no POS guard at all (any session) |
| PATCH | /api/pos/orders/{id} | Cashier, pos.operations.orders | owner comp on Orders page |
| POST | /api/pos/orders/{id}/accept | Cashier, pos.operations.orders | self-order "Dibuat"; was any pos.* |
| POST | /api/pos/orders/{id}/merge, /pre-settle, /transfer-items; PATCH /table | Cashier | restaurant board |
| PATCH | /api/pos/orders/{id}/status | pos.kitchen.kds | was pos.kitchen.* |
| POST | /api/pos/orders/{id}/void | pos.operations.orders | VoidModal lives on the Orders page only |
| POST | /api/pos/orders/{id}/send-wa | Cashier | |
| GET, POST, PATCH | /api/pos/orders/{id}/splits[/{splitId}[/pay]] | Cashier | |
| GET | /api/pos/orders/{id}/payment-proof | Cashier | restaurant bills rail |
| POST | /api/pos/checkouts, /{id}/cancel, /{id}/complete | Cashier | |
| GET | /api/pos/checkouts/{id} | Cashier, pos.operations.orders, pos.reports.transactions, pos.reports.voids | order detail loader |
| POST, GET | /api/pos/qris, /qris/{id}/status | Cashier | |
| GET, POST | /api/pos/supervisors | pos.settings.supervisors | unchanged |
| POST | /api/pos/promo-check; GET /api/pos/offer-rules | Cashier | |
| GET | /api/pos/pass-lookup; POST /api/pos/member-qr | Cashier | member-qr was pos.operations.* |
| GET | /api/pos/kds | pos.kitchen.kds, pos.kitchen.queue-board | queue TV board reads the KDS list |
| GET, POST, PATCH | /api/pos/print-jobs[/{id}] | pos.kitchen.print-queue, or the worker token | was any pos.* |
| GET, POST | /api/pos/gofood/orders[/{id}] | pos.operations.gofood | was pos.operations.* |

### POS operations (backend/internal/modules/posops)

| Method | Path | Allowed codes | Notes |
|---|---|---|---|
| GET | /api/pos/dashboard | pos.reports.dashboard | |
| GET | /api/pos/products | Cashier, pos.catalog.products, crm.settings.config | shared lookup; was pos.catalog.* (cashier-only role got 403) |
| POST | /api/pos/products, /products/sync-purchasing | pos.catalog.products | was pos.catalog.* |
| PATCH | /api/pos/products/{id}; SKU writes | unchanged action checks on pos.catalog.products | CRM Settings XP edit still needs update on pos.catalog.products |
| GET | /api/pos/products/{id}/skus | pos.catalog.products | |
| GET, POST | /api/pos/customers | Cashier, pos.loyalty.topup, pos.operations.reservation | shared member search |
| GET | /api/pos/tables | Cashier, pos.operations.reservation, pos.operations.tables | shared table board |
| POST, PATCH, DELETE | /api/pos/tables[/{id}[/position]] | pos.operations.tables | |
| GET | /api/pos/reservations | Cashier, pos.operations.reservation | restaurant board waiting list |
| POST, PATCH | /api/pos/reservations[/{id}] | pos.operations.reservation | |
| POST | /api/pos/reservations/{id}/seat | Cashier, pos.operations.reservation | |
| GET | /api/pos/shifts | pos.reports.closing | closing report shift filter |
| POST | /api/pos/shifts; PATCH /shifts/{id}/close | Cashier | |
| GET | /api/pos/shifts/current | Cashier, pos.operations.member-bills | member bill pay dialog |
| POST | /api/pos/shifts/{id}/send-report | Cashier, or create on gym.credits | ShiftModal is used by the gym desk |
| GET, POST, PATCH | /api/pos/shifts/mine[/close] | Cashier, or create on gym.credits | was any pos.* or gym.credits create |
| GET | /api/pos/reports/{profit,revenue-composition,transactions,rush-hour,rush-hour/export,product-sales,voids,payment-methods,closing} | pos.reports.<same leaf> | was any pos.* |
| GET | /api/pos/reports/export?report=k | pos.reports.k | OS desktop drive |
| GET | /api/pos/stock-alerts | pos.catalog.stock-alerts | |
| GET | /api/pos/receipt-settings | Cashier, pos.operations.orders, gym.credits | receipt print |
| GET | /api/pos/gift-card-config | Cashier | gift card sale dialog |
| GET | /api/pos/loyalty-settings | Cashier, pos.operations.orders, gym.credits, pos.loyalty.topup, pos.loyalty.settings, pos.reports.transactions, pos.reports.voids | ARK rate |
| PUT | /api/pos/loyalty-settings | unchanged (update on pos.loyalty.settings) | |
| GET | /api/pos/payment-methods | Cashier, pos.operations.member-bills, pos.loyalty.payment-methods | |
| POST, PATCH, DELETE | /api/pos/payment-methods | unchanged (update/delete on pos.operations.*) | see risks |
| GET, PUT | /api/pos/channel-prices; PUT /sales-channels/{code} | unchanged (pos.catalog.channel-prices) | |
| GET | /api/pos/billing-settings | Cashier, settings.billing | |
| PUT | /api/pos/billing-settings | unchanged (update on settings.billing) | |

### Stored value (backend/internal/modules/storedvalue)

| Method | Path | Allowed codes | Notes |
|---|---|---|---|
| all | /api/pos/topup/** | pos.loyalty.topup | was any pos.* |
| POST | /api/pos/gift-card-reload | pos.loyalty.topup | |
| POST | /api/pos/gift-card-check | Cashier | |
| all | /api/pos/member-cards/**, /api/pos/member-refunds/** | pos.loyalty.unlink-card | was any pos.* |
| all | /api/pos/member-bills/** | pos.operations.member-bills | unchanged |
| GET | /api/wallet/packages?scope=cashier | pos.loyalty.topup | top-up package picker; was any pos.* |
| all | other /api/wallet/** | pos.loyalty.wallet (and its child pages) | unchanged; the wallet href covers its child pages |
| GET | /api/promo/campaigns | promo.campaigns, crm.campaigns | CRM Campaigns page lists promo campaigns |
| all | other /api/promo/campaigns/**, /api/promo/codes/** | promo.campaigns | was promo.* or crm.promo |
| GET | /api/promo/catalog | promo.campaigns, promo.offers.* | product picker on both forms |
| GET | /api/promo/gym-packages | read on promo.campaigns | |
| all | /api/promo/offers/** | promo.offers.* | bundling, BxGy, volume pages |
| all | /api/promo/gift-cards/**, /api/promo/gift-card-config | promo.campaigns | gift card tab inside the Promo page |

### CRM (backend/internal/modules/crm)

Gates live in `internal/kit/guards.go`; codes come from the `crm*` keys added after `crmPartners` in `frontend/src/lib/iam/prefixes.ts`. Every gate is a prefix check on leaf codes, so a role holding only a group code (`crm.settings`, `crm.reports`, `pos`) no longer passes. Routes that used `PosSession` (any `pos.*` grant, 401 when it was missing) now return 403 when the leaf is missing.

| Method | Path | Allowed codes | Notes |
|---|---|---|---|
| GET | /api/crm/dashboard | crm.overview.dashboard | was any pos.* |
| GET | /api/crm/loyalty-features | pos.operations.cashier, pos.operations.cashier-classic, pos.operations.restaurant, pos.cashier.central | only the cashier page reads it; was any pos.* |
| GET | /api/crm/members | crm.members.list, crm.loyalty.rewards | shared lookup: member search in Rewards redemption claim |
| POST | /api/crm/members | crm.members.list | was any pos.* |
| GET, PATCH | /api/crm/members/{id} | crm.members.list | was any pos.* |
| GET | /api/crm/members/{id}/activity | crm.members.list | was crm.members + crm.loyalty |
| GET, PUT | /api/crm/members/{id}/consent | crm.members.list | |
| GET | /api/crm/members/{id}/badges | crm.members.list | |
| POST | /api/crm/members/{id}/badges | crm.members.list | was crm.loyalty + crm.settings; the member detail page awards badges |
| POST | /api/crm/members/{id}/xp-adjust | crm.members.list | was crm.loyalty + crm.settings; member detail page |
| POST | /api/crm/members/{id}/password | update on crm.members | per-action check kept as is |
| GET | /api/crm/avatar-inventory | crm.members.list | was any pos.* |
| POST, PATCH | /api/crm/avatar-inventory | crm.members.list | was any pos.* |
| GET | /api/crm/rewards | crm.loyalty.rewards, crm.members.list | shared: member detail loads the catalog |
| POST, DELETE | /api/crm/rewards | crm.loyalty.rewards | was crm.settings |
| GET | /api/crm/redemptions | crm.loyalty.rewards, crm.members.list | shared: member detail history |
| POST, PATCH | /api/crm/redemptions | crm.loyalty.rewards | was crm.loyalty + crm.members + pos.operations/pos.cashier.central; no POS page calls it |
| GET | /api/crm/tiers | crm.members.list, crm.loyalty.rewards, crm.loyalty.avatars, crm.wallpapers, crm.engagement.announcements, crm.settings.config | shared tier picker |
| POST | /api/crm/tiers | crm.settings.config | |
| GET, POST | /api/crm/xp-rules | crm.settings.config | /dashboard/crm/xp-rules has no menu of its own; settings page also reads it |
| GET, PUT | /api/crm/settings | crm.settings.config | GET was any pos.* |
| GET | /api/crm/avatars | crm.loyalty.avatars, crm.members.list | shared: member detail inventory picker |
| POST, DELETE | /api/crm/avatars | crm.loyalty.avatars | was crm.settings |
| POST | /api/crm/avatars/upload | crm.loyalty.avatars, crm.badges, crm.wallpapers | shared image upload |
| GET, POST, DELETE | /api/crm/badges | crm.badges | was crm.settings |
| GET, POST, DELETE | /api/crm/wallpapers | crm.wallpapers | was crm.settings |
| GET | /api/crm/collectibles/idle-report | crm.reports.overview | |
| GET, POST | /api/crm/engagement/announcements | crm.engagement.announcements | was crm.engagement |
| POST | /api/crm/engagement/announcements/image | crm.engagement.announcements | |
| GET, POST | /api/crm/engagement/challenges | crm.engagement.challenges | |
| GET | /api/crm/engagement/checkins | crm.engagement.checkins | |
| GET, POST, DELETE | /api/crm/engagement/events | crm.engagement.events | saveEvent keeps its HasMenuAction(update, crm.engagement) check |
| GET, POST | /api/crm/engagement/events/bookings | crm.engagement.events | |
| GET | /api/crm/member-reviews | crm.members.member-reviews | unchanged |
| PATCH | /api/crm/member-reviews/{id} | crm.members.member-reviews | unchanged |
| GET | /api/crm/inbox/conversations | crm.members.inbox | unchanged |
| GET, POST | /api/crm/inbox/conversations/{id} | crm.members.inbox | unchanged |
| GET | /api/crm/inbox/templates | crm.members.inbox | unchanged |
| POST, DELETE | /api/crm/inbox/templates | crm.settings.config | no page calls these today |
| GET | /api/crm/inbox/analytics | crm.members.inbox | |
| POST | /api/crm/inbox/analytics | crm.members.inbox, crm.reports.overview | shared: CRM reports page triggers analysis |
| GET, POST | /api/crm/reviews | crm.members.reviews | was crm.members.inbox |
| GET, POST | /api/crm/instagram/webhook | public | own signature check |
| GET, POST | /api/crm/partners | crm.loyalty.partners | unchanged |
| PATCH | /api/crm/partners/{id} | crm.loyalty.partners | unchanged |
| GET | /api/crm/partners/events | crm.loyalty.partners | unchanged |
| POST | /api/crm/partners/events/rematch | crm.loyalty.partners | unchanged |
| GET, POST | /api/crm/campaigns | crm.campaigns | was crm.promo + promo |
| POST | /api/crm/campaigns/preview | crm.campaigns | |
| PATCH | /api/crm/campaigns/{id} | crm.campaigns | |
| GET | /api/crm/campaigns/{id}/report | crm.campaigns | |
| GET | /api/crm/campaign-config | crm.campaigns | |
| PUT | /api/crm/campaign-config | crm.campaigns | was every crm.* |
| GET, POST, DELETE | /api/crm/campaign-optouts | crm.campaigns | |
| GET | /api/crm/segments | crm.marketing.segments, crm.campaigns | shared: segment picker in campaign dialog; was crm.promo + promo + every crm.* |
| POST | /api/crm/segments | crm.marketing.segments | |
| POST | /api/crm/segments/preview | crm.marketing.segments | |
| GET, PATCH, DELETE | /api/crm/segments/{id} | crm.marketing.segments | |
| POST | /api/crm/segments/{id}/preview | crm.marketing.segments | |
| GET, POST | /api/crm/forms | crm.marketing.forms | was crm.promo + promo + every crm.* |
| GET, PATCH, DELETE | /api/crm/forms/{id} | crm.marketing.forms | |
| GET | /api/crm/reports | crm.reports.overview | was crm.reports |
| GET | /api/crm/reports/cs | crm.reports.overview | |
| GET | /api/crm/reports/conversations | crm.reports.overview | |
| GET | /api/crm/report-builder | crm.reports.builder, crm.reports.dashboards, crm.reports.schedules | shared saved-report list |
| POST | /api/crm/report-builder | crm.reports.builder | |
| GET | /api/crm/report-builder/datasets | crm.reports.builder | |
| POST | /api/crm/report-builder/run | crm.reports.builder, crm.marketing.attribution | shared: attribution page runs a definition |
| GET, PATCH, DELETE | /api/crm/report-builder/{id} | crm.reports.builder | |
| GET | /api/crm/report-builder/{id}/export | crm.reports.builder | |
| GET, POST | /api/crm/dashboards | crm.reports.dashboards | |
| GET, PATCH, DELETE | /api/crm/dashboards/{id} | crm.reports.dashboards | |
| GET, POST | /api/crm/report-schedules | crm.reports.schedules | admin-only check kept |
| PATCH, DELETE, POST | /api/crm/report-schedules/{id} | crm.reports.schedules | admin-only check kept |
| GET, POST | /api/crm/approval-rules | crm.settings.approvals | was crm.settings |
| PATCH, DELETE | /api/crm/approval-rules/{id} | crm.settings.approvals | |
| GET | /api/crm/approvals | sales-funnel.approvals | was every sales-funnel.*; only the Sales Funnel Approval page calls it |
| POST | /api/crm/approvals/{id}/decide | sales-funnel.approvals | was any signed-in user; approver assignment check inside kept |
| GET, POST | /api/crm/workflow-rules | crm.settings.workflows | |
| GET, PATCH, DELETE | /api/crm/workflow-rules/{id} | crm.settings.workflows | |
| GET | /api/crm/workflow-rules/{id}/runs | crm.settings.workflows | |
| GET, POST | /api/crm/scoring-rules | crm.settings.scoring | |
| PATCH, DELETE | /api/crm/scoring-rules/{id} | crm.settings.scoring | |
| POST | /api/crm/scoring/recalculate | crm.settings.scoring | |
| GET, POST | /api/crm/custom-fields | crm.settings.custom-fields | |
| PATCH, DELETE | /api/crm/custom-fields/{id} | crm.settings.custom-fields | |
| GET, POST | /api/public/crm/forms/{slug}, POST /api/public/site/trial | public | unchanged |

Pages that call routes outside their own leaf (covered by the shared gates above): Members detail (rewards, redemptions, tiers, avatars, avatar-inventory), Rewards (member search, tiers), Avatars, Wallpapers and Announcements (tiers), Badges and Wallpapers (avatar upload), Campaigns (segments list), Attribution (report run), Dashboards and Schedules (saved-report list), CRM Reports (inbox analysis). Off-module calls these pages make and that other owners must allow: CRM Settings calls GET and PATCH /api/pos/products (XP per product); Approval Rules, Workflow Rules, Forms and Report Schedules call GET /api/sales-funnel/owners; Workflow Rules calls the sales-funnel stages lookup.

Page-guard flaws (layout prefix match, not widened in the API):
- crm.overview.dashboard has href /dashboard/crm, which covers every CRM page.
- crm.reports.overview has href /dashboard/crm/reports, which covers the Builder and Schedules pages.
- /dashboard/crm/xp-rules has no menu row; only the /dashboard/crm prefix opens it. The API serves it under crm.settings.config.

### RBAC map: sales funnel, resort, ticketing

Codes are prefix-matched leaf menu codes. Before: every sales-funnel route took `sales-funnel` (whole module), every resort route took `resort`, ticketing took three coarse groups (admin / operator / reports).

### Resort (`backend/internal/modules/resort/http.go`)

Writes keep their RequireMenuAction check (create/update/delete), now scoped to the listed codes.

| Method | Path | Allowed codes | Notes |
|---|---|---|---|
| GET | /api/resort/availability | resort.reservations | create-reservation dialog |
| GET | /api/resort/front-office | resort.front-office | |
| GET | /api/resort/reservations | resort.reservations | |
| POST | /api/resort/reservations | resort.reservations (create) | |
| GET | /api/resort/reservations/{id} | resort.reservations, resort.front-office | detail dialog on both pages |
| PATCH | /api/resort/reservations/{id} | resort.reservations (update) | no frontend caller |
| POST | /api/resort/reservations/{id}/charges | resort.reservations, resort.front-office (update) | detail dialog |
| POST | /api/resort/reservations/{id}/status | resort.reservations, resort.front-office (update) | detail dialog |
| GET | /api/resort/room-types | resort.rooms | |
| POST/PATCH/DELETE | /api/resort/room-types[/{id}] | resort.rooms (create/update/delete) | |
| GET | /api/resort/rooms | resort.rooms, resort.reservations, resort.front-office | shared lookup (detail dialog room picker) |
| POST | /api/resort/rooms | resort.rooms (create) | |
| PATCH | /api/resort/rooms/{id} | resort.rooms, resort.front-office (update) | front office sets housekeeping status |
| DELETE | /api/resort/rooms/{id} | resort.rooms (delete) | |

### Sales funnel (`backend/internal/modules/salesfunnel/http.go`, `access.go`)

Each route carries its codes in the request context; `requireUser` checks them, `requireFinance(viewer)` checks `accounting` OR them, `requireFinance(non-viewer)` stays accounting only.

| Method | Path | Allowed codes | Notes |
|---|---|---|---|
| GET | /leads | leads, pipeline | deal form lead picker |
| POST | /leads, /leads/import | leads | |
| GET | /leads/by-phone | leads | PIC lookup in lead form |
| GET/PATCH/DELETE | /leads/{id} | leads | |
| POST | /leads/{id}/link-customer | leads, pipeline | |
| DELETE | /leads/{id}/link-customer | leads | |
| GET | /deals | pipeline | incl. /pipeline/quotations/* child pages |
| POST | /deals | pipeline, leads | leads page opens DealFormDialog |
| GET/PATCH/DELETE | /deals/{id} | pipeline | |
| GET/POST/DELETE | /deals/{id}/members | pipeline | |
| POST | /deals/{id}/send-wa | pipeline | |
| GET/POST | /deals/{id}/quotations | pipeline | |
| GET/POST | /deals/{id}/invoices | accounting, pipeline | viewer |
| GET | /deals/{id}/payments | accounting, pipeline | viewer |
| POST | /deals/{id}/payments | accounting | unchanged |
| DELETE | /deals/{id}/payments/{paymentId} | accounting | unchanged |
| GET/PATCH/DELETE | /quotations/{id}, POST revise/realize/send-wa, GET pdf | pipeline | |
| PATCH | /invoices/{id} | accounting | unchanged (finance invoices page) |
| DELETE | /invoices/{id} | accounting, pipeline | viewer |
| GET | /invoices/{id}/pdf | accounting, pipeline | viewer (finance invoices pages + deal dialog) |
| GET/POST/PATCH/DELETE | /activities[/{id}] | followups, leads, accounts, contacts, pipeline | task lists on every record page |
| GET | /accounts | accounts, contacts | contact form account picker |
| POST, GET/PATCH/DELETE {id} | /accounts | accounts | |
| GET | /contacts, /contacts/{id} | contacts | |
| POST | /contacts | contacts, accounts | account detail ContactFormDialog |
| PATCH | /contacts/{id} | contacts, accounts | |
| DELETE | /contacts/{id} | contacts | |
| GET | /pipelines | pipeline, leads, settings, forecast | shared lookup |
| POST/PATCH | /pipelines[/{id}] | settings | |
| GET | /stages | pipeline, settings, crm.settings.workflows | CRM workflow rules page |
| POST/PATCH | /stages[/{id}] | settings | |
| GET | /owners | pipeline, crm.settings.workflows, crm.settings.approvals, crm.reports.schedules, crm.marketing.forms | shared owner picker |
| GET | /lost-reasons | pipeline | |
| GET | /products | pipeline, settings | quotation editor, recipe settings |
| GET | /customers | leads | |
| GET | /raw-materials, GET/PUT /recipes | settings | |
| GET | /custom-fields | leads, pipeline, accounts, contacts | CustomFieldsSection in record forms |
| GET | /wa-templates | settings, pipeline | |
| POST/PATCH/DELETE | /wa-templates[/{id}] | settings | |
| GET | /forecast, GET/PUT /targets | forecast | |
| GET | /reports | reports | |
| GET | /timeline | leads, accounts, contacts | RecordTimeline |

(paths are under /api/sales-funnel; codes under sales-funnel.* unless written in full)

### Ticketing (`backend/internal/modules/ticketing/http.go`, staff routes only)

| Method | Path | Allowed codes | Notes |
|---|---|---|---|
| GET | /bookings, /bookings/{id} | booking | |
| PATCH | /bookings/{id} | booking | refund note, clear webhook alert (was admin group) |
| POST | /bookings/{id}/cancel | booking | was admin group |
| POST | /bookings/{id}/resend-wa | booking | |
| GET | /bookings/lookup, POST /bookings/{id}/redeem | loket | RedeemDialog lives on the loket page |
| POST | /gate/tap | gate | |
| POST | /gate/pass-tap | gate_pass | |
| GET/POST | /visits, GET /visits/{id}, POST deposit/settle/bands lost | loket | |
| POST | /visits/{id}/charges/{chargeId}/void | reports | kept: supervisor-only by design |
| GET/POST | /season-passes, GET pass-options, POST renew | passes | |
| POST | /tab/check | pos.operations.cashier, pos.operations.cashier-classic, pos.operations.restaurant, pos.cashier.central | only the POS cashier calls it |
| GET | /tab/stats | loket | |
| GET | /occupancy | booking, settings, reports | shared (calendar, capacity, report) |
| GET | /reports | reports | |
| GET | /settings | settings, loket | loket registration dialog reads it |
| PUT | /settings | settings | |
| * | /time-slots, /capacity-dates, /channels, /bands, /staff-passes | settings | |
| GET/POST | /categories | tickets | |
| GET | /channel-manager | channel-manager, tickets | ticket editor bundle tab |
| GET | /products | tickets, mapping | gate mapping is read-only |
| POST, GET/PATCH {id}, thumbnail, bundle-items, dates* | /products | tickets | |
| GET | /products/loket-options | loket | |
| PUT | /products/{id}/channel-prices | channel-manager | |
| PATCH | /products/{id}/channels | channel-manager | |

(paths under /api/ticketing; codes under ticketing.* unless written in full)

## Gym

### Gym staff RBAC map

Rule: a route allows the menu codes whose dashboard pages call it (traced from
`frontend/src/app/dashboard/(dashboard)/gym/**/page.tsx` through
`frontend/src/features/gym`). The action on each grant is unchanged unless noted.
Prefix match: `gym.schedule` also matches `gym.schedule.templates`.
`*` = changed in the sub-module pass. Member-app (`/api/member-portal/**`), public and
gate-device routes are out of scope.

### gymscheduling

| Method | Path | Allowed (action codes) | Callers / notes |
|---|---|---|---|
| GET | /api/gym/branches * | read: schedule, sessions, coaches, checkin, gate-devices, coach-leave, credits, rules | was any `gym*` menu. Pickers in schedule/session dialog, coaches, checkin, gate devices, coach leave, credits/sell dialog, rules (open gym card) |
| GET | /api/gym/class-types | read: class-types, schedule, sessions; read_own sessions | class-types, schedule, schedule-templates, sessions, session detail |
| POST/PATCH/DELETE | /api/gym/class-types[/{id}], import[/template] | create/update/delete class-types | class-types |
| GET | /api/gym/coaches * | read: coaches, schedule, sessions, coach-leave | added coach-leave (record incident picker) |
| GET | /api/gym/coaches/{id}/schedule * | read coaches | was + schedule, sessions; only the coaches page calls it |
| GET/POST/PATCH | /api/gym/coaches/staff, coaches, coaches/{id}, photo, import | create/update coaches | coaches |
| GET | /api/gym/my-classes, my-classes/sessions/{id} | read my-classes; read_own sessions | Kelas Saya (coach self-service, own data) |
| GET | /api/gym/sessions * | read schedule/sessions; read_own sessions (own only); read checkin | added checkin: drop-in panel on the check-in page. read_own is tried before checkin so coaches stay on their own sessions |
| POST | /api/gym/sessions | create schedule/sessions | schedule, session detail |
| POST | /api/gym/sessions/duplicate-week | create schedule | schedule |
| GET/PATCH/POST/DELETE | /api/gym/sessions/{id} | read(+read_own)/update/delete schedule/sessions | session detail, schedule |
| * | /api/gym/session-templates/** * | gym.schedule.templates (read/create/update/delete) | was gym.schedule; only the Template Jadwal page calls them |
| GET | /api/gym/bookings * | read bookings | was + sessions; only the bookings page lists |
| POST | /api/gym/bookings * | create checkin, sessions | was + bookings; drop-in (check-in) and session roster book |
| GET | /api/gym/bookings/members * | read checkin, sessions | was + bookings; member search in drop-in and roster |
| POST | /api/gym/bookings/{id} | read bookings/checkin/sessions; read_own sessions; update my-classes (+ per-action table) | bookings, check-in, session detail, Kelas Saya |
| GET/POST | /api/gym/checkin * | read/create checkin | was + sessions; check-in page only |
| GET | /api/gym/checkin/members * | read checkin | was bookings+checkin+sessions |
| POST | /api/gym/checkin/members/{id}/waiver * | create checkin; update members | was checkin+sessions; check-in and member 360 |
| GET | /api/gym/open-gym-hours * | read rules | was + checkin(+sessions); only the rules page calls it |
| PUT | /api/gym/open-gym-hours | update rules | rules |
| * | /api/gym/gate-devices/** | gate-devices | gate devices |

### gymdesk

| Method | Path | Allowed | Notes |
|---|---|---|---|
| GET | /api/gym/members * | read members; create complaints | added complaints: new-ticket dialog searches members |
| POST/GET/PATCH | /api/gym/members[/{id}], import | create/read/update members | members, member 360 |
| POST/DELETE | /api/gym/members/{id}/notes | read members | unchanged (any member viewer leaves notes) |
| GET | /api/gym/reports/branches | read members, reports | members, reports |
| GET | /api/gym/reports/{classes,revenue,members} | read reports | reports |
| GET | /api/gym/checkin/log * | read checkin | was + sessions; CheckinLog sits on the check-in page only |

### gymcredits

| Method | Path | Allowed | Notes |
|---|---|---|---|
| GET | /api/gym/packages | read packages, credits | packages, credits, sell dialog (check-in, gated on credits create) |
| POST/PATCH/DELETE | /api/gym/packages/**, import | packages | packages |
| GET | /api/gym/credits, credits/{customerId} | read credits | credits, drop-in (gated) |
| POST | credits/{id}/adjust, reverse, refund, transfer, reclaim, passes/* | update credits | credits |
| POST | credits/{id}/sell, vouchers/preview | create credits | credits, check-in |
| GET | /api/gym/credits/purchases/{id}/receipt * | read credits, members | added members: reprint button on member 360 purchases |
| GET/PUT | /api/gym/rules | read/update rules | rules |

### gymcare

| Method | Path | Allowed | Notes |
|---|---|---|---|
| GET | /api/gym/member-flag-types * | read_medical flags; read flags, members, pt; coach portal | dropped checkin, sessions, bookings (those pages only read flags) |
| GET | /api/gym/member-flags/members * | read_medical flags; read flags, members, checkin/sessions, pt; coach portal | dropped bookings (bookings page shows no flags) |
| POST/PATCH | /api/gym/member-flag-types[/{id}] | create/update flags | flags page |
| GET/POST/PATCH/DELETE | /api/gym/member-flags/** | flags actions + coach portal | flags, member 360, PT, Kelas Saya |
| GET | /api/gym/health-declarations/{id}, coach-notes/** | read_medical flags; coach portal | unchanged (medical gating) |

Coach portal = read my-classes, read_own sessions, read_own pt.

### gymcoaching

| Method | Path | Allowed | Notes |
|---|---|---|---|
| GET | /api/gym/pt/coaches * | read/read_own/create pt; read assessments | added assessments: coach picker in the assessment dialog. read_own still scopes to own coach |
| GET | /api/gym/pt/members | read/read_own/create pt; read/create assessments | PT, assessments |
| GET | /api/gym/pt/class-types, slots, availability | pt (scoped) | PT |
| PUT/POST/DELETE | pt availability, appointments, participants | pt actions (scoped) | PT |
| GET/PATCH | /api/gym/pt/class-type-flags[/{id}] | update class-types | PT page "Jenis sesi" tab; kept on class-types (see gaps) |
| * | /api/gym/assessments/** | assessments actions | assessments, member 360 tab |

### Already exact (no change)

- gymautomation `/api/gym/automation/**`: gym.automation read/update.
- gymcomplaints `/api/gym/complaints/**`: gym.complaints read/create/update/delete; `/api/gym/my-classes/complaints`: read my-classes.
- gymcoachleave `/api/gym/coach-leave/**`: gym.coach-leave read/update; `/api/gym/my-classes/{landing,leave/**}`: my-classes read/update.
- gymloyalty `/api/gym/loyalty/**`: gym.loyalty; `/api/gym/members/{id}/loyalty`: read members or loyalty; `PUT /members/{id}/status`: update loyalty.
- gymsop `/api/gym/sop/**`: gym.sop; `/api/gym/my-classes/sop/**`, `sop/versions/{id}/file`: read sop, read_own sop, read my-classes, read_own sessions.
- gymtraining exercises/races/incentives: their own codes; `/api/gym/my-classes/{commission,incentives}`: read my-classes.
- memberportal `/api/gym/referrals/**`: gym.referrals read/update.
- athlete: member routes only, no staff routes.

### Gaps left as is (roles that need an extra code)

- Member 360 "Asesmen" tab calls `/api/gym/assessments`: gym.members alone gets 403 there. Front desk needs `gym.assessments` read to see it.
- PT page "Jenis sesi" tab needs `gym.class-types` update (per-action rule kept).
- Member 360 coach-note history and PAR-Q need `gym.member-flags` read_medical (by design).
- `gym.schedule.templates` still matches the `gym.schedule` prefix, so a templates-only role can call the schedule/session write routes. Fixing it needs an exact-code matcher in platform/iam.

## Accounting, settings, integrations, site, shop, investor, events

### RBAC per sub-module: admin modules

Allowed codes are IAM menu code prefixes (`HasAnyMenuPrefix`). A route allows every
sub-module whose dashboard page calls it. The layout guard admits a path when any granted
menu href covers it, so a parent leaf href also opens the pages below it:

- `accounting.dashboard.overview` (/dashboard/accounting/reports) covers every /reports/** page
- `accounting.accounts-payable.payable` covers /accounts-payable/**
- `accounting.receivable.list` covers /receivable/**
- `accounting.cash-bank.accounts` covers /cash-bank/**
- `accounting.period.fiscal-years` covers /fiscal-years/beginning-balance/{id}
- `investor.overview` (/dashboard/investor) covers every investor page
- `shop` (/dashboard/shop) covers every shop page, so shop pages now also check their leaf in `requireIamPage`

Short names: `acc.` = `accounting.`, `ap.` = `acc.accounts-payable.`, `ar.` = `acc.receivable.`, `cb.` = `acc.cash-bank.`.

### Accounting (/api/accounting, /api/finance)

| Method | Path | Allowed codes | Notes |
|---|---|---|---|
| GET | /account-types | acc.master.account-types, acc.master.chart-of-accounts | COA page lists types |
| POST/PUT/DELETE | /account-types[/{id}] | acc.master.account-types | |
| GET | /chart-of-accounts | acc.master.chart-of-accounts, acc.master.journal-mappings, acc.ledger.journal-entries, acc.ledger.journal-history, acc.period.beginning-balance, acc.period.fiscal-years, items.raw-material.master.materials | shared lookup (account pickers, raw material COA fields) |
| POST/PUT/DELETE | /chart-of-accounts[/{id}], /chart-of-accounts/import | acc.master.chart-of-accounts | |
| all | /journal-mappings/** | acc.master.journal-mappings | |
| GET | /fiscal-years | acc.period.fiscal-years, acc.period.accounting-period, acc.period.beginning-balance, acc.ledger.journal-entries | list and ?coverage=1 (JE form banner) |
| GET/POST/PUT/DELETE | /fiscal-years (write), /fiscal-years/{id} | acc.period.fiscal-years | |
| GET/POST | /fiscal-years/{id}/beginning-balance | acc.period.beginning-balance, acc.period.fiscal-years | editor page sits under the Fiscal Years href |
| GET | /fiscal-periods | acc.period.accounting-period, acc.period.closing | |
| POST | /fiscal-periods/{id}/open | acc.period.accounting-period, acc.ledger.journal-entries | JE form banner opens a period |
| GET/POST | /fiscal-periods/{id}/close | acc.period.closing | |
| GET | /journal-entries | acc.ledger.journal-entries, acc.ledger.journal-history | |
| GET/POST/PUT/DELETE | /journal-entries/{id}, /journal-entries/{id}/post, POST /journal-entries | acc.ledger.journal-entries | |
| GET | /cash-bank | cb.accounts, cb.transfer | transfer page lists accounts |
| GET | /cash-bank/accounts-options | cb.accounts, cb.cash-in, cb.cash-out | |
| GET | /cash-bank/{accountId}/ledger | cb.accounts | |
| GET/POST | /cash-bank/cash-in | cb.cash-in, cb.accounts | |
| GET/POST | /cash-bank/cash-out | cb.cash-out, cb.accounts | |
| GET/POST | /cash-bank/transfer | cb.transfer, cb.accounts | |
| GET | /reports/trial-balance | acc.ledger.trial-balance, acc.dashboard.overview | per {report} value |
| GET | /reports/balance-sheet | acc.reports.balance-sheet, acc.dashboard.overview | |
| GET | /reports/income-statement | acc.reports.income-statement, acc.dashboard.overview | |
| GET | /reports/cash-flow | acc.reports.cash-flow, acc.dashboard.overview | |
| GET | /reports/general-ledger | acc.ledger.general-ledger, acc.dashboard.overview | unknown report: overview only |
| GET | /dashboard | acc.dashboard.overview | |
| GET | /ledger/subsidiary | acc.ledger.subsidiary | |
| GET | /ap/invoices | ap.invoices, ap.payments, ap.payable | payments page picks invoices; PO detail (AP context) too |
| GET | /ap/invoices/{id} | ap.invoices, ap.payable | no frontend caller |
| GET | /ap/payable | ap.payable | |
| GET | /ap/aging | ap.aging, ap.payable | |
| GET | /ap/payments | ap.payments, ap.payable | |
| POST | /ap/payments | ap.payments, ap.invoices, ap.payable | PO payment card opened from AP invoices |
| POST | /ap/payments/{id}/void | ap.payments, ap.payable | |
| GET | /ar/invoices | ar.invoices, ar.receipts, ar.list | |
| GET | /ar/receivable | ar.list | |
| GET | /ar/aging | ar.aging, ar.list | |
| GET | /ar/by-sales-invoice/{id} | ar.receipts, ar.list | |
| GET/POST | /ar/receipts | ar.receipts, ar.list | |
| all | /api/finance/** (except faktur download) | ar.invoices-b2b, ar.list | was any accounting menu |
| GET | /api/finance/invoices/{id}/faktur-pajak | ar.invoices-b2b, ar.list, sales-funnel | sales-funnel kept as before |

### Shop (staff routes)

| Method | Path | Allowed codes | Notes |
|---|---|---|---|
| GET | /api/shop/orders | shop.orders | |
| GET/PATCH | /api/shop/orders/{id}, POST /orders/{id}/shipment | shop.orders, shop.wholesale | wholesale tab reuses the order dialog |
| GET/PATCH | /api/shop/reviews[/{id}] | shop.orders | reviews tab of the orders page |
| GET/PUT | /api/shop/storefront-settings | shop.settings | unchanged |
| all | /api/shop/marketplace/** (accounts, links, listings, connect, callback, manual sync) | shop.marketplace | sync with x-sync-token unchanged |
| all | /api/shop/wholesale/** (accounts, orders, products) | shop.wholesale | |
| GET/PATCH | /api/shop/shipping/settings | settings.shipping | page /dashboard/settings/shipping |
| POST/GET | /api/shop/shipping/rates, /areas, /track | pos, settings.shipping | 401 on deny kept; shipping page rate test |
| | /api/public/shop/**, /api/wholesale/** (partner), webhooks | own auth | untouched |

Page guards: /dashboard/shop/orders, /settings, /marketplace, /wholesale now `requireIamPage` their leaf; /dashboard/settings/shipping uses settings.shipping (was `shop`).

### Investor

| Method | Path | Allowed codes (action read) |
|---|---|---|
| GET | /api/investor/overview, GET/PUT /digest | investor.overview |
| GET | /api/investor/performance, /branches | investor.performance, investor.overview |
| GET | /api/investor/updates | investor.progress, investor.overview |
| GET | /api/investor/documents | investor.documents, investor.overview |
| * | /api/investor/updates/manage, writes | investor.updates with read/create/update/delete (unchanged) |

Page guards: overview, performance, progress, documents pages check their leaf plus investor.overview.

### Events (/api/events)

| Method | Path | Allowed |
|---|---|---|
| GET | /calendar, /export.csv, GET/POST/DELETE /feeds | read events.calendar |
| GET | /options, /overrides, /tasks | read events.calendar, crm.engagement.events, site.events |
| GET | /link/candidates | read crm.engagement.events, site.events |
| POST/DELETE | /link, /link/publish, /link/{id}, task writes | update or create on crm.engagement.events, site.events (was crm.engagement) |
| GET | /api/public ICS feed | token, untouched |

### Settings / configuration / integrations

| Method | Path | Allowed | Notes |
|---|---|---|---|
| GET/PUT/POST | /api/settings/wa-notifications[/test] | settings.wa_notifications, settings.integrations | integrations kept: /os desktop panel |
| GET/PUT/POST | /api/settings/order-alerts | settings.wa_notifications, settings.integrations | card on the Notifikasi WA page |
| * | company-profile, logo, sales-target, receipt, business/** , brands writes | settings.business | already leaf, unchanged |
| * | integrations, google-business, instagram, email/**, tts, gobiz, admin/api-tokens | settings.integrations | already leaf, unchanged |
| * | payment-gateways/**, static-qris | settings.payment-gateways | unchanged |
| * | appearance | settings.appearance | unchanged |
| * | /api/settings/iam/roles/** | settings.roles | admin only, unchanged |
| * | /api/settings/iam/menus/** | settings.menus | admin only, unchanged |
| * | /api/users/**, /api/admin/users/**, POST /api/auth/impersonate | settings.users | admin only, unchanged |
| * | /api/settings/wa-gateway/** | super_admin role | unchanged |
| GET | /api/audit | settings.audit | unchanged |
| GET | /api/settings/letterhead, /api/auth/* | any signed-in staff | unchanged |

### Unchanged, already per sub-module or not menu-bound

- Site: /api/site/content → site.content, /articles → site.articles, /events → site.events, /uploads → any site.* (all three pages upload). /api/gym/news → gym.news actions.
- Dataroom: one leaf (`dataroom`), per-action checks kept.
- Desktop: overview needs `dashboard`; inbox sections and search sources filter per menu prefix (search: order pos.reports/pos.operations, member crm.members/crm, product pos.catalog/items.product, material items.raw-material, employee hris.kepegawaian/hris, document dataroom). Member and employee sources still accept any crm/hris menu; matches the /dashboard/crm parent href. Wallpaper upload needs settings.appearance.
- Files (/api/files): public buckets open, member-owned photos for the owner, every staff session reads other buckets. Not menu-bound.
- No Next API routes under frontend/src/app/api still use requireIam* for these areas.

### Page gaps (frontend, not changed)

- Beginning balance editor lives at /dashboard/accounting/fiscal-years/beginning-balance/{id}; a role with only accounting.period.beginning-balance cannot open it (layout needs the Fiscal Years href). API allows both.
- /dashboard/settings/voice is guarded by settings.appearance but calls /api/settings/tts (settings.integrations), and no menu href covers it.
- /dashboard/finance/invoices has no active menu (finance.invoices is deleted); only users without IAM grants reach it.
- A role granted only a parent code (`shop`, `accounting`, `investor`) without leaves no longer passes the API guards; roles from the seeders and role editor carry the leaves.

