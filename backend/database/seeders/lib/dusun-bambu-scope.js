/**
 * Scope tenant Dusun Bambu (owner 2026-09-06). Dipakai ketiga seeder Dusun
 * Bambu supaya kode perusahaan/cabang/gudang konsisten dan tidak bercampur
 * dengan data Sulu in Wounderland di database lokal yang sama.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

const HOLDING_CODE = process.env.DUSUN_BAMBU_HOLDING_CODE || "PROLOGE";
const COMPANY_CODE = process.env.DUSUN_BAMBU_COMPANY_CODE || "DUSUN-BAMBU";
const BRANCH_CODE = process.env.DUSUN_BAMBU_BRANCH_CODE || "DB-LEMBANG";
const COMPANY_NAME = process.env.DUSUN_BAMBU_COMPANY_NAME || "Dusun Bambu";
const BRANCH_NAME = process.env.DUSUN_BAMBU_BRANCH_NAME || "Dusun Bambu Lembang";

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

/** Buat/ambil holding → company → branch Dusun Bambu. */
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
  return {
    holding_id: holdingId,
    company_id: companyId,
    branch_id: branch.rows[0].id,
    company_name: COMPANY_NAME,
    branch_name: BRANCH_NAME,
  };
}

/** Ambil id gudang/outlet per kode untuk cabang Dusun Bambu. */
async function outletMap(client, branchId) {
  const { rows } = await client.query(
    `SELECT id, code FROM configuration.warehouses WHERE branch_id = $1 AND is_active`,
    [branchId]
  );
  return new Map(rows.map((r) => [r.code, r.id]));
}

module.exports = {
  HOLDING_CODE, COMPANY_CODE, BRANCH_CODE, COMPANY_NAME, BRANCH_NAME,
  loadEnv, ensureScope, outletMap,
};
