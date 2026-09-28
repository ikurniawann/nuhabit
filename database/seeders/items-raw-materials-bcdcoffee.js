#!/usr/bin/env node
/**
 * Seeder: bahan baku BCD Coffee (coffee shop + light kitchen).
 *
 * Berbeda dari `items-raw-materials.js` yang berisi daftar restoran umum
 * (sayur, daging, seafood). Berkas ini fokus ke bahan yang benar-benar dipakai
 * kedai kopi: biji kopi, susu & alternatifnya, sirup, teh, bubuk, bakery, dan
 * kemasan takeaway. Keduanya bisa dijalankan berdampingan — kode bahan tidak
 * bertabrakan (prefix BCD-*).
 *
 * Idempotent: upsert per kode dalam satu transaksi. Dua kategori khusus kopi
 * (KOPI, TEH) ikut dibuat bila belum ada, karena master kategori bawaan hanya
 * punya "MINUMAN" yang terlalu umum untuk kedai kopi.
 *
 * Bentuk satu baris MATERIALS:
 *   [kode, nama, kategori, satuan_besar, satuan_kecil, konversi,
 *    stok_min, stok_max, shelf_life_hari, storage_condition, deskripsi, harga_beli]
 *
 *   - konversi          = jumlah satuan kecil dalam 1 satuan besar
 *   - storage_condition = SUHU_RUANG | DINGIN | BEKU | KHUSUS
 *   - harga_beli        = per SATUAN BESAR, rupiah (harga acuan, bukan kontrak)
 *
 * Prasyarat: items-units, items-raw-material-categories.
 *
 * Usage:
 *   node database/seeders/items-raw-materials-bcdcoffee.js
 *   npm run db:seed:items-raw-materials-bcdcoffee
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

/** Kategori tambahan khusus kedai kopi (sisanya sudah ada di master bawaan). */
const EXTRA_CATEGORIES = [
  { code: "KOPI", nama: "Kopi", deskripsi: "Biji kopi sangrai, kopi bubuk, dan turunannya" },
  { code: "TEH", nama: "Teh & Herbal", deskripsi: "Daun teh, teh celup, dan seduhan herbal" },
];

