#!/usr/bin/env node
/**
 * Seeder: configuration.warehouses → Stall locations per branch.
 *
 * Replaces legacy warehouse rows (Gudang 1 / WH-01, …) with:
 *   - Main Storage (default)
 *   - Stall 1 … Stall 13
 *
 * Usage:
 *   node database/seeders/business-stalls.js
 *   npm run db:seed:business-stalls
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");
const { resolveSeedBusinessScope } = require("../scripts/items-business-scope");

const ROOT = path.join(__dirname, "..", "..");

const STALLS = [
  { name: "Main Storage", code: "MAIN", is_default: true },
  ...Array.from({ length: 13 }, (_, index) => ({
    name: `Stall ${index + 1}`,
    code: `STALL-${String(index + 1).padStart(2, "0")}`,
    is_default: false,
  })),
];

const ALLOWED_CODES = STALLS.map((stall) => stall.code);

const REPOINT_TABLES = [
  "inventory.inventory",
  "inventory.inventory_movements",
  "inventory.stock_opnames",
  "purchasing.grn_items",
];

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

async function upsertStalls(client, branchId) {
  for (const stall of STALLS) {
    await client.query(
      `INSERT INTO configuration.warehouses (branch_id, name, code, is_default, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (branch_id, code) DO UPDATE
         SET name = EXCLUDED.name,
             is_active = true,
             updated_at = NOW()`,
      [branchId, stall.name, stall.code, stall.is_default]
    );
  }

  await client.query(
    `UPDATE configuration.warehouses
     SET is_default = false,
         updated_at = NOW()
     WHERE branch_id = $1`,
    [branchId]
  );

  await client.query(
    `UPDATE configuration.warehouses
     SET is_default = true,
         updated_at = NOW()
     WHERE branch_id = $1
       AND code = 'MAIN'`,
    [branchId]
  );
}

async function repointAndDeactivateLegacy(client, branchId) {
  const { rows: mainRows } = await client.query(
    `SELECT id FROM configuration.warehouses
     WHERE branch_id = $1 AND code = 'MAIN' AND is_active = true
     LIMIT 1`,
    [branchId]
  );
  const mainId = mainRows[0]?.id;
  if (!mainId) {
    throw new Error("Main Storage (MAIN) tidak ditemukan setelah upsert.");
  }

  const { rows: legacyRows } = await client.query(
    `SELECT id, code, name
     FROM configuration.warehouses
     WHERE branch_id = $1
       AND is_active = true
       AND NOT (code = ANY($2::text[]))`,
    [branchId, ALLOWED_CODES]
  );

  if (legacyRows.length === 0) return 0;

  const legacyIds = legacyRows.map((row) => row.id);

  for (const table of REPOINT_TABLES) {
    const { rowCount } = await client.query(
      `UPDATE ${table}
       SET warehouse_id = $1
       WHERE warehouse_id = ANY($2::uuid[])`,
      [mainId, legacyIds]
    );
    if (rowCount > 0) {
      console.log(`    ↪ ${table}: ${rowCount} baris → Main Storage`);
    }
  }

  const { rowCount } = await client.query(
    `DELETE FROM configuration.warehouses
     WHERE branch_id = $1
       AND id = ANY($2::uuid[])`,
    [branchId, legacyIds]
  );

  for (const row of legacyRows) {
    console.log(`    ✕ removed ${row.code} — ${row.name}`);
  }

  return rowCount;
}

async function seedBranch(client, branchId, branchName) {
  console.log(`\n  Branch: ${branchName}`);
  await upsertStalls(client, branchId);
  for (const stall of STALLS) {
    console.log(`    ✓ ${stall.code} — ${stall.name}${stall.is_default ? " (default)" : ""}`);
  }
  const removed = await repointAndDeactivateLegacy(client, branchId);
  if (removed === 0) {
    console.log("    (tidak ada legacy warehouse aktif)");
  }
}

async function main() {
  loadEnv();
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL di .env / .env.local");
    process.exit(1);
  }
  try {
    assertLocalTarget(url, "MIGRATE_DATABASE_URL");
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const client = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await client.connect();

  try {
    await client.query("BEGIN");

    const scope = await resolveSeedBusinessScope(client);
    console.log(`Seeding stalls for ${scope.company_name} / ${scope.branch_name}...`);

    await seedBranch(client, scope.branch_id, scope.branch_name);

    await client.query("COMMIT");
    console.log(`\nStall seeder selesai (${STALLS.length} lokasi di ${scope.branch_name}).`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
