#!/usr/bin/env node
/**
 * Reset item master + transaksi terkait, lalu import Draft Menu (hijau)
 * dari docs/SULU-bdg FoodTesting.xlsx.
 *
 * Preserve: CRM members / loyalty wallet+XP, users, business hierarchy
 *   (kecuali create warehouse Yokocho 11 bila belum ada).
 *
 * Safety:
 *   - lokal: default OK
 *   - remote: --allow-remote (+ --confirm-remote-wipe untuk apply)
 *
 * Usage:
 *   npm run db:seed:items-from-draft-menu -- --dry-run
 *   npm run db:seed:items-from-draft-menu -- --allow-remote --dry-run
 *   npm run db:seed:items-from-draft-menu -- --allow-remote --confirm-remote-wipe
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { Client } = require("pg");
const {
  sslForUrl,
  assertLocalTarget,
  isLocalDatabaseUrl,
  parseHost,
} = require("../scripts/pg-utils");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_XLSX = path.join(ROOT, "..", "docs", "SULU-bdg FoodTesting.xlsx");
const HOLDING_CODE = "PROLOGE";
const COMPANY_CODE = "SULU";
const BRANCH_CODE = "SULU-DAGO";
const YOKOCHO_11 = { code: "STALL-15", name: "Yokocho 11" };

/** Excel Yokocho label → warehouse name (case-insensitive match on warehouse.name). */
const YOKOCHO_NAME_ALIASES = {
  "yokocho 1": "Yokocho 1",
  "yokocho 2": "Yokocho 2",
  "yokocho 3": "Yokocho 3",
  "yokocho 4": "Yokocho 4",
  "yokocho 5": "Yokocho 5",
  "yokocho 6": "Yokocho 6",
  "yokocho 7": "Yokocho 7",
  "yokocho 8": "Yokocho 8",
  "yokocho 9": "Yokocho 9",
  "yokocho 10": "Yokocho 10",
  "yokocho 11": "Yokocho 11",
  "hikiniku bar": "Hikiniku Bar",
  "noodles bar": "Noodles Bar",
  "onigiri corner": "Onigiri Corner",
};

function loadEnv() {
  const shellKeys = new Set(Object.keys(process.env));
  for (const name of [".env", ".env.local"]) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i <= 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!shellKeys.has(k)) process.env[k] = v;
    }
  }
}

