#!/usr/bin/env node
/**
 * Seeder: item.product_categories — kategori produk jadi restoran / F&B.
 *
 * Idempotent (upsert by code). Di-seed sebagai template global (company_id NULL).
 *
 * Usage:
 *   node database/seeders/items-product-categories.js
 *   npm run db:seed:items-product-categories
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

/** Kategori produk jadi yang dijual restoran (menu). */
const CATEGORIES = [
  { code: "APPETIZER", nama: "Appetizer", deskripsi: "Hidangan pembuka sebelum menu utama" },
  { code: "MAIN", nama: "Main Course", deskripsi: "Hidangan utama / makan berat" },
  { code: "RICE", nama: "Nasi", deskripsi: "Aneka nasi goreng, nasi campur, dan rice bowl" },
  { code: "NOODLE", nama: "Mie & Pasta", deskripsi: "Mie, kwetiau, bihun, dan pasta" },
  { code: "SOUP", nama: "Sup & Berkuah", deskripsi: "Soto, sup, dan hidangan berkuah" },
  { code: "SIDE", nama: "Side Dish", deskripsi: "Lauk dan hidangan pendamping" },
  { code: "SNACK", nama: "Snack & Cemilan", deskripsi: "Gorengan, finger food, dan cemilan" },
  { code: "DESSERT", nama: "Dessert", deskripsi: "Hidangan penutup / pencuci mulut" },
  { code: "COFFEE", nama: "Kopi", deskripsi: "Espresso based, manual brew, dan kopi susu" },
  { code: "TEA", nama: "Teh", deskripsi: "Aneka teh panas dan dingin" },
  { code: "BEVERAGE", nama: "Minuman", deskripsi: "Minuman non-kopi: soft drink, susu, dan lainnya" },
  { code: "JUICE", nama: "Jus & Smoothies", deskripsi: "Jus buah segar dan smoothies" },
  { code: "MOCKTAIL", nama: "Mocktail", deskripsi: "Minuman racikan non-alkohol" },
  { code: "BAKERY", nama: "Roti & Pastry", deskripsi: "Roti, croissant, dan pastry" },
  { code: "CAKE", nama: "Cake & Kue", deskripsi: "Cake, slice, dan aneka kue" },
  { code: "PACKAGE", nama: "Paket & Bundling", deskripsi: "Paket hemat dan menu bundling" },
  { code: "PROMO", nama: "Menu Promo", deskripsi: "Menu musiman dan promosi terbatas" },
  { code: "OTHER", nama: "Lainnya", deskripsi: "Kategori produk yang tidak termasuk grup di atas" },
];

// Seed sebagai template global (company_id NULL) — berlaku untuk semua company.
async function upsertCategory(c, { code, nama, deskripsi }) {
  await c.query(
    `INSERT INTO item.product_categories (code, nama, deskripsi, company_id, is_active)
     VALUES ($1, $2, $3, NULL, true)
     ON CONFLICT (code) WHERE company_id IS NULL AND deleted_at IS NULL DO UPDATE
       SET nama = EXCLUDED.nama,
           deskripsi = EXCLUDED.deskripsi,
           is_active = true,
           deleted_at = NULL,
           updated_at = NOW()`,
    [code, nama, deskripsi]
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

    console.log("Seeding item.product_categories (restoran)...");
    for (const category of CATEGORIES) {
      await upsertCategory(c, category);
      console.log(`  ✓ ${category.code} — ${category.nama}`);
    }

    await c.query("COMMIT");
    console.log(`\nProduct categories selesai: ${CATEGORIES.length} kategori`);
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
