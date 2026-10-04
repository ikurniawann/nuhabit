#!/usr/bin/env node
/**
 * Reset duplikat master Items (global template + copy company-scoped).
 *
 * Penyebab duplikat: seeder global (company_id NULL) + backfill ke company SULU.
 *
 * Usage:
 *   node database/seeders/items-reset-duplicates.js
 *   npm run db:seed:items-reset-duplicates
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");

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

async function softDeleteGlobalDuplicates(client, table, codeColumn) {
  const { rowCount } = await client.query(
    `UPDATE ${table} AS g
     SET deleted_at = NOW(),
         updated_at = NOW(),
         is_active = false
     WHERE g.company_id IS NULL
       AND g.deleted_at IS NULL
       AND EXISTS (
         SELECT 1
         FROM ${table} AS s
         WHERE s.${codeColumn} = g.${codeColumn}
           AND s.company_id IS NOT NULL
           AND s.deleted_at IS NULL
       )`
  );
  return rowCount;
}

async function softDeleteAllGlobal(client, table) {
  const { rowCount } = await client.query(
    `UPDATE ${table}
     SET deleted_at = NOW(),
         updated_at = NOW(),
         is_active = false
     WHERE company_id IS NULL
       AND deleted_at IS NULL`
  );
  return rowCount;
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

    console.log("Reset duplikat items master...");

    const repointBesar = await client.query(`
      UPDATE item.raw_materials rm
      SET satuan_besar_id = su.id,
          updated_at = NOW()
      FROM item.units gu,
           item.units su
      WHERE rm.satuan_besar_id = gu.id
        AND su.kode = gu.kode
        AND su.company_id = rm.company_id
        AND gu.company_id IS NULL
        AND rm.company_id IS NOT NULL
        AND rm.deleted_at IS NULL
        AND su.deleted_at IS NULL
    `);
    console.log(`  ✓ Repoint satuan_besar_id: ${repointBesar.rowCount} baris`);

    const repointKecil = await client.query(`
      UPDATE item.raw_materials rm
      SET satuan_kecil_id = su.id,
          updated_at = NOW()
      FROM item.units gu,
           item.units su
      WHERE rm.satuan_kecil_id = gu.id
        AND su.kode = gu.kode
        AND su.company_id = rm.company_id
        AND gu.company_id IS NULL
        AND rm.company_id IS NOT NULL
        AND rm.deleted_at IS NULL
        AND su.deleted_at IS NULL
    `);
    console.log(`  ✓ Repoint satuan_kecil_id: ${repointKecil.rowCount} baris`);

    const repointRmConv = await client.query(`
      UPDATE item.raw_material_unit_conversions uc
      SET raw_material_id = scoped.id,
          updated_at = NOW()
      FROM item.raw_materials global_rm
      JOIN item.raw_materials scoped
        ON scoped.kode = global_rm.kode
       AND scoped.company_id IS NOT NULL
       AND scoped.deleted_at IS NULL
      WHERE uc.raw_material_id = global_rm.id
        AND global_rm.company_id IS NULL
        AND global_rm.deleted_at IS NULL
    `);
    console.log(`  ✓ Repoint raw_material_unit_conversions: ${repointRmConv.rowCount} baris`);

    const repointConvUnit = await client.query(`
      UPDATE item.raw_material_unit_conversions uc
      SET satuan_id = su.id,
          updated_at = NOW()
      FROM item.units gu,
           item.units su,
           item.raw_materials rm
      WHERE uc.raw_material_id = rm.id
        AND uc.satuan_id = gu.id
        AND su.kode = gu.kode
        AND gu.company_id IS NULL
        AND rm.company_id = su.company_id
        AND rm.deleted_at IS NULL
        AND su.deleted_at IS NULL
    `);
    console.log(`  ✓ Repoint conversion satuan_id: ${repointConvUnit.rowCount} baris`);

    const rmDup = await softDeleteGlobalDuplicates(client, "item.raw_materials", "kode");
    console.log(`  ✓ Soft-delete raw_materials global duplikat: ${rmDup}`);

    const rmOrphan = await softDeleteAllGlobal(client, "item.raw_materials");
    console.log(`  ✓ Soft-delete raw_materials global sisa: ${rmOrphan}`);

    const unitDup = await softDeleteGlobalDuplicates(client, "item.units", "kode");
    console.log(`  ✓ Soft-delete units global duplikat: ${unitDup}`);

    const unitOrphan = await softDeleteAllGlobal(client, "item.units");
    console.log(`  ✓ Soft-delete units global sisa: ${unitOrphan}`);

    const catDup = await softDeleteGlobalDuplicates(client, "item.raw_material_categories", "code");
    console.log(`  ✓ Soft-delete raw_material_categories global duplikat: ${catDup}`);

    const catOrphan = await softDeleteAllGlobal(client, "item.raw_material_categories");
    console.log(`  ✓ Soft-delete raw_material_categories global sisa: ${catOrphan}`);

    await client.query("COMMIT");
    console.log("\nReset duplikat selesai. Jalankan ulang seeder items (units → categories → raw-materials).");
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
