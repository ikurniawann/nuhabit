#!/usr/bin/env node
/**
 * Seeder: item.raw_materials — bahan baku operasional restoran / F&B.
 *
 * Idempotent (upsert by kode, scope global). Di-seed sebagai template global
 * (company_id NULL, branch_id NULL) sehingga tersedia untuk semua outlet.
 *
 * Catatan:
 *   - `kategori`          = kode master item.raw_material_categories
 *   - `storage_condition` = enum SUHU_RUANG | DINGIN | BEKU | KHUSUS
 *   - `satuan_besar_id` / `satuan_kecil_id` di-resolve dari kode item.units
 *   - `konversi_factor`   = jumlah satuan kecil dalam 1 satuan besar
 *
 * Prasyarat seeder: items-units, items-raw-material-categories.
 *
 * Usage:
 *   node database/seeders/items-raw-materials.js
 *   npm run db:seed:items-raw-materials
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

/**
 * Daftar bahan baku restoran.
 * Field: kode, nama, kategori, besar (kode unit), kecil (kode unit),
 *        konv (kecil per besar), min, max, shelf (hari, null = tidak relevan),
 *        storage, deskripsi, harga (harga beli per satuan besar, IDR)
 */
const MATERIALS = [
  // ── Sayuran & Buah (DINGIN / SUHU_RUANG) ─────────────────────────────────
  ["BB-SAY-001", "Bawang Merah", "SAYUR", "KG", "GR", 1000, 5, 50, 30, "DINGIN", "Bawang merah segar kualitas A", 35000],
  ["BB-SAY-002", "Bawang Putih", "SAYUR", "KG", "GR", 1000, 5, 50, 60, "DINGIN", "Bawang putih segar", 40000],
  ["BB-SAY-003", "Bawang Bombay", "SAYUR", "KG", "GR", 1000, 3, 30, 45, "DINGIN", "Bawang bombay impor", 25000],
  ["BB-SAY-004", "Cabai Merah Keriting", "SAYUR", "KG", "GR", 1000, 3, 30, 14, "DINGIN", "Cabai merah segar", 45000],
  ["BB-SAY-005", "Tomat", "SAYUR", "KG", "GR", 1000, 5, 40, 10, "DINGIN", "Tomat segar", 15000],
  ["BB-SAY-006", "Wortel", "SAYUR", "KG", "GR", 1000, 3, 30, 21, "DINGIN", "Wortel segar", 12000],
  ["BB-SAY-007", "Kentang", "SAYUR", "KG", "GR", 1000, 5, 60, 60, "SUHU_RUANG", "Kentang sayur", 14000],
  ["BB-SAY-008", "Selada", "SAYUR", "KG", "GR", 1000, 2, 15, 7, "DINGIN", "Selada segar untuk salad", 25000],
  ["BB-SAY-009", "Daun Bawang", "SAYUR", "IKAT", "GR", 200, 2, 15, 7, "DINGIN", "Daun bawang segar", 5000],

  // ── Daging & Unggas (DINGIN / BEKU) ──────────────────────────────────────
  ["BB-DAG-001", "Daging Sapi Has Dalam", "DAGING", "KG", "GR", 1000, 5, 40, 5, "DINGIN", "Tenderloin sapi", 160000],
  ["BB-DAG-002", "Daging Sapi Giling", "DAGING", "KG", "GR", 1000, 3, 30, 3, "BEKU", "Daging sapi giling", 120000],
  ["BB-DAG-003", "Iga Sapi", "DAGING", "KG", "GR", 1000, 3, 25, 5, "BEKU", "Short ribs sapi", 110000],
  ["BB-DAG-004", "Ayam Fillet Dada", "DAGING", "KG", "GR", 1000, 5, 50, 3, "DINGIN", "Fillet dada ayam tanpa tulang", 55000],
  ["BB-DAG-005", "Ayam Utuh", "DAGING", "KG", "GR", 1000, 5, 40, 3, "DINGIN", "Ayam broiler utuh", 38000],

  // ── Seafood (BEKU) ───────────────────────────────────────────────────────
  ["BB-SEA-001", "Udang Vannamei", "SEAFOOD", "KG", "GR", 1000, 3, 25, 60, "BEKU", "Udang kupas beku", 95000],
  ["BB-SEA-002", "Ikan Dori Fillet", "SEAFOOD", "KG", "GR", 1000, 3, 25, 90, "BEKU", "Fillet dori beku", 70000],
  ["BB-SEA-003", "Cumi", "SEAFOOD", "KG", "GR", 1000, 2, 20, 60, "BEKU", "Cumi bersih beku", 65000],

  // ── Dairy & Telur (DINGIN / SUHU_RUANG) ──────────────────────────────────
  ["BB-DAI-001", "Susu UHT Full Cream", "DAIRY", "DOS", "L", 12, 5, 40, 180, "SUHU_RUANG", "Susu UHT 1L per karton isi 12", 180000],
  ["BB-DAI-002", "Keju Mozarella", "DAIRY", "KG", "GR", 1000, 2, 15, 90, "DINGIN", "Keju mozarella block", 110000],
  ["BB-DAI-003", "Butter Unsalted", "DAIRY", "KG", "GR", 1000, 2, 15, 120, "DINGIN", "Mentega tawar", 95000],
  ["BB-DAI-004", "Telur Ayam", "DAIRY", "TRAY", "BUTIR", 30, 5, 40, 21, "DINGIN", "Telur ayam negeri per tray 30 butir", 55000],
  ["BB-DAI-005", "Whipping Cream", "DAIRY", "L", "ML", 1000, 3, 20, 30, "DINGIN", "Krim kocok dairy", 60000],

  // ── Bumbu & Rempah (SUHU_RUANG) ──────────────────────────────────────────
  ["BB-BUM-001", "Garam Dapur", "BUMBU", "KG", "GR", 1000, 3, 25, 730, "SUHU_RUANG", "Garam beryodium", 8000],
  ["BB-BUM-002", "Merica Bubuk", "BUMBU", "KG", "GR", 1000, 1, 10, 365, "SUHU_RUANG", "Lada hitam bubuk", 150000],
  ["BB-BUM-003", "Kaldu Bubuk Ayam", "BUMBU", "KG", "GR", 1000, 2, 15, 365, "SUHU_RUANG", "Penyedap kaldu ayam", 45000],
  ["BB-BUM-004", "Pala Bubuk", "BUMBU", "KG", "GR", 1000, 1, 5, 365, "SUHU_RUANG", "Bubuk pala", 200000],

  // ── Bahan Kering (SUHU_RUANG) ──────────────────────────────────────────
  ["BB-KER-001", "Beras", "KERING", "SACK", "KG", 25, 2, 20, 180, "SUHU_RUANG", "Beras premium karung 25kg", 320000],
  ["BB-KER-002", "Tepung Terigu Protein Tinggi", "KERING", "SACK", "KG", 25, 2, 20, 365, "SUHU_RUANG", "Tepung terigu serbaguna", 230000],
  ["BB-KER-003", "Gula Pasir", "KERING", "KG", "GR", 1000, 5, 50, 730, "SUHU_RUANG", "Gula pasir putih", 16000],
  ["BB-KER-004", "Spaghetti", "KERING", "BOX", "GR", 5000, 2, 15, 540, "SUHU_RUANG", "Pasta spaghetti per box 5kg", 120000],
  ["BB-KER-005", "Tepung Maizena", "KERING", "KG", "GR", 1000, 1, 10, 365, "SUHU_RUANG", "Tepung jagung", 18000],

  // ── Minyak & Lemak (SUHU_RUANG) ──────────────────────────────────────────
  ["BB-OIL-001", "Minyak Goreng", "OIL", "L", "ML", 1000, 20, 200, 365, "SUHU_RUANG", "Minyak goreng sawit", 20000],
  ["BB-OIL-002", "Minyak Wijen", "OIL", "BTL", "ML", 600, 1, 10, 365, "SUHU_RUANG", "Minyak wijen botol 600ml", 45000],
  ["BB-OIL-003", "Olive Oil Extra Virgin", "OIL", "BTL", "ML", 1000, 1, 8, 540, "SUHU_RUANG", "Minyak zaitun extra virgin", 120000],

  // ── Saus & Condiment (SUHU_RUANG / DINGIN) ───────────────────────────────
  ["BB-SAU-001", "Kecap Manis", "SAUS", "BTL", "ML", 600, 3, 25, 365, "SUHU_RUANG", "Kecap manis botol 600ml", 25000],
  ["BB-SAU-002", "Saus Tiram", "SAUS", "BTL", "ML", 1000, 2, 20, 365, "SUHU_RUANG", "Saus tiram botol 1L", 35000],
  ["BB-SAU-003", "Saus Sambal", "SAUS", "BTL", "ML", 1000, 2, 20, 365, "SUHU_RUANG", "Saus sambal botol 1L", 28000],
  ["BB-SAU-004", "Mayones", "SAUS", "BTL", "GR", 1000, 2, 15, 180, "DINGIN", "Mayones botol 1kg", 40000],

  // ── Minuman (SUHU_RUANG) ─────────────────────────────────────────────────
  ["BB-MIN-001", "Biji Kopi Arabica", "MINUMAN", "KG", "GR", 1000, 2, 15, 180, "SUHU_RUANG", "Roasted bean arabica", 180000],
  ["BB-MIN-002", "Teh Celup", "MINUMAN", "BOX", "PCS", 100, 2, 15, 365, "SUHU_RUANG", "Teh celup per box 100 sachet", 35000],
  ["BB-MIN-003", "Sirup Vanilla", "MINUMAN", "BTL", "ML", 750, 2, 12, 365, "SUHU_RUANG", "Sirup vanilla botol 750ml", 75000],
  ["BB-MIN-004", "Air Mineral 600ml", "MINUMAN", "DOS", "BTL", 24, 5, 50, 365, "SUHU_RUANG", "Air mineral botol per dus isi 24", 48000],

  // ── Bahan Beku (BEKU) ────────────────────────────────────────────────────
  ["BB-BEK-001", "Kentang Goreng Beku", "BEKU", "PACK", "GR", 1000, 3, 25, 365, "BEKU", "French fries beku per pack 1kg", 35000],
  ["BB-BEK-002", "Nugget Ayam", "BEKU", "PACK", "GR", 1000, 3, 25, 365, "BEKU", "Chicken nugget beku", 45000],

  // ── Kemasan & Disposable (SUHU_RUANG) ────────────────────────────────────
  ["BB-KEM-001", "Box Takeaway", "KEMASAN", "DOS", "PCS", 100, 5, 40, null, "SUHU_RUANG", "Box makanan takeaway per dus 100 pcs", 90000],
  ["BB-KEM-002", "Cup Plastik 22oz", "KEMASAN", "PACK", "PCS", 50, 10, 80, null, "SUHU_RUANG", "Cup minuman 22oz + tutup", 40000],
  ["BB-KEM-003", "Sedotan", "KEMASAN", "PACK", "PCS", 100, 10, 60, null, "SUHU_RUANG", "Sedotan plastik per pack 100", 15000],
  ["BB-KEM-004", "Paper Bag", "KEMASAN", "PACK", "PCS", 100, 5, 40, null, "SUHU_RUANG", "Kantong kertas takeaway", 60000],

  // ── Non-Pangan (CHEM) ────────────────────────────────────────────────────
  ["BB-NON-001", "Sabun Cuci Piring", "NONPANG", "L", "ML", 1000, 5, 30, null, "KHUSUS", "Detergen cuci piring konsentrat", 25000],
  ["BB-NON-002", "Cairan Pembersih Lantai", "NONPANG", "L", "ML", 1000, 3, 20, null, "KHUSUS", "Pembersih lantai dapur", 20000],

  // ── Bahan Bakar (SUHU_RUANG) ─────────────────────────────────────────────
  ["BB-BAK-001", "Gas LPG 12kg", "BAKAR", "CAN", "KG", 12, 2, 12, null, "SUHU_RUANG", "Tabung gas LPG 12kg", 180000],
];

