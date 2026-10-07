#!/usr/bin/env node
/**
 * Seeder: item.raw_material_categories — kategori bahan baku restoran / F&B.
 *
 * Idempotent (upsert by code).
 *
 * Usage:
 *   node database/seeders/items-raw-material-categories.js
 *   npm run db:seed:items-raw-material-categories
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");
const { resolveSeedBusinessScope } = require("../scripts/items-business-scope");

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

/** Kategori bahan baku umum operasional restoran. */
const CATEGORIES = [
  { code: "SAYUR", nama: "Sayuran & Buah", deskripsi: "Sayuran segar, buah, dan herbal dapur" },
  { code: "DAGING", nama: "Daging & Unggas", deskripsi: "Daging sapi, ayam, kambing, dan unggas lainnya" },
  { code: "SEAFOOD", nama: "Seafood", deskripsi: "Ikan, udang, cumi, kerang, dan hasil laut" },
  { code: "DAIRY", nama: "Dairy & Telur", deskripsi: "Susu, keju, mentega, krim, dan telur" },
  { code: "BUMBU", nama: "Bumbu & Rempah", deskripsi: "Rempah kering, bumbu dasar, dan bumbu segar" },
  { code: "KERING", nama: "Bahan Kering", deskripsi: "Tepung, beras, pasta, gula, dan bahan kering lainnya" },
  { code: "MINUMAN", nama: "Minuman", deskripsi: "Sirup, jus, soft drink, kopi, dan minuman lainnya" },
  { code: "SAUS", nama: "Saus & Condiment", deskripsi: "Saus tomat, mayones, kecap, dan condiment siap pakai" },
  { code: "BAKERY", nama: "Bakery & Pastry", deskripsi: "Bahan roti, pastry, dan baking ingredients" },
  { code: "BEKU", nama: "Bahan Beku", deskripsi: "Frozen food dan bahan beku siap olah" },
  { code: "OIL", nama: "Minyak & Lemak", deskripsi: "Minyak goreng, olive oil, margarin, dan lemak masak" },
  { code: "PROTEIN", nama: "Protein Alternatif", deskripsi: "Tahu, tempe, jamur, dan protein nabati" },
  { code: "KEMASAN", nama: "Kemasan & Disposable", deskripsi: "Box takeaway, cup, tissue, sedotan, dan plastik wrap" },
  { code: "NONPANG", nama: "Non-Pangan", deskripsi: "Chemical cleaning, hygiene, dan perlengkapan operasional" },
  { code: "BAKAR", nama: "Bahan Bakar", deskripsi: "Gas LPG, arang, dan bahan bakar dapur" },
  { code: "LAIN", nama: "Lainnya", deskripsi: "Kategori umum yang tidak termasuk grup di atas" },
];

async function upsertCategory(c, companyId, { code, nama, deskripsi }) {
  await c.query(
    `INSERT INTO item.raw_material_categories (code, nama, deskripsi, company_id, is_active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (company_id, code) WHERE company_id IS NOT NULL AND deleted_at IS NULL DO UPDATE
       SET nama = EXCLUDED.nama,
           deskripsi = EXCLUDED.deskripsi,
           is_active = true,
           deleted_at = NULL,
           updated_at = NOW()`,
    [code, nama, deskripsi, companyId]
  );
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

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();

  try {
    await c.query("BEGIN");

    const scope = await resolveSeedBusinessScope(c);
    console.log(`Seeding item.raw_material_categories (${scope.company_name})...`);
    for (const category of CATEGORIES) {
      await upsertCategory(c, scope.company_id, category);
      console.log(`  ✓ ${category.code} — ${category.nama}`);
    }

    await c.query("COMMIT");
    console.log(`\nRaw material categories selesai: ${CATEGORIES.length} kategori`);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