const MATERIALS = [
  // ── Kopi (SUHU_RUANG; biji sangrai cepat turun aroma, shelf life pendek) ──
  ["BCD-KOP-001", "Biji Kopi Arabica Gayo", "KOPI", "KG", "GR", 1000, 5, 40, 90, "SUHU_RUANG", "Arabica Gayo Aceh, roast medium, untuk espresso house blend", 165000],
  ["BCD-KOP-002", "Biji Kopi Arabica Kintamani", "KOPI", "KG", "GR", 1000, 3, 25, 90, "SUHU_RUANG", "Arabica Kintamani Bali, roast medium-light, notes jeruk", 175000],
  ["BCD-KOP-003", "Biji Kopi Arabica Toraja", "KOPI", "KG", "GR", 1000, 3, 25, 90, "SUHU_RUANG", "Arabica Toraja Sapan, roast medium, body tebal", 180000],
  ["BCD-KOP-004", "Biji Kopi Robusta Lampung", "KOPI", "KG", "GR", 1000, 5, 40, 120, "SUHU_RUANG", "Robusta Lampung, roast dark, penguat body espresso", 95000],
  ["BCD-KOP-005", "Biji Kopi House Blend BCD", "KOPI", "KG", "GR", 1000, 8, 60, 90, "SUHU_RUANG", "Blend 70% arabica 30% robusta, standar espresso harian", 145000],
  ["BCD-KOP-006", "Kopi Bubuk Tubruk", "KOPI", "KG", "GR", 1000, 2, 15, 120, "SUHU_RUANG", "Kopi bubuk halus untuk kopi tubruk", 85000],
  ["BCD-KOP-007", "Biji Kopi Decaf", "KOPI", "KG", "GR", 1000, 1, 8, 90, "SUHU_RUANG", "Arabica decaf proses swiss water", 220000],

  // ── Teh & herbal ─────────────────────────────────────────────────────────
  ["BCD-TEH-001", "Teh Hitam English Breakfast", "TEH", "KG", "GR", 1000, 1, 8, 365, "SUHU_RUANG", "Daun teh hitam loose leaf", 180000],
  ["BCD-TEH-002", "Teh Earl Grey", "TEH", "KG", "GR", 1000, 1, 6, 365, "SUHU_RUANG", "Teh hitam dengan bergamot, loose leaf", 195000],
  ["BCD-TEH-003", "Teh Hijau Jasmine", "TEH", "KG", "GR", 1000, 1, 8, 365, "SUHU_RUANG", "Teh hijau melati loose leaf", 165000],
  ["BCD-TEH-004", "Teh Celup Serai Jahe", "TEH", "BOX", "PCS", 25, 2, 20, 365, "SUHU_RUANG", "Teh herbal serai jahe, box isi 25 kantong", 28000],

  // ── Dairy & alternatif susu (DINGIN — rantai dingin wajib) ───────────────
  ["BCD-DAI-001", "Susu UHT Full Cream", "DAIRY", "CTN", "L", 12, 4, 30, 180, "SUHU_RUANG", "Susu UHT full cream 1L, karton isi 12", 195000],
  ["BCD-DAI-002", "Fresh Milk Barista", "DAIRY", "CTN", "L", 12, 6, 40, 14, "DINGIN", "Fresh milk grade barista, foam stabil, karton isi 12", 240000],
  ["BCD-DAI-003", "Oat Milk Barista", "DAIRY", "CTN", "L", 6, 2, 15, 180, "SUHU_RUANG", "Oat milk barista edition, karton isi 6", 210000],
  ["BCD-DAI-004", "Almond Milk Barista", "DAIRY", "CTN", "L", 6, 1, 10, 180, "SUHU_RUANG", "Almond milk unsweetened, karton isi 6", 225000],
  ["BCD-DAI-005", "Susu Kental Manis", "DAIRY", "CAN", "GR", 490, 4, 30, 365, "SUHU_RUANG", "SKM kaleng 490gr untuk kopi susu", 14500],
  ["BCD-DAI-006", "Whipping Cream", "DAIRY", "L", "ML", 1000, 2, 12, 21, "DINGIN", "Whipping cream non-dairy untuk topping", 48000],
  ["BCD-DAI-007", "Cream Cheese", "DAIRY", "KG", "GR", 1000, 1, 8, 30, "DINGIN", "Cream cheese untuk cheese foam & pastry", 95000],
  ["BCD-DAI-008", "Butter Unsalted", "DAIRY", "KG", "GR", 1000, 1, 10, 180, "DINGIN", "Butter tawar untuk pastry dan sandwich", 110000],
  ["BCD-DAI-009", "Telur Ayam", "DAIRY", "TRAY", "BUTIR", 30, 2, 15, 21, "DINGIN", "Telur ayam negeri per tray isi 30", 58000],

  // ── Sirup & pemanis ──────────────────────────────────────────────────────
  ["BCD-SIR-001", "Sirup Vanilla", "MINUMAN", "BTL", "ML", 1000, 2, 12, 540, "SUHU_RUANG", "Sirup vanilla botol 1L", 95000],
  ["BCD-SIR-002", "Sirup Caramel", "MINUMAN", "BTL", "ML", 1000, 2, 12, 540, "SUHU_RUANG", "Sirup caramel botol 1L", 95000],
  ["BCD-SIR-003", "Sirup Hazelnut", "MINUMAN", "BTL", "ML", 1000, 1, 8, 540, "SUHU_RUANG", "Sirup hazelnut botol 1L", 98000],
  ["BCD-SIR-004", "Gula Aren Cair", "MINUMAN", "BTL", "ML", 1000, 4, 25, 180, "SUHU_RUANG", "Gula aren cair untuk kopi susu gula aren", 45000],
  ["BCD-SIR-005", "Sirup Brown Sugar", "MINUMAN", "BTL", "ML", 1000, 2, 12, 365, "SUHU_RUANG", "Sirup brown sugar botol 1L", 62000],
  ["BCD-SIR-006", "Simple Syrup", "MINUMAN", "BTL", "ML", 1000, 2, 15, 90, "SUHU_RUANG", "Gula cair netral untuk iced drinks", 28000],

  // ── Bubuk minuman ────────────────────────────────────────────────────────
  ["BCD-BUB-001", "Bubuk Cokelat", "MINUMAN", "KG", "GR", 1000, 2, 15, 365, "SUHU_RUANG", "Cokelat bubuk untuk mocha & hot chocolate", 120000],
  ["BCD-BUB-002", "Bubuk Matcha", "MINUMAN", "KG", "GR", 1000, 1, 6, 365, "KHUSUS", "Matcha culinary grade, simpan kedap & gelap", 420000],
  ["BCD-BUB-003", "Bubuk Taro", "MINUMAN", "KG", "GR", 1000, 1, 8, 365, "SUHU_RUANG", "Bubuk taro untuk latte non-kopi", 85000],
  ["BCD-BUB-004", "Bubuk Red Velvet", "MINUMAN", "KG", "GR", 1000, 1, 6, 365, "SUHU_RUANG", "Bubuk red velvet latte", 92000],
  ["BCD-BUB-005", "Bubuk Kayu Manis", "BUMBU", "KG", "GR", 1000, 1, 4, 540, "SUHU_RUANG", "Kayu manis bubuk untuk topping", 78000],

  // ── Bahan kering ─────────────────────────────────────────────────────────
  ["BCD-KER-001", "Gula Pasir", "KERING", "SACK", "KG", 25, 2, 12, 540, "SUHU_RUANG", "Gula pasir putih karung 25kg", 340000],
  ["BCD-KER-002", "Tepung Terigu Protein Sedang", "KERING", "SACK", "KG", 25, 1, 8, 365, "SUHU_RUANG", "Terigu serbaguna karung 25kg", 195000],
  ["BCD-KER-003", "Garam Halus", "BUMBU", "KG", "GR", 1000, 1, 6, 720, "SUHU_RUANG", "Garam dapur beryodium", 9000],
  ["BCD-KER-004", "Es Batu Kristal", "KERING", "SACK", "KG", 10, 10, 80, 7, "BEKU", "Es batu kristal food grade karung 10kg", 22000],

  // ── Bakery & pastry ──────────────────────────────────────────────────────
  ["BCD-BAK-001", "Croissant Frozen", "BAKERY", "BOX", "PCS", 48, 2, 12, 180, "BEKU", "Croissant mentah beku, box isi 48, tinggal proofing", 480000],
  ["BCD-BAK-002", "Roti Tawar Sandwich", "BAKERY", "PACK", "LBR", 20, 4, 25, 5, "SUHU_RUANG", "Roti tawar tanpa kulit untuk sandwich", 18000],
  ["BCD-BAK-003", "Cookies Dough Choco Chip", "BAKERY", "KG", "GR", 1000, 1, 8, 90, "BEKU", "Adonan cookies beku siap panggang", 88000],
  ["BCD-BAK-004", "Selai Cokelat", "SAUS", "BTL", "GR", 1000, 1, 8, 365, "SUHU_RUANG", "Selai cokelat oles untuk pastry & toast", 72000],

  // ── Kemasan takeaway ─────────────────────────────────────────────────────
  ["BCD-KEM-001", "Paper Cup 8oz", "KEMASAN", "DOS", "PCS", 1000, 2, 10, 1095, "SUHU_RUANG", "Cup kertas panas 8oz bermerek BCD, dos isi 1000", 780000],
  ["BCD-KEM-002", "Paper Cup 12oz", "KEMASAN", "DOS", "PCS", 1000, 3, 15, 1095, "SUHU_RUANG", "Cup kertas panas 12oz bermerek BCD, dos isi 1000", 920000],
  ["BCD-KEM-003", "Plastic Cup 16oz", "KEMASAN", "DOS", "PCS", 1000, 3, 15, 1095, "SUHU_RUANG", "Cup plastik dingin 16oz, dos isi 1000", 650000],
  ["BCD-KEM-004", "Tutup Cup Panas", "KEMASAN", "DOS", "PCS", 1000, 3, 15, 1095, "SUHU_RUANG", "Lid sip-through untuk cup panas", 380000],
  ["BCD-KEM-005", "Tutup Cup Dingin", "KEMASAN", "DOS", "PCS", 1000, 3, 15, 1095, "SUHU_RUANG", "Lid datar berlubang sedotan", 320000],
  ["BCD-KEM-006", "Sedotan Kertas", "KEMASAN", "PACK", "PCS", 500, 4, 20, 730, "SUHU_RUANG", "Sedotan kertas food grade, pack isi 500", 65000],
  ["BCD-KEM-007", "Cup Sleeve Kraft", "KEMASAN", "PACK", "PCS", 500, 2, 12, 1095, "SUHU_RUANG", "Sleeve kraft bermerek BCD untuk cup panas", 145000],
  ["BCD-KEM-008", "Paper Bag Takeaway", "KEMASAN", "PACK", "PCS", 250, 3, 15, 1095, "SUHU_RUANG", "Paper bag kraft bermerek, pack isi 250", 175000],
  ["BCD-KEM-009", "Carrier Cup 2 Slot", "KEMASAN", "PACK", "PCS", 100, 2, 10, 1095, "SUHU_RUANG", "Tatakan bawa 2 cup", 85000],
  ["BCD-KEM-010", "Tissue Napkin", "KEMASAN", "PACK", "PCS", 500, 4, 20, 1095, "SUHU_RUANG", "Tissue makan pack isi 500 lembar", 32000],
  ["BCD-KEM-011", "Box Pastry Takeaway", "KEMASAN", "PACK", "PCS", 100, 2, 10, 1095, "SUHU_RUANG", "Box kertas untuk pastry & cookies", 95000],

  // ── Non-pangan & operasional ─────────────────────────────────────────────
  ["BCD-NON-001", "Espresso Machine Cleaner", "NONPANG", "BTL", "GR", 900, 1, 5, 730, "KHUSUS", "Bubuk pembersih group head, bahan kimia — simpan terpisah dari pangan", 185000],
  ["BCD-NON-002", "Grinder Cleaner", "NONPANG", "BTL", "GR", 430, 1, 4, 730, "KHUSUS", "Pembersih burr grinder berbahan pangan", 165000],
  ["BCD-NON-003", "Sabun Cuci Piring", "NONPANG", "L", "ML", 1000, 2, 12, 730, "SUHU_RUANG", "Sabun cuci piring konsentrat", 28000],
  ["BCD-NON-004", "Sarung Tangan Food Grade", "NONPANG", "BOX", "PCS", 100, 3, 15, 1095, "SUHU_RUANG", "Sarung tangan plastik sekali pakai", 18000],
  ["BCD-NON-005", "Kertas Filter V60", "NONPANG", "PACK", "PCS", 100, 3, 18, 1095, "SUHU_RUANG", "Filter kertas manual brew ukuran 02", 42000],

  // ── Dapur: bahan menu makanan ────────────────────────────────────────────
  // Kedai ini juga menjual nasi/mie/ayam, jadi bahannya ikut di-stok supaya
  // resep produk (BOM) bisa menghitung pemakaian sampai ke bahan baku.
  ["BCD-DPR-001", "Beras Premium", "KERING", "SACK", "KG", 25, 2, 10, 365, "SUHU_RUANG", "Beras pulen karung 25kg untuk nasi goreng", 380000],
  ["BCD-DPR-002", "Mie Telur Kering", "KERING", "DOS", "PACK", 30, 1, 8, 365, "SUHU_RUANG", "Mie telur kering, dos isi 30 pack", 285000],
  ["BCD-DPR-003", "Ayam Fillet Dada", "DAGING", "KG", "GR", 1000, 3, 20, 3, "DINGIN", "Fillet dada ayam tanpa tulang", 55000],
  ["BCD-DPR-004", "Kentang Beku Potong", "BEKU", "PACK", "GR", 1000, 3, 20, 365, "BEKU", "Kentang goreng beku siap olah", 62000],
  ["BCD-DPR-005", "Alpukat Mentega", "SAYUR", "KG", "GR", 1000, 3, 18, 7, "DINGIN", "Alpukat mentega untuk jus", 38000],
  ["BCD-DPR-006", "Minyak Goreng", "OIL", "L", "ML", 1000, 4, 24, 365, "SUHU_RUANG", "Minyak goreng kemasan untuk deep fry", 19000],
  ["BCD-DPR-007", "Bawang Merah", "SAYUR", "KG", "GR", 1000, 2, 12, 21, "SUHU_RUANG", "Bawang merah segar", 42000],
  ["BCD-DPR-008", "Bawang Putih", "SAYUR", "KG", "GR", 1000, 2, 10, 30, "SUHU_RUANG", "Bawang putih segar", 38000],
  ["BCD-DPR-009", "Cabai Merah", "SAYUR", "KG", "GR", 1000, 1, 8, 10, "DINGIN", "Cabai merah keriting", 55000],
  ["BCD-DPR-010", "Kecap Manis", "SAUS", "BTL", "ML", 600, 3, 18, 540, "SUHU_RUANG", "Kecap manis botol 600ml", 24000],

  // ── Bahan bakar ──────────────────────────────────────────────────────────
  ["BCD-BAR-001", "Gas LPG 12kg", "BAKAR", "PCS", "KG", 12, 2, 8, 1095, "KHUSUS", "Tabung LPG 12kg — simpan berventilasi, jauh dari panas", 220000],
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

const CATEGORY_SQL = `
  INSERT INTO item.raw_material_categories (code, nama, deskripsi, company_id, is_active)
  VALUES ($1, $2, $3, $4, true)
  ON CONFLICT (company_id, code) WHERE company_id IS NOT NULL AND deleted_at IS NULL DO UPDATE
    SET nama = EXCLUDED.nama,
        deskripsi = EXCLUDED.deskripsi,
        is_active = true,
        deleted_at = NULL,
        updated_at = NOW()
`;

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
      const id = unitMap.get(code);
      if (!id) {
        throw new Error(
          `Satuan "${code}" tidak ditemukan. Jalankan dulu: npm run db:seed:items-units`
        );
      }
      return id;
    };

    // Kategori bawaan harus sudah ada; di sini hanya menambah yang khas kopi.
    const { rows: catRows } = await c.query(
      `SELECT code FROM item.raw_material_categories
       WHERE company_id = $1 AND deleted_at IS NULL`,
      [scope.company_id]
    );
    const known = new Set(catRows.map((r) => r.code));
    for (const cat of EXTRA_CATEGORIES) {
      await c.query(CATEGORY_SQL, [cat.code, cat.nama, cat.deskripsi, scope.company_id]);
      known.add(cat.code);
    }

    // Gagal cepat bila kategori yang dipakai belum di-seed — lebih baik daripada
    // menulis baris yang kategorinya menggantung dan tidak tampil di filter UI.
    const used = [...new Set(MATERIALS.map((m) => m[2]))];
    const missing = used.filter((k) => !known.has(k));
    if (missing.length > 0) {
      throw new Error(
        `Kategori belum ada: ${missing.join(", ")}. Jalankan dulu: npm run db:seed:items-raw-material-categories`
      );
    }

    console.log(`Seeding bahan baku BCD Coffee (${scope.branch_name})...`);
    for (const [
      kode, nama, kategori, besar, kecil, konv, min, max, shelf, storage, deskripsi, harga,
    ] of MATERIALS) {
      await c.query(INSERT_SQL, [
        kode, nama, kategori, deskripsi,
        uid(besar), uid(kecil), konv,
        min, max, shelf, storage, harga,
        scope.company_id, scope.branch_id,
      ]);
      console.log(`  ✓ ${kode} — ${nama}`);
    }

    await c.query("COMMIT");
    console.log(
      `\nSelesai: ${MATERIALS.length} bahan baku, ${EXTRA_CATEGORIES.length} kategori tambahan.`
    );
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
