#!/usr/bin/env node
/**
 * Seeder: item.products — produk jadi (menu) restoran / F&B.
 *
 * Idempotent (upsert by kode).
 *
 * Catatan:
 *   - `kategori`  = kode master item.product_categories (MAIN, RICE, COFFEE, ...)
 *   - `satuan_id` = di-resolve dari kode item.units (PORSI, CUP, SLICE, PCS, ...)
 *   - `harga_modal`   = perkiraan HPP/biaya pokok
 *   - `harga_jual`    = harga jual ke pelanggan
 *   - `markup_persen` = dihitung otomatis dari (jual - modal) / modal * 100
 *
 * Prasyarat: items-units, items-product-categories.
 *
 * Usage:
 *   node database/seeders/items-products.js
 *   npm run db:seed:items-products
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

/**
 * Daftar menu produk jadi.
 * Field: kode, nama, kategori (kode), satuan (kode unit), modal, jual, deskripsi
 */
const PRODUCTS = [
  // ── Nasi (RICE) ──────────────────────────────────────────────────────────
  ["MENU-RICE-001", "Nasi Goreng Spesial", "RICE", "PORSI", 12000, 32000, "Nasi goreng dengan telur, ayam, dan acar"],
  ["MENU-RICE-002", "Nasi Goreng Seafood", "RICE", "PORSI", 18000, 42000, "Nasi goreng udang dan cumi"],
  ["MENU-RICE-003", "Nasi Ayam Geprek", "RICE", "PORSI", 13000, 30000, "Ayam geprek sambal dengan nasi"],
  ["MENU-RICE-004", "Nasi Putih", "RICE", "PORSI", 3000, 8000, "Nasi putih per porsi"],

  // ── Mie & Pasta (NOODLE) ─────────────────────────────────────────────────
  ["MENU-NOOD-001", "Mie Goreng Spesial", "NOODLE", "PORSI", 12000, 30000, "Mie goreng dengan telur dan ayam"],
  ["MENU-NOOD-002", "Spaghetti Bolognese", "NOODLE", "PORSI", 20000, 48000, "Spaghetti saus daging bolognese"],
  ["MENU-NOOD-003", "Spaghetti Aglio Olio", "NOODLE", "PORSI", 16000, 42000, "Spaghetti olive oil dan bawang putih"],

  // ── Main Course (MAIN) ───────────────────────────────────────────────────
  ["MENU-MAIN-001", "Beef Steak", "MAIN", "PORSI", 45000, 95000, "Steak sapi dengan kentang dan sayur"],
  ["MENU-MAIN-002", "Chicken Steak", "MAIN", "PORSI", 28000, 60000, "Steak ayam dengan saus mushroom"],
  ["MENU-MAIN-003", "Iga Bakar Madu", "MAIN", "PORSI", 40000, 88000, "Iga sapi bakar bumbu madu"],
  ["MENU-MAIN-004", "Ayam Bakar", "MAIN", "PORSI", 20000, 45000, "Ayam bakar bumbu kecap"],

  // ── Appetizer (APPETIZER) ────────────────────────────────────────────────
  ["MENU-APP-001", "Spring Roll", "APPETIZER", "PORSI", 10000, 25000, "Lumpia sayur goreng saus asam manis"],
  ["MENU-APP-002", "Chicken Wings", "APPETIZER", "PORSI", 18000, 40000, "Sayap ayam bumbu pedas"],

  // ── Sup (SOUP) ───────────────────────────────────────────────────────────
  ["MENU-SOUP-001", "Cream Soup", "SOUP", "PORSI", 9000, 25000, "Sup krim jagung dan ayam"],
  ["MENU-SOUP-002", "Soto Ayam", "SOUP", "PORSI", 12000, 28000, "Soto ayam kuah bening"],

  // ── Side Dish (SIDE) ─────────────────────────────────────────────────────
  ["MENU-SIDE-001", "French Fries", "SIDE", "PORSI", 8000, 22000, "Kentang goreng saus sambal/mayo"],
  ["MENU-SIDE-002", "Onion Rings", "SIDE", "PORSI", 9000, 24000, "Bawang bombay goreng tepung"],

  // ── Snack (SNACK) ────────────────────────────────────────────────────────
  ["MENU-SNK-001", "Pisang Goreng", "SNACK", "PORSI", 7000, 20000, "Pisang goreng crispy topping"],
  ["MENU-SNK-002", "Tahu Crispy", "SNACK", "PORSI", 6000, 18000, "Tahu goreng crispy sambal"],

  // ── Dessert (DESSERT) ────────────────────────────────────────────────────
  ["MENU-DES-001", "Pudding Coklat", "DESSERT", "PORSI", 7000, 22000, "Pudding coklat saus vla"],
  ["MENU-DES-002", "Es Krim Vanilla", "DESSERT", "CUP", 6000, 20000, "Es krim vanilla 2 scoop"],

  // ── Cake & Kue (CAKE) ────────────────────────────────────────────────────
  ["MENU-CAKE-001", "Slice Cheese Cake", "CAKE", "SLICE", 15000, 38000, "Cheese cake per slice"],
  ["MENU-CAKE-002", "Brownies", "CAKE", "SLICE", 10000, 28000, "Brownies coklat per slice"],

  // ── Roti & Pastry (BAKERY) ───────────────────────────────────────────────
  ["MENU-BAK-001", "Croissant", "BAKERY", "PCS", 8000, 22000, "Butter croissant"],
  ["MENU-BAK-002", "Garlic Bread", "BAKERY", "PORSI", 7000, 20000, "Roti panggang bawang putih"],

  // ── Kopi (COFFEE) ────────────────────────────────────────────────────────
  ["MENU-COF-001", "Espresso", "COFFEE", "CUP", 5000, 18000, "Single shot espresso"],
  ["MENU-COF-002", "Cappuccino", "COFFEE", "CUP", 8000, 28000, "Espresso dengan susu dan foam"],
  ["MENU-COF-003", "Caffe Latte", "COFFEE", "CUP", 8000, 30000, "Espresso dengan steamed milk"],
  ["MENU-COF-004", "Kopi Susu Gula Aren", "COFFEE", "CUP", 9000, 26000, "Kopi susu gula aren signature"],

  // ── Teh (TEA) ────────────────────────────────────────────────────────────
  ["MENU-TEA-001", "Hot Tea", "TEA", "CUP", 3000, 12000, "Teh panas"],
  ["MENU-TEA-002", "Lemon Tea", "TEA", "CUP", 5000, 18000, "Teh lemon panas/dingin"],
  ["MENU-TEA-003", "Thai Tea", "TEA", "CUP", 8000, 24000, "Thai tea creamy"],

  // ── Jus & Smoothies (JUICE) ──────────────────────────────────────────────
  ["MENU-JUI-001", "Orange Juice", "JUICE", "CUP", 9000, 25000, "Jus jeruk segar"],
  ["MENU-JUI-002", "Avocado Juice", "JUICE", "CUP", 10000, 28000, "Jus alpukat dengan coklat"],

  // ── Mocktail (MOCKTAIL) ──────────────────────────────────────────────────
  ["MENU-MOC-001", "Blue Ocean", "MOCKTAIL", "CUP", 10000, 30000, "Mocktail blue curacao soda"],
  ["MENU-MOC-002", "Lychee Mojito", "MOCKTAIL", "CUP", 11000, 32000, "Mocktail leci mint soda"],

  // ── Minuman (BEVERAGE) ───────────────────────────────────────────────────
  ["MENU-BEV-001", "Air Mineral", "BEVERAGE", "PCS", 3000, 8000, "Air mineral botol 600ml"],
  ["MENU-BEV-002", "Soft Drink", "BEVERAGE", "CUP", 5000, 15000, "Minuman bersoda per gelas"],

  // ── Paket (PACKAGE) ──────────────────────────────────────────────────────
  ["MENU-PKG-001", "Paket Hemat Ayam", "PACKAGE", "PORSI", 25000, 45000, "Nasi + ayam bakar + es teh"],
];

