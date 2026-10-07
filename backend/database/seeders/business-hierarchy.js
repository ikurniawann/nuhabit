#!/usr/bin/env node
/**
 * Seeder: Business hierarchy — Prologe → Sulu → Sulu Bandung
 *
 * Usage:
 *   node database/seeders/business-hierarchy.js
 *   npm run db:seed:business-hierarchy
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");
const {
  HOLDING_CODE,
  COMPANY_CODE,
  BRANCH_CODE,
  BRANCH_NAME,
} = require("../scripts/items-business-scope");

const ROOT = path.join(__dirname, "..", "..");

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

    await client.query(
      `INSERT INTO configuration.holdings (name, code)
       VALUES ('Prologe', $1)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
      [HOLDING_CODE]
    );

    const { rows: holdingRows } = await client.query(
      `SELECT id, name FROM configuration.holdings WHERE code = $1 LIMIT 1`,
      [HOLDING_CODE]
    );
    const holdingId = holdingRows[0].id;

    await client.query(
      `INSERT INTO configuration.companies (holding_id, name, code)
       VALUES ($1, 'Sulu', $2)
       ON CONFLICT (holding_id, code) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
      [holdingId, COMPANY_CODE]
    );

    const { rows: companyRows } = await client.query(
      `SELECT id, name FROM configuration.companies WHERE holding_id = $1 AND code = $2 LIMIT 1`,
      [holdingId, COMPANY_CODE]
    );
    const companyId = companyRows[0].id;

    const { rows: legacyBranches } = await client.query(
      `SELECT id, code, name
       FROM configuration.branches
       WHERE company_id = $1
         AND code IN ('SULU-BRAGA', 'SULU-DAGO')
       ORDER BY CASE code WHEN 'SULU-BRAGA' THEN 0 WHEN 'SULU-DAGO' THEN 1 ELSE 2 END
       LIMIT 1`,
      [companyId]
    );

    if (legacyBranches[0]) {
      await client.query(
        `UPDATE configuration.branches
         SET name = $1, code = $2, is_active = true, updated_at = NOW()
         WHERE id = $3`,
        [BRANCH_NAME, BRANCH_CODE, legacyBranches[0].id]
      );
      console.log(`  ↪ cabang ${legacyBranches[0].code} → ${BRANCH_CODE}`);
    } else {
      await client.query(
        `INSERT INTO configuration.branches (company_id, name, code)
         VALUES ($1, $2, $3)
         ON CONFLICT (company_id, code) DO UPDATE
           SET name = EXCLUDED.name, is_active = true, updated_at = NOW()`,
        [companyId, BRANCH_NAME, BRANCH_CODE]
      );
    }

    const { rows: branchRows } = await client.query(
      `SELECT id, name FROM configuration.branches WHERE company_id = $1 AND code = $2 LIMIT 1`,
      [companyId, BRANCH_CODE]
    );

    await client.query("COMMIT");
    console.log("Business hierarchy siap:");
    console.log(`  ${holdingRows[0].name} → ${companyRows[0].name} → ${branchRows[0].name}`);
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
