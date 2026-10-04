#!/usr/bin/env node
/**
 * Sembunyikan data demo F&B (makanan/minuman) di database LOKAL supaya yang
 * tersisa hanya data produksi sandal & sepatu (permintaan owner 2026-09-04).
 *
 * Bukan hapus permanen — SOFT DELETE, karena riwayat order POS/laporan masih
 * menunjuk ke produk lama (FK). Yang dilakukan:
 *   - item.products (non SND-/SPT-/WIP-)      : deleted_at = now, is_active = false
 *   - item.raw_materials (kategori non-alas kaki): deleted_at = now, is_active = false
 *   - manufacturing.bom_items produk F&B        : is_active = false
 *   - inventory.inventory bahan F&B             : is_active = false
 *   - pos.pos_products (sku non PUR-SND/SPT)    : is_active = false, is_available = false
 *   - pos.pos_categories tanpa produk aktif     : is_active = false
 *   - item.product_categories non SANDAL/SEPATU : deleted_at = now
 *   - item.raw_material_categories non alas kaki: deleted_at = now
 *
 * Bisa dibalik: node database/seeders/items-footwear-reset-fnb.js --restore
 * (mengembalikan semua yang ditandai skrip ini lewat tag " [hidden-fnb]" di deskripsi/catatan).
 *
 * Usage:
 *   npm run db:seed:items-footwear-reset-fnb            # sembunyikan F&B
 *   npm run db:seed:items-footwear-reset-fnb -- --restore
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");

const ROOT = path.join(__dirname, "..", "..");
// Penanda baris yang disembunyikan skrip ini: tag di deskripsi — dipakai --restore.
const TAG = " [hidden-fnb]";

const FOOTWEAR_RM_CATS = ["KULIT", "SOL", "AKSESORIS", "BENANG", "PEREKAT", "WIP"];
const FOOTWEAR_PC = ["SANDAL", "SEPATU", "WIP"];

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

const FOOTWEAR_PRODUCT = `(kode LIKE 'SND-%' OR kode LIKE 'SPT-%' OR kode LIKE 'WIP-%')`;
const FOOTWEAR_RM = `(kategori = ANY($1::text[]) OR kode LIKE 'BB-KEM-1%' OR kode LIKE 'WP%' OR material_type = 'WIP')`;

async function actorId(c) {
  const { rows } = await c.query(
    `SELECT id FROM configuration.users WHERE role = 'super_admin' ORDER BY created_at LIMIT 1`
  );
  return rows[0]?.id ?? null;
}

async function hide(c) {
  const r = {};
  const by = await actorId(c);
  r.products = (await c.query(
    `UPDATE item.products SET deleted_at = NOW(), deleted_by = $1, is_active = false,
       deskripsi = COALESCE(deskripsi,'') || $2, updated_at = NOW()
     WHERE deleted_at IS NULL AND NOT ${FOOTWEAR_PRODUCT}`, [by, TAG])).rowCount;
  r.raw_materials = (await c.query(
    `UPDATE item.raw_materials SET deleted_at = NOW(), deleted_by = $2, is_active = false,
       deskripsi = COALESCE(deskripsi,'') || $3, updated_at = NOW()
     WHERE deleted_at IS NULL AND NOT ${FOOTWEAR_RM}`, [FOOTWEAR_RM_CATS, by, TAG])).rowCount;
  r.bom_items = (await c.query(
    `UPDATE manufacturing.bom_items b SET is_active = false, updated_at = NOW()
     FROM item.products p WHERE p.id = b.product_id AND p.deskripsi LIKE $1 AND b.is_active`, ['%' + TAG])).rowCount;
  r.inventory = (await c.query(
    `UPDATE inventory.inventory i SET is_active = false, catatan = COALESCE(i.catatan,'') || ' [hidden-fnb]', updated_at = NOW()
     FROM item.raw_materials r WHERE r.id = i.raw_material_id AND r.deskripsi LIKE $1 AND i.is_active`, ['%' + TAG])).rowCount;
  r.pos_products = (await c.query(
    `UPDATE pos.pos_products SET is_active = false, is_available = false,
       description = COALESCE(description,'') || ' [hidden-fnb]', updated_at = NOW()
     WHERE is_active AND sku NOT LIKE 'PUR-SND-%' AND sku NOT LIKE 'PUR-SPT-%'`)).rowCount;
  r.pos_categories = (await c.query(
    `UPDATE pos.pos_categories c SET is_active = false
     WHERE c.is_active AND NOT EXISTS (
       SELECT 1 FROM pos.pos_products p WHERE p.category_id = c.id AND p.is_active)`)).rowCount;
  r.product_categories = (await c.query(
    `UPDATE item.product_categories SET deleted_at = NOW(), deleted_by = $1, is_active = false,
       deskripsi = COALESCE(deskripsi,'') || $3, updated_at = NOW()
     WHERE deleted_at IS NULL AND NOT (code = ANY($2::text[]))`, [by, FOOTWEAR_PC, TAG])).rowCount;
  r.rm_categories = (await c.query(
    `UPDATE item.raw_material_categories SET deleted_at = NOW(), deleted_by = $1, is_active = false,
       deskripsi = COALESCE(deskripsi,'') || $3, updated_at = NOW()
     WHERE deleted_at IS NULL AND NOT (code = ANY($2::text[]) OR code = 'KEMASAN')`, [by, FOOTWEAR_RM_CATS, TAG])).rowCount;
  return r;
}

async function restore(c) {
  const r = {};
  r.products = (await c.query(
    `UPDATE item.products SET deleted_at = NULL, deleted_by = NULL, is_active = true,
       deskripsi = replace(deskripsi, $1, ''), updated_at = NOW()
     WHERE deskripsi LIKE $2`, [TAG, '%' + TAG])).rowCount;
  r.bom_items = (await c.query(
    `UPDATE manufacturing.bom_items b SET is_active = true, updated_at = NOW()
     FROM item.products p WHERE p.id = b.product_id AND p.deleted_by IS NULL AND NOT b.is_active
       AND NOT (p.kode LIKE 'SND-%' OR p.kode LIKE 'SPT-%' OR p.kode LIKE 'WIP-%')`)).rowCount;
  r.raw_materials = (await c.query(
    `UPDATE item.raw_materials SET deleted_at = NULL, deleted_by = NULL, is_active = true,
       deskripsi = replace(deskripsi, $1, ''), updated_at = NOW()
     WHERE deskripsi LIKE $2`, [TAG, '%' + TAG])).rowCount;
  r.inventory = (await c.query(
    `UPDATE inventory.inventory SET is_active = true, catatan = replace(catatan, ' [hidden-fnb]', ''), updated_at = NOW()
     WHERE catatan LIKE '%[hidden-fnb]%'`)).rowCount;
  r.pos_products = (await c.query(
    `UPDATE pos.pos_products SET is_active = true, is_available = true,
       description = replace(description, ' [hidden-fnb]', ''), updated_at = NOW()
     WHERE description LIKE '%[hidden-fnb]%'`)).rowCount;
  r.pos_categories = (await c.query(
    `UPDATE pos.pos_categories c SET is_active = true
     WHERE NOT c.is_active AND EXISTS (SELECT 1 FROM pos.pos_products p WHERE p.category_id = c.id AND p.is_active)`)).rowCount;
  r.product_categories = (await c.query(
    `UPDATE item.product_categories SET deleted_at = NULL, deleted_by = NULL, is_active = true,
       deskripsi = replace(deskripsi, $1, ''), updated_at = NOW()
     WHERE deskripsi LIKE $2`, [TAG, '%' + TAG])).rowCount;
  r.rm_categories = (await c.query(
    `UPDATE item.raw_material_categories SET deleted_at = NULL, deleted_by = NULL, is_active = true,
       deskripsi = replace(deskripsi, $1, ''), updated_at = NOW()
     WHERE deskripsi LIKE $2`, [TAG, '%' + TAG])).rowCount;
  return r;
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
  const isRestore = process.argv.includes("--restore");
  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    await c.query("BEGIN");
    const result = isRestore ? await restore(c) : await hide(c);
    await c.query("COMMIT");
    console.log(isRestore ? "Data F&B dikembalikan:" : "Data F&B disembunyikan (soft delete):");
    for (const [k, v] of Object.entries(result)) console.log(`  ${k.padEnd(20)} ${v} baris`);
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
