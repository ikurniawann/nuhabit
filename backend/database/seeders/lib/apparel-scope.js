/**
 * Scope tenant SULU-APPAREL (owner 2026-09-09, EPIC-047 Fase 0). Dipakai
 * seluruh seeder apparel supaya kode holding/perusahaan/cabang konsisten dan
 * tidak bercampur dengan data Sulu in Wounderland / Dusun Bambu di database
 * lokal yang sama. Pola turunan `dusun-bambu-scope.js`.
 */
const fs = require("fs");
const path = require("path");
const { sslForUrl, assertLocalTarget } = require("../../scripts/pg-utils");

const ROOT = path.join(__dirname, "..", "..", "..");

const HOLDING_CODE = process.env.SULU_APPAREL_HOLDING_CODE || "PROLOGE";
const COMPANY_CODE = process.env.SULU_APPAREL_COMPANY_CODE || "SULU-APPAREL";
const BRANCH_CODE = process.env.SULU_APPAREL_BRANCH_CODE || "SA-WORKSHOP";
const COMPANY_NAME = process.env.SULU_APPAREL_COMPANY_NAME || "Sulu Apparel";
const BRANCH_NAME = process.env.SULU_APPAREL_BRANCH_NAME || "Sulu Apparel Workshop";

// Gudang produksi (stok bahan baku, WIP, produk jadi) + outlet toko workshop.
const MAIN_WAREHOUSE_CODE = "MAIN";
const MAIN_WAREHOUSE_NAME = "Gudang Produksi";
const STORE_WAREHOUSE_CODE = "WORKSHOP-STORE";
const STORE_WAREHOUSE_NAME = "Workshop Store";

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
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!shellKeys.has(k)) process.env[k] = v;
    }
  }
}

/**
 * Muat .env/.env.local, ambil MIGRATE_DATABASE_URL/DATABASE_URL, dan tolak
 * (assertLocalTarget) bila bukan Postgres lokal. Dipakai semua seeder
 * apparel supaya guard lokal-only konsisten di satu tempat.
 */
function resolveDatabaseUrl() {
  loadEnv();
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL di .env / .env.local");
  }
  assertLocalTarget(url, "MIGRATE_DATABASE_URL");
  return url;
}

/** Buat/ambil holding → company → branch SULU-APPAREL + gudang produksi MAIN + outlet Workshop Store. */
async function ensureScope(client) {
  const holding = await client.query(
    `INSERT INTO configuration.holdings (name, code) VALUES ('Prologe', $1)
     ON CONFLICT (code) DO UPDATE SET updated_at = NOW() RETURNING id`,
    [HOLDING_CODE]
  );
  const holdingId = holding.rows[0].id;
  const company = await client.query(
    `INSERT INTO configuration.companies (holding_id, name, code, is_active) VALUES ($1, $2, $3, true)
     ON CONFLICT (holding_id, code) DO UPDATE SET name = EXCLUDED.name, is_active = true, updated_at = NOW()
     RETURNING id`,
    [holdingId, COMPANY_NAME, COMPANY_CODE]
  );
  const companyId = company.rows[0].id;
  const branch = await client.query(
    `INSERT INTO configuration.branches (company_id, name, code, is_active) VALUES ($1, $2, $3, true)
     ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, is_active = true, updated_at = NOW()
     RETURNING id`,
    [companyId, BRANCH_NAME, BRANCH_CODE]
  );
  const branchId = branch.rows[0].id;

  const mainWh = await client.query(
    `INSERT INTO configuration.warehouses (branch_id, code, name, is_default, is_active)
     VALUES ($1, $2, $3, true, true)
     ON CONFLICT (branch_id, code) DO UPDATE
       SET name = EXCLUDED.name, is_default = true, is_active = true, updated_at = NOW()
     RETURNING id`,
    [branchId, MAIN_WAREHOUSE_CODE, MAIN_WAREHOUSE_NAME]
  );
  const storeWh = await client.query(
    `INSERT INTO configuration.warehouses (branch_id, code, name, is_default, is_active)
     VALUES ($1, $2, $3, false, true)
     ON CONFLICT (branch_id, code) DO UPDATE
       SET name = EXCLUDED.name, is_active = true, updated_at = NOW()
     RETURNING id`,
    [branchId, STORE_WAREHOUSE_CODE, STORE_WAREHOUSE_NAME]
  );

  return {
    holding_id: holdingId,
    company_id: companyId,
    branch_id: branchId,
    warehouse_main_id: mainWh.rows[0].id,
    warehouse_store_id: storeWh.rows[0].id,
    company_name: COMPANY_NAME,
    branch_name: BRANCH_NAME,
  };
}

/** Ambil id gudang/outlet per kode untuk cabang SULU-APPAREL. */
async function outletMap(client, branchId) {
  const { rows } = await client.query(
    `SELECT id, code FROM configuration.warehouses WHERE branch_id = $1 AND is_active`,
    [branchId]
  );
  return new Map(rows.map((r) => [r.code, r.id]));
}

module.exports = {
  HOLDING_CODE, COMPANY_CODE, BRANCH_CODE, COMPANY_NAME, BRANCH_NAME,
  MAIN_WAREHOUSE_CODE, MAIN_WAREHOUSE_NAME, STORE_WAREHOUSE_CODE, STORE_WAREHOUSE_NAME,
  loadEnv, resolveDatabaseUrl, ensureScope, outletMap,
  sslForUrl, assertLocalTarget,
};