async function loadUnitMap(c, companyId) {
  const { rows } = await c.query(
    `SELECT id, kode
     FROM item.units
     WHERE deleted_at IS NULL
       AND company_id = $1`,
    [companyId]
  );
  return new Map(rows.map((r) => [r.kode, r.id]));
}

const INSERT_SQL = `
  INSERT INTO item.raw_materials
    (kode, nama, kategori, deskripsi, satuan_besar_id, satuan_kecil_id, konversi_factor,
     stok_minimum, stok_maximum, shelf_life_days, storage_condition, harga_beli, material_type,
     company_id, branch_id, is_active)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'PURCHASED', $13, $14, true)
  ON CONFLICT (
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kode
  ) WHERE deleted_at IS NULL
  DO UPDATE SET
    nama = EXCLUDED.nama,
    kategori = EXCLUDED.kategori,
    deskripsi = EXCLUDED.deskripsi,
    satuan_besar_id = EXCLUDED.satuan_besar_id,
    satuan_kecil_id = EXCLUDED.satuan_kecil_id,
    konversi_factor = EXCLUDED.konversi_factor,
    stok_minimum = EXCLUDED.stok_minimum,
    stok_maximum = EXCLUDED.stok_maximum,
    shelf_life_days = EXCLUDED.shelf_life_days,
    storage_condition = EXCLUDED.storage_condition,
    harga_beli = EXCLUDED.harga_beli,
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

    const scope = await resolveSeedBusinessScope(c);
    const unitMap = await loadUnitMap(c, scope.company_id);
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

    console.log(`Seeding item.raw_materials (${scope.branch_name})...`);
    for (const [
      kode,
      nama,
      kategori,
      besar,
      kecil,
      konv,
      min,
      max,
      shelf,
      storage,
      deskripsi,
      harga,
    ] of MATERIALS) {
      await c.query(INSERT_SQL, [
        kode,
        nama,
        kategori,
        deskripsi,
        uid(besar),
        uid(kecil),
        konv,
        min,
        max,
        shelf,
        storage,
        harga,
        scope.company_id,
        scope.branch_id,
      ]);
      console.log(`  ✓ ${kode} — ${nama}`);
    }

    await c.query("COMMIT");
    console.log(`\nBahan baku selesai: ${MATERIALS.length} item`);
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