async function loadUnitMap(c) {
  const { rows } = await c.query(
    "SELECT id, kode FROM item.units WHERE deleted_at IS NULL"
  );
  return new Map(rows.map((r) => [r.kode, r.id]));
}

const INSERT_SQL = `
  INSERT INTO item.products
    (kode, nama, deskripsi, kategori, satuan_id, harga_jual, harga_modal, markup_persen,
     company_id, branch_id, is_active)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL, true)
  ON CONFLICT (
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kode
  ) WHERE deleted_at IS NULL
  DO UPDATE SET
    nama = EXCLUDED.nama,
    deskripsi = EXCLUDED.deskripsi,
    kategori = EXCLUDED.kategori,
    satuan_id = EXCLUDED.satuan_id,
    harga_jual = EXCLUDED.harga_jual,
    harga_modal = EXCLUDED.harga_modal,
    markup_persen = EXCLUDED.markup_persen,
    is_active = true,
    deleted_at = NULL,
    updated_at = NOW()
`;

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

    const unitMap = await loadUnitMap(c);
    const uid = (code) => {
      if (!code) return null;
      const id = unitMap.get(code);
      if (!id) {
        throw new Error(
          `Unit "${code}" tidak ditemukan. Jalankan dulu: npm run db:seed:items-units`
        );
      }
      return id;
    };

    console.log("Seeding item.products (menu restoran)...");
    for (const [kode, nama, kategori, satuan, modal, jual, deskripsi] of PRODUCTS) {
      const markup = modal > 0 ? Math.round(((jual - modal) / modal) * 100) : 0;
      await c.query(INSERT_SQL, [
        kode,
        nama,
        deskripsi,
        kategori,
        uid(satuan),
        jual,
        modal,
        markup,
      ]);
      console.log(`  ✓ ${kode} — ${nama}`);
    }

    await c.query("COMMIT");
    console.log(`\nProduk selesai: ${PRODUCTS.length} menu`);
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