function databaseNameFromUrl(url) {
  try {
    return (new URL(url.replace(/^postgresql:/i, "http:")).pathname || "").replace(/^\//, "") || "(unknown)";
  } catch {
    return "(unknown)";
  }
}

function normalizeText(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function slugCode(value, maxLen = 24) {
  const base = normalizeText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
  return base || "MENU";
}

function stationForCategory(category) {
  const hay = normalizeText(category).toLowerCase();
  if (/bakery|pastry|dessert|cake/.test(hay)) return "bakery";
  if (/barista|coffee|tea|drink|beverage|minuman/.test(hay)) return "bar";
  return "kitchen";
}

function readGreenDraftMenu(xlsxPath) {
  if (!fs.existsSync(xlsxPath)) throw new Error(`Excel tidak ditemukan: ${xlsxPath}`);

  const py = `
import json, openpyxl, sys
path = sys.argv[1]
wb = openpyxl.load_workbook(path, data_only=True)
wb2 = openpyxl.load_workbook(path, data_only=False)
ws = wb["Draft Menu"]
ws2 = wb2["Draft Menu"]

def rgb(cell):
    fg = cell.fill.fgColor if cell.fill else None
    if not fg: return None
    if fg.type == "rgb" and fg.rgb:
        return str(fg.rgb).upper()
    return None

def is_green(c):
    if not c: return False
    return "00FF00" in c

rows = []
for r in range(6, ws.max_row + 1):
    menu = ws.cell(r, 2).value
    if menu is None or str(menu).strip() == "":
        continue
    colors = [rgb(ws2.cell(r, c)) for c in range(2, 6)]
    if not any(is_green(c) for c in colors):
        continue
    yoko = ws.cell(r, 3).value
    cat = ws.cell(r, 4).value
    desc = ws.cell(r, 5).value
    rows.append({
        "rowNumber": r,
        "no": ws.cell(r, 1).value,
        "menu": str(menu).strip(),
        "yokocho": str(yoko).strip() if yoko is not None else "",
        "category": str(cat).strip() if cat is not None else "",
        "desc": str(desc).strip() if desc is not None else "",
    })
print(json.dumps(rows))
wb.close(); wb2.close()
`;

  const result = spawnSync("python3", ["-c", py, xlsxPath], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Gagal baca Excel: ${result.stderr || result.stdout}`);
  }
  const rows = JSON.parse(result.stdout);
  if (!rows.length) {
    throw new Error("Tidak ada baris hijau di Draft Menu (cek fill color #00FF00)");
  }
  return rows;
}

async function resolveScope(client) {
  const { rows } = await client.query(
    `SELECT h.id AS holding_id, c.id AS company_id, b.id AS branch_id,
            h.name AS holding_name, c.name AS company_name, b.name AS branch_name
     FROM configuration.holdings h
     JOIN configuration.companies c ON c.holding_id = h.id AND c.code = $2
     JOIN configuration.branches b ON b.company_id = c.id AND b.code = $3
     WHERE h.code = $1`,
    [HOLDING_CODE, COMPANY_CODE, BRANCH_CODE]
  );
  if (!rows[0]) {
    throw new Error(`Scope ${HOLDING_CODE}/${COMPANY_CODE}/${BRANCH_CODE} tidak ditemukan`);
  }
  return rows[0];
}

async function ensureYokocho11(client, branchId) {
  const existing = await client.query(
    `SELECT id, code, name FROM configuration.warehouses
     WHERE branch_id = $1 AND (code = $2 OR lower(name) = lower($3))
     LIMIT 1`,
    [branchId, YOKOCHO_11.code, YOKOCHO_11.name]
  );
  if (existing.rowCount) {
    await client.query(
      `UPDATE configuration.warehouses
         SET name = $1, code = $2, is_active = true, updated_at = NOW()
       WHERE id = $3`,
      [YOKOCHO_11.name, YOKOCHO_11.code, existing.rows[0].id]
    );
    console.log("Warehouse Yokocho 11: updated", existing.rows[0].id);
    return existing.rows[0].id;
  }
  const ins = await client.query(
    `INSERT INTO configuration.warehouses (branch_id, name, code, is_default, is_active)
     VALUES ($1, $2, $3, false, true)
     RETURNING id`,
    [branchId, YOKOCHO_11.name, YOKOCHO_11.code]
  );
  console.log("Warehouse Yokocho 11: created", ins.rows[0].id);
  return ins.rows[0].id;
}

async function loadWarehouseMap(client, branchId) {
  const { rows } = await client.query(
    `SELECT id, code, name FROM configuration.warehouses
     WHERE branch_id = $1 AND is_active = true
     ORDER BY code`,
    [branchId]
  );
  const byName = new Map();
  for (const w of rows) {
    byName.set(normalizeText(w.name).toLowerCase(), w);
  }
  return { rows, byName };
}

function resolveWarehouse(yokochoLabel, warehouseByName) {
  const key = normalizeText(yokochoLabel).toLowerCase();
  const canonical = YOKOCHO_NAME_ALIASES[key] || yokochoLabel;
  const hit = warehouseByName.get(normalizeText(canonical).toLowerCase());
  if (!hit) {
    throw new Error(`Warehouse tidak ditemukan untuk Yokocho="${yokochoLabel}"`);
  }
  return hit;
}

async function runSqlList(client, statements, dryRun) {
  for (const sql of statements) {
    if (dryRun) continue;
    const sp = `sp_${Math.random().toString(36).slice(2, 9)}`;
    await client.query(`SAVEPOINT ${sp}`);
    try {
      await client.query(sql);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
    } catch (err) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      if (/does not exist/i.test(err.message)) {
        console.warn("  skip:", sql.slice(0, 80), "→", err.message);
        continue;
      }
      throw err;
    }
  }
}

async function wipeItemRelated(client, dryRun) {
  console.log(dryRun ? "Would wipe item/BOM/tx related tables…" : "Wiping item/BOM/tx related tables…");

  // Order: POS tx → purchasing tx → inventory → manufacturing → masters → POS catalog
  // Do NOT touch: crm.*, pos_customers, pos_wallet_*, pos_xp_*, loyalty settings, tables
  const statements = [
    // Detach member/loyalty refs from POS orders (preserve wallet/xp rows)
    `UPDATE pos.pos_wallet_transactions SET order_id = NULL WHERE order_id IS NOT NULL`,
    `UPDATE pos.pos_xp_transactions SET order_id = NULL WHERE order_id IS NOT NULL`,
    `UPDATE pos.pos_customer_vouchers SET order_id = NULL WHERE order_id IS NOT NULL`,
    `UPDATE pos.pos_tables SET current_order_id = NULL WHERE current_order_id IS NOT NULL`,
    `UPDATE ticketing.ticket_visit_charges SET pos_order_id = NULL WHERE pos_order_id IS NOT NULL`,

    // POS transactions
    `DELETE FROM pos.pos_kds_orders`,
    `DELETE FROM pos.pos_print_jobs`,
    `DELETE FROM pos.pos_split_payments`,
    `DELETE FROM pos.pos_order_split_items`,
    `DELETE FROM pos.pos_order_splits`,
    `DELETE FROM pos.pos_order_status_history`,
    `DELETE FROM pos.pos_order_items`,
    `DELETE FROM pos.pos_orders`,
    `DELETE FROM pos.pos_shift_transactions`,
    `DELETE FROM pos.pos_shifts`,
    `DELETE FROM pos.pos_cashier_shifts`,

    // Purchasing transactions
    `DELETE FROM purchasing.vendor_credit_items`,
    `DELETE FROM purchasing.vendor_credits`,
    `DELETE FROM purchasing.vendor_payments`,
    `DELETE FROM purchasing.purchase_return_items`,
    `DELETE FROM purchasing.purchase_returns`,
    `DELETE FROM purchasing.grn_qc_inspection_items`,
    `DELETE FROM purchasing.grn_qc_inspections`,
    `DELETE FROM purchasing.grn_items`,
    `DELETE FROM purchasing.grn`,
    `DELETE FROM purchasing.deliveries`,
    `DELETE FROM purchasing.purchase_order_payment_terms`,
    `DELETE FROM purchasing.purchase_order_items`,
    `DELETE FROM purchasing.purchase_orders`,
    `DELETE FROM purchasing.pr_items`,
    `DELETE FROM purchasing.purchase_requests`,
    `DELETE FROM purchasing.supply_usage_items`,
    `DELETE FROM purchasing.vendor_price_lists`,
    `DELETE FROM purchasing.supplier_price_lists`,

    // Inventory (opname lines before FG inventory)
    `DELETE FROM inventory.product_stock_opname_lines`,
    `DELETE FROM inventory.product_stock_opnames`,
    `DELETE FROM inventory.stock_opname_lines`,
    `DELETE FROM inventory.stock_opnames`,
    `DELETE FROM inventory.finished_goods_movements`,
    `DELETE FROM inventory.finished_goods_inventory`,
    `DELETE FROM inventory.inventory_movements`,
    `DELETE FROM inventory.inventory`,
    `DELETE FROM inventory.supply_inventory_movements`,
    `DELETE FROM inventory.supply_inventory`,

    // Manufacturing
    `DELETE FROM manufacturing.production_order_materials`,
    `DELETE FROM manufacturing.production_batches`,
    `DELETE FROM manufacturing.production_orders`,
    `DELETE FROM manufacturing.bom_items`,
    `DELETE FROM manufacturing.raw_material_bom_items`,

    // Detach/remove external refs to POS products (B2B/shop — bukan CRM member)
    `DELETE FROM crm.crm_sales_quotation_items WHERE product_id IS NOT NULL`,
    `DELETE FROM shop.order_items WHERE product_id IS NOT NULL`,

    // POS product catalog (keep categories)
    `DELETE FROM pos.pos_product_images`,
    `DELETE FROM pos.pos_product_modifiers`,
    `DELETE FROM pos.pos_product_skus`,
    `DELETE FROM pos.pos_product_variants`,
    `DELETE FROM pos.pos_recipes`,
    `DELETE FROM pos.pos_products`,

    // Item masters
    `UPDATE item.raw_materials SET source_product_id = NULL WHERE source_product_id IS NOT NULL`,
    `DELETE FROM item.raw_material_unit_conversions`,
    `DELETE FROM item.products`,
    `DELETE FROM item.raw_materials`,
  ];

  if (dryRun) {
    const counts = await client.query(`
      SELECT 'products' t, count(*)::int n FROM item.products WHERE deleted_at IS NULL
      UNION ALL SELECT 'raw_materials', count(*)::int FROM item.raw_materials WHERE deleted_at IS NULL
      UNION ALL SELECT 'bom_items', count(*)::int FROM manufacturing.bom_items
      UNION ALL SELECT 'pos_orders', count(*)::int FROM pos.pos_orders
      UNION ALL SELECT 'pos_products', count(*)::int FROM pos.pos_products
      UNION ALL SELECT 'crm_members', count(*)::int FROM crm.crm_member_profiles
    `);
    console.log("Current counts:", Object.fromEntries(counts.rows.map((r) => [r.t, r.n])));
    return;
  }

  await runSqlList(client, statements, false);
}

async function upsertCategory(client, companyId, categoryName) {
  const code = slugCode(categoryName, 32);
  const existing = await client.query(
    `SELECT id, code FROM item.product_categories
     WHERE deleted_at IS NULL AND (code = $1 OR lower(nama) = lower($2))
     LIMIT 1`,
    [code, categoryName]
  );
  if (existing.rowCount) return existing.rows[0].code;

  await client.query(
    `INSERT INTO item.product_categories (code, nama, deskripsi, company_id, is_active)
     VALUES ($1, $2, $3, $4, true)`,
    [code, categoryName, `Imported from Draft Menu`, companyId]
  );
  return code;
}

async function ensurePosCategory(client, name) {
  const existing = await client.query(
    `SELECT id FROM pos.pos_categories WHERE lower(name) = lower($1) LIMIT 1`,
    [name]
  );
  if (existing.rowCount) return existing.rows[0].id;
  const ins = await client.query(
    `INSERT INTO pos.pos_categories (name, is_active) VALUES ($1, true) RETURNING id`,
    [name]
  );
  return ins.rows[0].id;
}

function posCategoryName(excelCategory) {
  const hay = normalizeText(excelCategory).toLowerCase();
  if (/bakery|pastry|dessert|cake/.test(hay)) return "Dessert";
  if (/drink|minuman|coffee|tea/.test(hay)) return "Minuman";
  return excelCategory || "Makanan";
}

async function insertProductAndPos(client, { scope, unitId, row, warehouse, categoryCode, index }) {
  const kode = `DM-${slugCode(warehouse.code, 8)}-${String(index).padStart(3, "0")}`;
  const station = stationForCategory(row.category);
  const ins = await client.query(
    `INSERT INTO item.products (
       kode, nama, deskripsi, kategori, satuan_id,
       harga_jual, harga_modal, markup_persen,
       is_active, company_id, branch_id, warehouse_id,
       production_output_type, station
     ) VALUES (
       $1,$2,$3,$4,$5,
       0, 0, 0,
       true, $6, $7, $8,
       'FINISHED_GOOD', $9
     )
     RETURNING id`,
    [
      kode,
      row.menu,
      row.desc || null,
      categoryCode,
      unitId,
      scope.company_id,
      scope.branch_id,
      warehouse.id,
      station,
    ]
  );
  const productId = ins.rows[0].id;

  const posCatId = await ensurePosCategory(client, posCategoryName(row.category));
  const sku = `PUR-${kode}`;
  await client.query(
    `INSERT INTO pos.pos_products (
       sku, name, description, category_id,
       base_price, cost_price, is_active, is_available,
       inventory_tracking, station, source_product_id
     ) VALUES (
       $1,$2,$3,$4,
       0,0,true,true,
       false,$5,$6
     )`,
    [sku, row.menu, row.desc || `Draft Menu ${row.menu}`, posCatId, station, productId]
  );

  return { productId, kode, sku, warehouse: warehouse.code, station };
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const allowRemote =
    process.argv.includes("--allow-remote") || process.env.ALLOW_REMOTE_DB === "1";
  const confirmRemoteWipe =
    process.argv.includes("--confirm-remote-wipe") ||
    process.env.CONFIRM_REMOTE_ITEMS_RESET === "YES";
  const xlsxArg = process.argv.find((a) => a.startsWith("--xlsx="));
  const xlsxPath = xlsxArg ? xlsxArg.slice("--xlsx=".length) : DEFAULT_XLSX;

  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL");
    process.exit(1);
  }

  const host = parseHost(url);
  const dbName = databaseNameFromUrl(url);
  const isRemote = !isLocalDatabaseUrl(url);

  if (isRemote) {
    if (!allowRemote) {
      console.error(`REFUSED: remote ${host}/${dbName}. Tambahkan --allow-remote.`);
      process.exit(1);
    }
    if (!dryRun && !confirmRemoteWipe) {
      console.error(
        `REFUSED: apply remote butuh --confirm-remote-wipe (host=${host} db=${dbName}).`
      );
      process.exit(1);
    }
    console.warn(`WARNING: REMOTE target ${host}/${dbName} mode=${dryRun ? "dry-run" : "DESTRUCTIVE APPLY"}`);
  } else {
    try {
      assertLocalTarget(url, "MIGRATE_DATABASE_URL");
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  const menus = readGreenDraftMenu(xlsxPath);
  console.log(`Target: ${host}/${dbName}${isRemote ? " (remote)" : " (local)"}`);
  console.log(`Green Draft Menu rows: ${menus.length}`);

  const client = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await client.connect();

  try {
    if (!dryRun) await client.query("BEGIN");

    await client.query(`
      SET search_path TO
        item, manufacturing, inventory, purchasing, pos, configuration, auth, crm, public
    `);

    const scope = await resolveScope(client);
    console.log(`Scope: ${scope.holding_name} → ${scope.company_name} → ${scope.branch_name}`);

    // Ensure Yokocho 11 before mapping (even on dry-run we only report)
    if (!dryRun) {
      await ensureYokocho11(client, scope.branch_id);
    } else {
      console.log(`Would ensure warehouse ${YOKOCHO_11.name} (${YOKOCHO_11.code})`);
    }

    const { byName, rows: warehouses } = await loadWarehouseMap(client, scope.branch_id);
    if (dryRun) {
      // Simulate Yokocho 11 present for mapping check
      if (![...byName.keys()].some((k) => k === "yokocho 11")) {
        byName.set("yokocho 11", { id: "(new)", code: YOKOCHO_11.code, name: YOKOCHO_11.name });
      }
    }

    console.log(`Warehouses (${warehouses.length}):`, warehouses.map((w) => w.name).join(", "));

    // Preflight mapping
    const mapped = menus.map((m) => ({
      ...m,
      warehouse: resolveWarehouse(m.yokocho, byName),
    }));
    console.log("Sample map:");
    mapped.slice(0, 5).forEach((m) => {
      console.log(`  ${m.menu} → ${m.warehouse.name} (${m.warehouse.code})`);
    });

    await wipeItemRelated(client, dryRun);

    if (dryRun) {
      console.log("\nDry-run selesai (tidak ada write).");
      return;
    }

    const unit = await client.query(
      `SELECT id FROM item.units WHERE kode = 'PORSI' AND deleted_at IS NULL LIMIT 1`
    );
    if (!unit.rowCount) throw new Error("Unit PORSI tidak ditemukan. Seed items-units dulu.");
    const unitId = unit.rows[0].id;

    const catCache = new Map();
    const created = [];
    let i = 1;
    for (const m of mapped) {
      let categoryCode = catCache.get(m.category);
      if (!categoryCode) {
        categoryCode = await upsertCategory(client, scope.company_id, m.category || "MENU");
        catCache.set(m.category, categoryCode);
      }
      const result = await insertProductAndPos(client, {
        scope,
        unitId,
        row: m,
        warehouse: m.warehouse,
        categoryCode,
        index: i++,
      });
      created.push(result);
      console.log(`+ ${m.menu} @ ${result.warehouse} → ${result.kode}`);
    }

    await client.query("COMMIT");

    const verify = await client.query(`
      SELECT 'products' t, count(*)::int n FROM item.products WHERE deleted_at IS NULL
      UNION ALL SELECT 'raw_materials', count(*)::int FROM item.raw_materials WHERE deleted_at IS NULL
      UNION ALL SELECT 'bom_items', count(*)::int FROM manufacturing.bom_items
      UNION ALL SELECT 'pos_orders', count(*)::int FROM pos.pos_orders
      UNION ALL SELECT 'pos_products', count(*)::int FROM pos.pos_products
      UNION ALL SELECT 'crm_members', count(*)::int FROM crm.crm_member_profiles
      UNION ALL SELECT 'warehouses', count(*)::int FROM configuration.warehouses WHERE branch_id = $1
    `, [scope.branch_id]);
    console.log("\nSelesai.");
    console.log("Counts:", Object.fromEntries(verify.rows.map((r) => [r.t, r.n])));
    console.log(`Imported products: ${created.length}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
