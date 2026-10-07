#!/usr/bin/env node
/**
 * Import SIW Menu Matrix → configuration.warehouses + item.products + pos.pos_products.
 *
 * - Stall: rename/create dari nama sheet (kecuali Operasional / Main Storage / WH-01)
 * - Produk: Summary Menu (harga jual + COGS + deskripsi)
 * - Produk lama di-hard-delete; histori yang mengunci ikut dihapus
 *
 * Usage:
 *   npm run db:seed:items-from-menu-matrix -- --dry-run
 *   npm run db:seed:items-from-menu-matrix
 *   npm run db:seed:items-from-menu-matrix -- --allow-remote --confirm-remote
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
const DEFAULT_XLSX = path.join(ROOT, "..", "docs", "SIW - Menu Matrix.xlsx");
const HOLDING_CODE = "PROLOGE";
const COMPANY_CODE = "SULU";
const BRANCH_CODE = "SULU-DAGO";

const SKIP_SHEETS = new Set([
  "summary menu",
  "market list",
  "wip food",
  "operasional",
]);

const PRESERVE_STALL_NAMES = new Set(["operasional", "main storage"]);
const PRESERVE_STALL_CODES = new Set(["WH-01", "MAIN"]);

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
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!shellKeys.has(k)) process.env[k] = v;
    }
  }
}

function databaseNameFromUrl(url) {
  try {
    return (
      (new URL(url.replace(/^postgresql:/i, "http:")).pathname || "").replace(
        /^\//,
        ""
      ) || "(unknown)"
    );
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

function toMoney(value) {
  if (value == null || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function stationForStall(stallName) {
  const hay = normalizeText(stallName).toLowerCase();
  if (/bakery|pastry|dessert|cake/.test(hay)) return "bakery";
  if (/beverage|barista|coffee|tea|drink|minuman|yokoco/.test(hay)) return "bar";
  return "kitchen";
}

function posCategoryName(stallName) {
  const station = stationForStall(stallName);
  if (station === "bakery") return "Bakery";
  if (station === "bar") return "Minuman";
  return "Makanan";
}

function isPreservedStall(warehouse) {
  const name = normalizeText(warehouse.name).toLowerCase();
  return (
    PRESERVE_STALL_NAMES.has(name) || PRESERVE_STALL_CODES.has(warehouse.code)
  );
}

function nextStallCode(existingCodes) {
  let max = 1;
  for (const code of existingCodes) {
    const match = /^STALL-(\d+)$/i.exec(code || "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `STALL-${String(max + 1).padStart(2, "0")}`;
}

function readMenuMatrix(xlsxPath) {
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`Excel tidak ditemukan: ${xlsxPath}`);
  }

  const py = `
import json, openpyxl, sys
path = sys.argv[1]
skip = {${[...SKIP_SHEETS].map((s) => jsonEscape(s)).join(", ")}}
wb = openpyxl.load_workbook(path, data_only=True)

stalls = []
for name in wb.sheetnames:
    key = " ".join(str(name).split()).strip().lower()
    if key in skip:
        continue
    stalls.append(" ".join(str(name).split()).strip())

ws = wb["Summary Menu"]
products = []
current = None
for r in range(3, ws.max_row + 1):
    name = ws.cell(r, 1).value
    if name is None or str(name).strip() == "":
        continue
    name = " ".join(str(name).split()).strip()
    status = ws.cell(r, 5).value
    desc = ws.cell(r, 6).value
    cogs = ws.cell(r, 2).value
    price = ws.cell(r, 3).value
    is_header = (status is None or str(status).strip() == "") and "stall" in name.lower()
    if is_header:
        current = " ".join(name.split()).strip()
        continue
    if name.lower() == "avg product cost":
        continue
    products.append({
        "rowNumber": r,
        "stall": current,
        "menu": name,
        "cogs": cogs,
        "price": price,
        "status": str(status).strip() if status else "",
        "desc": str(desc).strip() if desc else "",
    })
print(json.dumps({"stalls": stalls, "products": products}))
wb.close()
`;

  const result = spawnSync("python3", ["-c", py, xlsxPath], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Gagal baca Excel: ${result.stderr || result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout);
  if (!parsed.stalls?.length) {
    throw new Error("Tidak ada sheet stall di Menu Matrix");
  }
  return {
    stalls: parsed.stalls.map((s) => normalizeText(s)),
    products: mergeProducts(parsed.products || []),
  };
}

function jsonEscape(value) {
  return JSON.stringify(value);
}

function mergeProducts(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const stall = normalizeText(row.stall);
    const menu = normalizeText(row.menu);
    if (!stall || !menu) continue;
    const key = `${stall.toLowerCase()}|${menu.toLowerCase()}`;
    const next = {
      stall,
      menu,
      cogs: toMoney(row.cogs),
      price: toMoney(row.price),
      status: normalizeText(row.status),
      desc: normalizeText(row.desc),
      rowNumber: row.rowNumber,
    };
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, next);
      continue;
    }
    if (!prev.price && next.price) prev.price = next.price;
    if (!prev.cogs && next.cogs) prev.cogs = next.cogs;
    if (!prev.desc && next.desc) prev.desc = next.desc;
    if (!prev.status && next.status) prev.status = next.status;
  }
  return [...byKey.values()];
}

function resolveStallName(label, stallNames) {
  const key = normalizeText(label).toLowerCase();
  return stallNames.find((name) => name.toLowerCase() === key) || normalizeText(label);
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

async function loadWarehouses(client, branchId) {
  const { rows } = await client.query(
    `SELECT id, code, name, is_active, is_default
     FROM configuration.warehouses
     WHERE branch_id = $1
     ORDER BY code`,
    [branchId]
  );
  return rows;
}

async function syncStalls(client, branchId, stallNames, dryRun) {
  const warehouses = await loadWarehouses(client, branchId);
  const preserved = warehouses.filter(isPreservedStall);
  const mutable = warehouses.filter((w) => !isPreservedStall(w));

  const usedIds = new Set();
  const plan = [];

  for (const target of stallNames) {
    const existing = mutable.find(
      (w) =>
        !usedIds.has(w.id) &&
        normalizeText(w.name).toLowerCase() === target.toLowerCase()
    );
    if (existing) {
      usedIds.add(existing.id);
      plan.push({ action: "keep", target, warehouse: existing });
    }
  }

  const remainingTargets = stallNames.filter(
    (name) => !plan.some((p) => p.target.toLowerCase() === name.toLowerCase())
  );
  const remainingWh = mutable.filter((w) => !usedIds.has(w.id));
  const knownCodes = warehouses.map((w) => w.code);

  for (const target of remainingTargets) {
    const warehouse = remainingWh.shift();
    if (warehouse) {
      usedIds.add(warehouse.id);
      plan.push({
        action: warehouse.name === target ? "keep" : "rename",
        target,
        warehouse,
        from: warehouse.name,
      });
    } else {
      const code = nextStallCode(knownCodes);
      knownCodes.push(code);
      plan.push({ action: "create", target, code });
    }
  }

  const leftover = remainingWh;
  const byName = new Map();

  if (dryRun) {
    for (const p of plan) {
      if (p.action === "create") {
        byName.set(p.target.toLowerCase(), {
          id: "(new)",
          code: p.code,
          name: p.target,
        });
      } else {
        byName.set(p.target.toLowerCase(), {
          ...p.warehouse,
          name: p.target,
        });
      }
    }
    return { plan, leftover, byName, preserved };
  }

  for (const p of plan) {
    if (p.action === "rename") {
      await client.query(
        `UPDATE configuration.warehouses
            SET name = $1, is_active = true, updated_at = NOW()
          WHERE id = $2`,
        [p.target, p.warehouse.id]
      );
      byName.set(p.target.toLowerCase(), { ...p.warehouse, name: p.target });
    } else if (p.action === "keep") {
      await client.query(
        `UPDATE configuration.warehouses
            SET is_active = true, updated_at = NOW()
          WHERE id = $1`,
        [p.warehouse.id]
      );
      byName.set(p.target.toLowerCase(), { ...p.warehouse, name: p.target });
    } else if (p.action === "create") {
      const ins = await client.query(
        `INSERT INTO configuration.warehouses (branch_id, name, code, is_default, is_active)
         VALUES ($1, $2, $3, false, true)
         RETURNING id, code, name`,
        [branchId, p.target, p.code]
      );
      byName.set(p.target.toLowerCase(), ins.rows[0]);
    }
  }

  return { plan, leftover, byName, preserved };
}

async function upsertCategory(client, companyId, categoryName) {
  const code = slugCode(categoryName, 30);
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
    [code, categoryName, `Imported from SIW Menu Matrix`, companyId]
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

function productCode(warehouseCode, index) {
  return `MM-${slugCode(warehouseCode, 8)}-${String(index).padStart(3, "0")}`;
}

async function upsertProductAndPos(client, { scope, unitId, row, warehouse, categoryCode, index }) {
  const kode = productCode(warehouse.code, index);
  const sku = `PUR-${kode}`;
  const station = stationForStall(row.stall);
  const markup =
    row.cogs > 0 ? Math.round(((row.price - row.cogs) / row.cogs) * 10000) / 100 : 0;
  const desc = row.desc || null;

  const existing = await client.query(
    `SELECT id FROM item.products WHERE kode = $1 LIMIT 1`,
    [kode]
  );

  let productId;
  if (existing.rowCount) {
    const updated = await client.query(
      `UPDATE item.products SET
         nama = $2,
         deskripsi = $3,
         kategori = $4,
         satuan_id = $5,
         harga_jual = $6,
         harga_modal = $7,
         markup_persen = $8,
         is_active = true,
         company_id = $9,
         branch_id = $10,
         warehouse_id = $11,
         production_output_type = 'FINISHED_GOOD',
         station = $12,
         deleted_at = NULL,
         updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [
        existing.rows[0].id,
        row.menu.slice(0, 100),
        desc,
        categoryCode,
        unitId,
        row.price,
        row.cogs,
        markup,
        scope.company_id,
        scope.branch_id,
        warehouse.id,
        station,
      ]
    );
    productId = updated.rows[0].id;
  } else {
    const inserted = await client.query(
      `INSERT INTO item.products (
         kode, nama, deskripsi, kategori, satuan_id,
         harga_jual, harga_modal, markup_persen,
         is_active, company_id, branch_id, warehouse_id,
         production_output_type, station
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,$8,
         true, $9, $10, $11,
         'FINISHED_GOOD', $12
       )
       RETURNING id`,
      [
        kode,
        row.menu.slice(0, 100),
        desc,
        categoryCode,
        unitId,
        row.price,
        row.cogs,
        markup,
        scope.company_id,
        scope.branch_id,
        warehouse.id,
        station,
      ]
    );
    productId = inserted.rows[0].id;
  }

  const posCatId = await ensurePosCategory(client, posCategoryName(row.stall));
  await client.query(
    `INSERT INTO pos.pos_products (
       sku, name, description, category_id,
       base_price, cost_price, is_active, is_available,
       inventory_tracking, station, source_product_id
     ) VALUES (
       $1,$2,$3,$4,
       $5,$6,true,true,
       false,$7,$8
     )
     ON CONFLICT (sku) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       category_id = EXCLUDED.category_id,
       base_price = EXCLUDED.base_price,
       cost_price = EXCLUDED.cost_price,
       is_active = true,
       is_available = true,
       station = EXCLUDED.station,
       source_product_id = EXCLUDED.source_product_id,
       updated_at = NOW()`,
    [
      sku,
      row.menu.slice(0, 200),
      desc || `Menu Matrix ${row.menu}`,
      posCatId,
      row.price,
      row.cogs,
      station,
      productId,
    ]
  );

  return { kode, sku, warehouse: warehouse.code, station };
}

async function runSqlList(client, statements) {
  for (const sql of statements) {
    const sp = `sp_${Math.random().toString(36).slice(2, 9)}`;
    await client.query(`SAVEPOINT ${sp}`);
    try {
      const result = await client.query(sql);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
      if (result.rowCount) {
        console.log(`  - ${result.rowCount}  ${sql.replace(/\s+/g, " ").slice(0, 90)}`);
      }
    } catch (err) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      if (/does not exist/i.test(err.message)) {
        console.warn("  skip:", sql.replace(/\s+/g, " ").slice(0, 70), "→", err.message);
        continue;
      }
      throw err;
    }
  }
}

async function purgeOldCatalog(client, keepKodes) {
  const keepSkus = keepKodes.map((kode) => `PUR-${kode}`);
  console.log("Hard-delete produk lama + histori yang mengunci…");

  await client.query(`DROP TABLE IF EXISTS tmp_old_item_products`);
  await client.query(`DROP TABLE IF EXISTS tmp_old_pos_products`);
  await client.query(`DROP TABLE IF EXISTS tmp_old_orders`);

  await client.query(
    `CREATE TEMP TABLE tmp_old_item_products AS
     SELECT id FROM item.products WHERE NOT (kode = ANY($1::text[]))`,
    [keepKodes]
  );
  await client.query(
    `CREATE TEMP TABLE tmp_old_pos_products AS
     SELECT id FROM pos.pos_products
      WHERE NOT (sku = ANY($1::text[]))
         OR source_product_id IN (SELECT id FROM tmp_old_item_products)`,
    [keepSkus]
  );
  await client.query(
    `CREATE TEMP TABLE tmp_old_orders AS
     SELECT DISTINCT order_id AS id
       FROM pos.pos_order_items
      WHERE product_id IN (SELECT id FROM tmp_old_pos_products)`
  );

  const oldItems = await client.query(`SELECT count(*)::int AS n FROM tmp_old_item_products`);
  const oldPos = await client.query(`SELECT count(*)::int AS n FROM tmp_old_pos_products`);
  const oldOrders = await client.query(`SELECT count(*)::int AS n FROM tmp_old_orders`);
  console.log(
    `  target: ${oldItems.rows[0].n} item.products, ${oldPos.rows[0].n} pos_products, ${oldOrders.rows[0].n} orders`
  );

  await runSqlList(client, [
    `UPDATE pos.pos_wallet_transactions SET order_id = NULL
      WHERE order_id IN (SELECT id FROM tmp_old_orders)`,
    `UPDATE pos.pos_xp_transactions SET order_id = NULL
      WHERE order_id IN (SELECT id FROM tmp_old_orders)`,
    `UPDATE pos.pos_customer_vouchers SET order_id = NULL
      WHERE order_id IN (SELECT id FROM tmp_old_orders)`,
    `UPDATE pos.pos_tables SET current_order_id = NULL
      WHERE current_order_id IN (SELECT id FROM tmp_old_orders)`,
    `UPDATE ticketing.ticket_visit_charges SET pos_order_id = NULL
      WHERE pos_order_id IN (SELECT id FROM tmp_old_orders)`,
    `UPDATE pos.pos_shift_transactions SET order_id = NULL
      WHERE order_id IN (SELECT id FROM tmp_old_orders)`,

    `DELETE FROM pos.pos_kds_orders
      WHERE order_id IN (SELECT id FROM tmp_old_orders)`,
    `DELETE FROM pos.pos_print_jobs
      WHERE order_id IN (SELECT id FROM tmp_old_orders)`,
    `DELETE FROM pos.pos_split_payments
      WHERE order_id IN (SELECT id FROM tmp_old_orders)`,
    `DELETE FROM pos.pos_order_split_items
      WHERE split_id IN (
        SELECT id FROM pos.pos_order_splits WHERE order_id IN (SELECT id FROM tmp_old_orders)
      )`,
    `DELETE FROM pos.pos_order_splits
      WHERE order_id IN (SELECT id FROM tmp_old_orders)`,
    `DELETE FROM pos.pos_order_status_history
      WHERE order_id IN (SELECT id FROM tmp_old_orders)`,
    `DELETE FROM pos.pos_order_items
      WHERE order_id IN (SELECT id FROM tmp_old_orders)
         OR product_id IN (SELECT id FROM tmp_old_pos_products)`,
    `DELETE FROM pos.pos_orders
      WHERE id IN (SELECT id FROM tmp_old_orders)`,

    `DELETE FROM crm.crm_sales_quotation_items
      WHERE product_id IN (SELECT id FROM tmp_old_pos_products)`,
    `DELETE FROM shop.order_items
      WHERE product_id IN (SELECT id FROM tmp_old_pos_products)`,

    `DELETE FROM inventory.product_stock_opname_lines
      WHERE product_id IN (SELECT id FROM tmp_old_item_products)`,
    `DELETE FROM inventory.finished_goods_movements
      WHERE product_id IN (SELECT id FROM tmp_old_item_products)`,
    `DELETE FROM inventory.finished_goods_inventory
      WHERE product_id IN (SELECT id FROM tmp_old_item_products)`,

    `DELETE FROM manufacturing.production_order_materials
      WHERE production_order_id IN (
        SELECT id FROM manufacturing.production_orders
         WHERE product_id IN (SELECT id FROM tmp_old_item_products)
      )`,
    `DELETE FROM manufacturing.production_batches
      WHERE product_id IN (SELECT id FROM tmp_old_item_products)`,
    `DELETE FROM manufacturing.production_orders
      WHERE product_id IN (SELECT id FROM tmp_old_item_products)`,

    `DELETE FROM purchasing.grn_qc_inspection_items
      WHERE product_id IN (SELECT id FROM tmp_old_item_products)`,
    `DELETE FROM purchasing.grn_items
      WHERE product_id IN (SELECT id FROM tmp_old_item_products)`,
    `DELETE FROM purchasing.purchase_return_items
      WHERE product_id IN (SELECT id FROM tmp_old_item_products)`,
    `DELETE FROM purchasing.purchase_order_items
      WHERE product_id IN (SELECT id FROM tmp_old_item_products)`,
    `DELETE FROM purchasing.pr_items
      WHERE product_id IN (SELECT id FROM tmp_old_item_products)`,

    `DELETE FROM pos.pos_products
      WHERE id IN (SELECT id FROM tmp_old_pos_products)`,
    `UPDATE item.raw_materials
        SET source_product_id = NULL
      WHERE source_product_id IN (SELECT id FROM tmp_old_item_products)`,
    `DELETE FROM item.products
      WHERE id IN (SELECT id FROM tmp_old_item_products)`,
  ]);
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const allowRemote =
    process.argv.includes("--allow-remote") || process.env.ALLOW_REMOTE_DB === "1";
  const confirmRemote =
    process.argv.includes("--confirm-remote") ||
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
    if (!dryRun && !confirmRemote) {
      console.error(
        `REFUSED: apply remote butuh --confirm-remote (host=${host} db=${dbName}).`
      );
      process.exit(1);
    }
    console.warn(
      `WARNING: REMOTE target ${host}/${dbName} mode=${dryRun ? "dry-run" : "APPLY"}`
    );
  } else {
    try {
      assertLocalTarget(url, "MIGRATE_DATABASE_URL");
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  const matrix = readMenuMatrix(xlsxPath);
  console.log(`Target: ${host}/${dbName}${isRemote ? " (remote)" : " (local)"}`);
  console.log(`Stall sheets: ${matrix.stalls.length} — ${matrix.stalls.join(", ")}`);
  console.log(`Products: ${matrix.products.length}`);

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

    const { plan, leftover, byName, preserved } = await syncStalls(
      client,
      scope.branch_id,
      matrix.stalls,
      dryRun
    );

    console.log(
      `Preserved: ${preserved.map((w) => `${w.code} ${w.name}`).join(", ") || "(none)"}`
    );
    for (const p of plan) {
      if (p.action === "rename") {
        console.log(`  rename ${p.warehouse.code}: ${p.from} → ${p.target}`);
      } else if (p.action === "create") {
        console.log(`  create ${p.code}: ${p.target}`);
      } else {
        console.log(`  keep   ${p.warehouse.code}: ${p.target}`);
      }
    }
    if (leftover.length) {
      console.log(
        `Leftover (unchanged): ${leftover.map((w) => `${w.code} ${w.name}`).join(", ")}`
      );
    }

    const mapped = matrix.products.map((row) => {
      const stallName = resolveStallName(row.stall, matrix.stalls);
      const warehouse = byName.get(stallName.toLowerCase());
      if (!warehouse) {
        throw new Error(`Stall tidak termapping: "${row.stall}"`);
      }
      return { ...row, stall: stallName, warehouse };
    });

    console.log("Sample map:");
    mapped.slice(0, 6).forEach((m) => {
      console.log(`  ${m.menu} → ${m.warehouse.name} (${m.warehouse.code}) Rp${m.price}`);
    });

    if (dryRun) {
      const byStall = new Map();
      for (const m of mapped) {
        byStall.set(m.stall, (byStall.get(m.stall) || 0) + 1);
      }
      console.log("\nCount per stall:");
      for (const [name, n] of byStall) console.log(`  ${name}: ${n}`);
      console.log("\nDry-run selesai (tidak ada write).");
      return;
    }

    const unit = await client.query(
      `SELECT id FROM item.units WHERE kode = 'PORSI' AND deleted_at IS NULL LIMIT 1`
    );
    if (!unit.rowCount) {
      throw new Error("Unit PORSI tidak ditemukan. Seed items-units dulu.");
    }
    const unitId = unit.rows[0].id;

    const keepKodes = mapped.map((m, i) => productCode(m.warehouse.code, i + 1));
    await purgeOldCatalog(client, keepKodes);

    const catCache = new Map();
    const created = [];
    let i = 1;
    for (const row of mapped) {
      let categoryCode = catCache.get(row.stall);
      if (!categoryCode) {
        categoryCode = await upsertCategory(client, scope.company_id, row.stall);
        catCache.set(row.stall, categoryCode);
      }
      const result = await upsertProductAndPos(client, {
        scope,
        unitId,
        row,
        warehouse: row.warehouse,
        categoryCode,
        index: i++,
      });
      created.push(result);
      console.log(`+ ${row.menu} @ ${result.warehouse} → ${result.kode} Rp${row.price}`);
    }

    await client.query("COMMIT");

    const verify = await client.query(
      `
      SELECT 'products' t, count(*)::int n FROM item.products WHERE deleted_at IS NULL
      UNION ALL SELECT 'pos_products', count(*)::int FROM pos.pos_products WHERE is_active
      UNION ALL SELECT 'pos_orders', count(*)::int FROM pos.pos_orders
      UNION ALL SELECT 'warehouses', count(*)::int
        FROM configuration.warehouses WHERE branch_id = $1 AND is_active
    `,
      [scope.branch_id]
    );
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
