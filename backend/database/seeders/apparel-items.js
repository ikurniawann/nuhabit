#!/usr/bin/env node
/**
 * Seeder TENANT SULU-APPAREL — bagian 2: master item produksi kaos, kemeja,
 * celana, sandal, dan sepatu (data lokal, owner 2026-09-09, EPIC-047 Fase 0).
 *
 * CATATAN HARGA: seluruh harga bahan baku & harga jual di file ini adalah
 * ASUMSI demo lokal (bukan hasil survei harga pasar) — sama seperti seeder
 * `items-footwear.js`. Jangan dipakai sebagai acuan pricing produksi nyata.
 *
 * Mengisi (idempoten, satu transaksi, HANYA database lokal):
 *   - item.units                       : PCS, LUSIN, M, ROLL, KG, CONE, PASANG (scope company)
 *   - item.raw_material_categories     : KAIN, BENANG, AKSESORIS, LABEL, KEMASAN, SOL, KULIT, PEREKAT, WIP (scope company)
 *   - item.raw_materials               : ±32 bahan baku + bahan setengah jadi (WIP)
 *   - item.raw_material_unit_conversions : satuan beli (LUSIN/ROLL) → satuan stok
 *   - item.product_categories          : KAOS, KEMEJA, CELANA, SANDAL, SEPATU, WIP (template global,
 *                                         sama seperti items-footwear.js — SANDAL/SEPATU/WIP dipakai bersama)
 *   - item.products                    : 12 produk jadi + 3 produk WIP @ gudang MAIN
 *   - manufacturing.bom_items          : resep produk (termasuk resep bertingkat: kaos/kemeja/sepatu
 *                                         memakai badan/upper WIP)
 *   - inventory.inventory (+movement)  : stok awal bahan baku di gudang MAIN
 *   - inventory.finished_goods_inventory : stok awal produk jadi
 *   - pos.pos_products                 : sinkron produk jadi ke POS (sku APL-<kode>,
 *                                         product_kind = 'merchandise', source_product_id)
 *
 * CATATAN SATUAN: mesin produksi aplikasi mengurangi stok memakai qty BOM apa
 * adanya (tanpa konversi satuan). Karena itu satuan STOK = satuan RESEP
 * (satuan_besar = satuan_kecil, konversi 1): kain per KG/M, sol per PASANG,
 * benang jahit per CONE, aksesoris/label/kemasan per PCS, dst. Satuan
 * pembelian (LUSIN, ROLL) dicatat sebagai konversi di raw_material_unit_conversions.
 * Fase 0 hanya menyiapkan MASTER DATA — bagian "contoh produksi" (production_orders)
 * milik items-footwear.js sengaja DILEWATI di sini (lihat EPIC-047 Fase 0).
 *
 * Usage:
 *   npm run db:seed:apparel-items
 * Prasyarat: npm run db:seed:apparel-business
 */

const { Client } = require("pg");
const { sslForUrl, resolveDatabaseUrl, ensureScope } = require("./lib/apparel-scope");

const STATION = "merchandise";
const SKU_PREFIX = "APL";

// ── Satuan per company ───────────────────────────────────────────────────
const UNITS = [
  ["PCS", "Pieces", "KECIL", "Satuan barang jadi/aksesoris"],
  ["LUSIN", "Lusin", "BESAR", "12 pcs — satuan beli aksesoris/label/kemasan"],
  ["M", "Meter", "KECIL", "Panjang bahan gulungan (kain woven, kulit sintetis)"],
  ["ROLL", "Roll", "BESAR", "Satuan beli kain/kulit gulungan"],
  ["KG", "Kilogram", "KECIL", "Berat kain rajut & lem"],
  ["CONE", "Cone", "KECIL", "Satuan stok benang jahit"],
  ["PASANG", "Pasang", "KECIL", "Sepasang sandal/sepatu"],
];

// ── Kategori bahan baku (scope company) ─────────────────────────────────
const RM_CATEGORIES = [
  ["KAIN", "Kain", "Katun rajut, oxford, flanel, twill, kanvas untuk badan garmen & upper"],
  ["BENANG", "Benang & Jahit", "Benang jahit & obras untuk garmen, benang nilon untuk sepatu"],
  ["AKSESORIS", "Aksesoris & Pengikat", "Kancing, resleting, eyelet, tali, gesper"],
  ["LABEL", "Label & Hangtag", "Label merek, label ukuran, hangtag"],
  ["KEMASAN", "Kemasan", "Polybag, dus, paper bag"],
  ["SOL", "Sol & Alas Kaki", "Outsole, midsole, insole"],
  ["KULIT", "Kulit & Bahan Atas", "Kulit sintetis, suede untuk upper sepatu & sandal"],
  ["PEREKAT", "Lem & Kimia Sepatu", "Lem kontak, primer sol"],
  ["WIP", "Bahan Setengah Jadi (WIP)", "Badan garmen & upper jahit — hasil produksi internal"],
];

// ── Bahan baku ────────────────────────────────────────────────────────────
// [kode, nama, kategori, satuanStok, hargaPerSatuanStok, stokAwal, stokMin, stokMax,
//  shelfLifeDays, storage, deskripsi, satuanBeli, isiPerSatuanBeli]
const MATERIALS = [
  // Kain (stok per KG untuk rajut, per M untuk woven)
  ["BB-KAIN-001", "Katun Combed 24s", "KAIN", "KG", 65000, 150, 40, 400, null, "SUHU_RUANG", "Rajut katun combed 24s untuk kaos reguler — beli per roll 25 kg", "ROLL", 25],
  ["BB-KAIN-002", "Katun Combed 30s", "KAIN", "KG", 78000, 100, 30, 300, null, "SUHU_RUANG", "Rajut katun combed 30s lebih halus untuk kaos premium — beli per roll 25 kg", "ROLL", 25],
  ["BB-KAIN-003", "Kanvas 12oz", "KAIN", "M", 18000, 300, 100, 800, null, "SUHU_RUANG", "Kanvas katun 12oz lebar 1,5 m untuk upper sneaker — beli per roll 50 m", "ROLL", 50],
  ["BB-KAIN-004", "Oxford Katun", "KAIN", "M", 35000, 150, 40, 400, null, "SUHU_RUANG", "Kain oxford untuk kemeja formal/kasual — beli per roll 40 m", "ROLL", 40],
  ["BB-KAIN-005", "Flanel Katun", "KAIN", "M", 28000, 150, 40, 400, null, "SUHU_RUANG", "Kain flanel kotak-kotak untuk kemeja — beli per roll 40 m", "ROLL", 40],
  ["BB-KAIN-006", "Chino Twill", "KAIN", "M", 32000, 150, 40, 400, null, "SUHU_RUANG", "Twill katun untuk celana chino — beli per roll 40 m", "ROLL", 40],
  ["BB-KAIN-007", "Fleece Jogger", "KAIN", "KG", 70000, 120, 30, 300, null, "SUHU_RUANG", "Rajut fleece untuk celana jogger — beli per roll 25 kg", "ROLL", 25],
  ["BB-KAIN-008", "Piquet Lacoste", "KAIN", "KG", 85000, 80, 20, 200, null, "SUHU_RUANG", "Rajut piquet untuk kaos polo — beli per roll 25 kg", "ROLL", 25],
  // Benang
  ["BB-BNG-001", "Benang Jahit Polyester 40s", "BENANG", "CONE", 12000, 200, 50, 500, null, "SUHU_RUANG", "Benang jahit utama garmen — beli per lusin 12 cone", "LUSIN", 12],
  ["BB-BNG-002", "Benang Obras", "BENANG", "CONE", 15000, 100, 30, 300, null, "SUHU_RUANG", "Benang obras tepi kain — beli per lusin 12 cone", "LUSIN", 12],
  ["BB-BNG-003", "Benang Nilon 210D", "BENANG", "M", 35, 20000, 5000, 40000, null, "SUHU_RUANG", "Benang nilon jahit upper sepatu — beli per roll 1.000 m", "ROLL", 1000],
  // Aksesoris & pengikat
  ["BB-AKS-001", "Kancing Kemeja 4-Lubang 12mm", "AKSESORIS", "PCS", 150, 2000, 500, 5000, null, "SUHU_RUANG", "Kancing plastik kemeja/polo — beli per lusin", "LUSIN", 12],
  ["BB-AKS-002", "Kancing Celana Jeans", "AKSESORIS", "PCS", 500, 500, 100, 1500, null, "SUHU_RUANG", "Kancing metal celana — beli per lusin", "LUSIN", 12],
  ["BB-AKS-003", "Resleting YKK 15cm", "AKSESORIS", "PCS", 3500, 300, 80, 800, null, "SUHU_RUANG", "Resleting celana — beli per lusin", "LUSIN", 12],
  ["BB-AKS-004", "Eyelet Kuningan 4mm", "AKSESORIS", "PCS", 90, 3000, 800, 8000, null, "SUHU_RUANG", "Eyelet tali sepatu — beli per lusin", "LUSIN", 12],
  ["BB-AKS-005", "Tali Sepatu 120cm", "AKSESORIS", "PASANG", 3000, 300, 80, 800, null, "SUHU_RUANG", "Tali sepatu pipih — beli per lusin", "LUSIN", 12],
  ["BB-AKS-006", "Gesper Sandal Logam", "AKSESORIS", "PCS", 2500, 300, 80, 800, null, "SUHU_RUANG", "Gesper sandal — beli per lusin", "LUSIN", 12],
  // Label & hangtag
  ["BB-LBL-001", "Label Woven Merek", "LABEL", "PCS", 500, 2000, 500, 5000, null, "SUHU_RUANG", "Label woven dijahit di kerah/pinggang — beli per roll 500 pcs", "ROLL", 500],
  ["BB-LBL-002", "Label Ukuran", "LABEL", "PCS", 300, 2000, 500, 5000, null, "SUHU_RUANG", "Label ukuran dijahit di jahitan samping — beli per roll 500 pcs", "ROLL", 500],
  ["BB-LBL-003", "Hangtag Kertas", "LABEL", "PCS", 350, 1000, 250, 2500, null, "SUHU_RUANG", "Hangtag kertas + tali — beli per lusin", "LUSIN", 12],
  // Kemasan
  ["BB-KEM-001", "Polybag OPP", "KEMASAN", "PCS", 350, 1500, 400, 4000, null, "SUHU_RUANG", "Polybag kemasan kaos/kemeja — beli per roll 500 pcs", "ROLL", 500],
  ["BB-KEM-002", "Dus Sepatu", "KEMASAN", "PCS", 3000, 300, 80, 800, null, "SUHU_RUANG", "Dus sepatu karton — beli per lusin", "LUSIN", 12],
  ["BB-KEM-003", "Paper Bag", "KEMASAN", "PCS", 1200, 500, 150, 1500, null, "SUHU_RUANG", "Paper bag kemeja/celana — beli per lusin", "LUSIN", 12],
  // Sol & alas (stok per PASANG)
  ["BB-SOL-001", "Sol Karet Sandal", "SOL", "PASANG", 20000, 300, 100, 1000, null, "SUHU_RUANG", "Outsole karet sandal jepit — beli per lusin", "LUSIN", 12],
  ["BB-SOL-002", "Sol EVA Sandal Slide", "SOL", "PASANG", 25000, 200, 80, 800, null, "SUHU_RUANG", "Sol EVA ringan untuk slide — beli per lusin", "LUSIN", 12],
  ["BB-SOL-003", "Outsole Rubber Sneaker", "SOL", "PASANG", 35000, 150, 60, 600, null, "SUHU_RUANG", "Outsole karet vulkanisir sneaker — beli per lusin", "LUSIN", 12],
  ["BB-SOL-004", "Insole Busa Latex", "SOL", "PASANG", 10000, 250, 100, 1000, null, "SUHU_RUANG", "Insole busa latex — beli per lusin", "LUSIN", 12],
  ["BB-SOL-005", "Midsole Phylon", "SOL", "PASANG", 30000, 100, 40, 400, null, "SUHU_RUANG", "Midsole phylon sepatu lari — beli per lusin", "LUSIN", 12],
  // Kulit & bahan atas
  ["BB-KUL-001", "Kulit Sintetis PU", "KULIT", "M", 20000, 200, 60, 500, 720, "SUHU_RUANG", "PU leather untuk upper sneaker & strap sandal — beli per roll 30 m", "ROLL", 30],
  ["BB-KUL-002", "Suede", "KULIT", "M", 150000, 60, 20, 150, null, "SUHU_RUANG", "Suede sapi untuk boots — beli per roll 20 m", "ROLL", 20],
  // Lem & kimia (dibeli langsung per kg, tanpa konversi satuan beli)
  ["BB-LEM-001", "Lem Kuning Kontak", "PEREKAT", "KG", 85000, 20, 5, 60, 365, "KHUSUS", "Lem kontak perakitan sandal/sepatu — dibeli langsung per kg", null, null],
  ["BB-LEM-002", "Primer Sol", "PEREKAT", "KG", 90000, 15, 5, 50, 365, "KHUSUS", "Primer perekat sol — dibeli langsung per kg", null, null],
];

// ── Kategori produk (template global — SANDAL/SEPATU/WIP dipakai bersama items-footwear.js) ──
const PRODUCT_CATEGORIES = [
  ["KAOS", "Kaos", "Kaos oblong, raglan, polo"],
  ["KEMEJA", "Kemeja", "Kemeja formal & kasual"],
  ["CELANA", "Celana", "Celana chino, jogger, jeans"],
  ["SANDAL", "Sandal", "Sandal jepit, slide, gunung, kulit"],
  ["SEPATU", "Sepatu", "Sneaker, sepatu lari, pantofel, boots"],
  ["WIP", "Setengah Jadi", "Komponen produksi internal (badan garmen, upper jahit)"],
];

// ── Produk WIP — output produksi masuk stok bahan (raw_materials WIP) ──────
const WIP_PRODUCTS = [
  {
    kode: "WIP-BADAN-KAOS", nama: "Badan Kaos Potong-Jahit", kategori: "WIP", satuan: "PCS",
    biaya_produksi: 3000, deskripsi: "Badan kaos sudah dipotong & dijahit sisi + bahu, siap rib & jahit akhir",
    components: [["BB-KAIN-001", 0.18, 0.05], ["BB-BNG-001", 0.03, 0]],
  },
  {
    kode: "WIP-BADAN-KEMEJA", nama: "Badan Kemeja Potong-Jahit", kategori: "WIP", satuan: "PCS",
    biaya_produksi: 5000, deskripsi: "Badan kemeja oxford sudah dipotong & dijahit utama, siap pasang kancing & label",
    components: [["BB-KAIN-004", 1.6, 0.08], ["BB-BNG-001", 0.02, 0]],
  },
  {
    kode: "WIP-UPPER-SEPATU", nama: "Upper Sneaker Kanvas (Jahit)", kategori: "WIP", satuan: "PASANG",
    biaya_produksi: 12000, deskripsi: "Upper kanvas sudah dijahit + eyelet, siap dirakit dengan sol",
    components: [["BB-KAIN-003", 0.45, 0.05], ["BB-BNG-003", 12, 0], ["BB-AKS-004", 12, 0.02]],
  },
];

// ── Produk jadi + BOM ───────────────────────────────────────────────────────
// components: [kodeBahan | "WIP:<kodeProdukWIP>", qty dalam satuan stok, waste(0–1)]
const PRODUCTS = [
  {
    kode: "KAOS-001", nama: "Kaos Polos Katun Combed 24s", kategori: "KAOS", pos_category: "Kaos", satuan: "PCS",
    jual: 65000, biaya_produksi: 3000, stok_awal: 80,
    deskripsi: "Kaos polos combed 24s siap jual (resep bertingkat: badan WIP)",
    components: [["WIP:WIP-BADAN-KAOS", 1, 0], ["BB-LBL-001", 1, 0], ["BB-LBL-002", 1, 0], ["BB-KEM-001", 1, 0]],
  },
  {
    kode: "KAOS-002", nama: "Kaos Raglan Kombinasi Warna", kategori: "KAOS", pos_category: "Kaos", satuan: "PCS",
    jual: 85000, biaya_produksi: 4500, stok_awal: 60,
    deskripsi: "Kaos raglan lengan kombinasi warna",
    components: [["BB-KAIN-001", 0.2, 0.05], ["BB-KAIN-002", 0.05, 0.05], ["BB-BNG-001", 0.035, 0], ["BB-LBL-001", 1, 0], ["BB-LBL-002", 1, 0], ["BB-KEM-001", 1, 0]],
  },
  {
    kode: "KAOS-003", nama: "Kaos Polo Pique Kerah Kancing", kategori: "KAOS", pos_category: "Kaos", satuan: "PCS",
    jual: 120000, biaya_produksi: 6000, stok_awal: 40,
    deskripsi: "Polo shirt pique dengan kerah & plaket kancing",
    components: [["BB-KAIN-008", 0.22, 0.05], ["BB-BNG-001", 0.04, 0], ["BB-AKS-001", 3, 0], ["BB-LBL-001", 1, 0], ["BB-LBL-002", 1, 0], ["BB-KEM-001", 1, 0]],
  },
  {
    kode: "KMJ-001", nama: "Kemeja Oxford Lengan Panjang", kategori: "KEMEJA", pos_category: "Kemeja", satuan: "PCS",
    jual: 195000, biaya_produksi: 8000, stok_awal: 30,
    deskripsi: "Kemeja oxford formal (resep bertingkat: badan WIP)",
    components: [["WIP:WIP-BADAN-KEMEJA", 1, 0], ["BB-AKS-001", 8, 0], ["BB-LBL-001", 1, 0], ["BB-LBL-002", 1, 0], ["BB-LBL-003", 1, 0], ["BB-KEM-003", 1, 0]],
  },
  {
    kode: "KMJ-002", nama: "Kemeja Flanel Lengan Panjang", kategori: "KEMEJA", pos_category: "Kemeja", satuan: "PCS",
    jual: 175000, biaya_produksi: 7500, stok_awal: 30,
    deskripsi: "Kemeja flanel kotak-kotak kasual",
    components: [["BB-KAIN-005", 1.7, 0.08], ["BB-BNG-001", 0.025, 0], ["BB-AKS-001", 8, 0], ["BB-LBL-001", 1, 0], ["BB-LBL-002", 1, 0], ["BB-LBL-003", 1, 0], ["BB-KEM-003", 1, 0]],
  },
  {
    kode: "CEL-001", nama: "Celana Chino Slim Fit", kategori: "CELANA", pos_category: "Celana", satuan: "PCS",
    jual: 165000, biaya_produksi: 9000, stok_awal: 25,
    deskripsi: "Celana chino slim fit",
    components: [["BB-KAIN-006", 1.3, 0.07], ["BB-BNG-001", 0.03, 0], ["BB-AKS-002", 1, 0], ["BB-AKS-003", 1, 0], ["BB-LBL-001", 1, 0], ["BB-LBL-002", 1, 0], ["BB-KEM-003", 1, 0]],
  },
  {
    kode: "CEL-002", nama: "Celana Jogger Fleece", kategori: "CELANA", pos_category: "Celana", satuan: "PCS",
    jual: 145000, biaya_produksi: 7000, stok_awal: 30,
    deskripsi: "Celana jogger fleece dengan tali pinggang",
    components: [["BB-KAIN-007", 0.45, 0.06], ["BB-BNG-001", 0.025, 0], ["BB-LBL-001", 1, 0], ["BB-LBL-002", 1, 0], ["BB-KEM-003", 1, 0]],
  },
  {
    kode: "SND-001", nama: "Sandal Jepit Karet Classic", kategori: "SANDAL", pos_category: "Sandal", satuan: "PASANG",
    jual: 45000, biaya_produksi: 6000, stok_awal: 60,
    deskripsi: "Sandal jepit karet, tali PU",
    components: [["BB-SOL-001", 1, 0.02], ["BB-KUL-001", 0.15, 0.05], ["BB-LEM-001", 0.015, 0], ["BB-LBL-003", 1, 0]],
  },
  {
    kode: "SND-002", nama: "Sandal Slide EVA Logo", kategori: "SANDAL", pos_category: "Sandal", satuan: "PASANG",
    jual: 85000, biaya_produksi: 9000, stok_awal: 48,
    deskripsi: "Sandal slide EVA dengan strap PU berlogo",
    components: [["BB-SOL-002", 1, 0.02], ["BB-KUL-001", 0.25, 0.05], ["BB-LEM-001", 0.02, 0], ["BB-BNG-003", 2, 0], ["BB-LBL-003", 1, 0]],
  },
  {
    kode: "SPT-001", nama: "Sepatu Sneaker Kanvas Low", kategori: "SEPATU", pos_category: "Sepatu", satuan: "PASANG",
    jual: 275000, biaya_produksi: 16000, stok_awal: 36,
    deskripsi: "Sneaker kanvas low-cut (resep bertingkat: upper WIP)",
    components: [["WIP:WIP-UPPER-SEPATU", 1, 0], ["BB-SOL-003", 1, 0.02], ["BB-SOL-004", 1, 0], ["BB-AKS-005", 1, 0], ["BB-LEM-002", 0.03, 0], ["BB-KEM-002", 1, 0]],
  },
  {
    kode: "SPT-002", nama: "Sepatu Sneaker Kulit Sintetis", kategori: "SEPATU", pos_category: "Sepatu", satuan: "PASANG",
    jual: 320000, biaya_produksi: 30000, stok_awal: 30,
    deskripsi: "Sneaker upper PU leather, midsole phylon",
    components: [["BB-KUL-001", 0.5, 0.05], ["BB-SOL-003", 1, 0.02], ["BB-SOL-005", 1, 0.02], ["BB-SOL-004", 1, 0], ["BB-AKS-004", 12, 0.02], ["BB-AKS-005", 1, 0], ["BB-BNG-003", 14, 0], ["BB-LEM-002", 0.035, 0], ["BB-KEM-002", 1, 0]],
  },
  {
    kode: "SPT-003", nama: "Sepatu Boots Suede", kategori: "SEPATU", pos_category: "Sepatu", satuan: "PASANG",
    jual: 620000, biaya_produksi: 65000, stok_awal: 12,
    deskripsi: "Boots suede mid-cut",
    components: [["BB-KUL-002", 0.45, 0.1], ["BB-SOL-003", 1, 0.02], ["BB-SOL-004", 1, 0], ["BB-AKS-004", 16, 0.02], ["BB-AKS-005", 1, 0], ["BB-BNG-003", 14, 0], ["BB-LEM-002", 0.045, 0], ["BB-KEM-002", 1, 0]],
  },
];

/* ───────────────────────────── helpers ───────────────────────────── */

const ceil100 = (n) => Math.ceil(n / 100) * 100;

async function loadUnitMap(c, companyId) {
  const { rows } = await c.query(
    `SELECT id, kode, company_id FROM item.units
     WHERE deleted_at IS NULL AND (company_id = $1 OR company_id IS NULL)
     ORDER BY (company_id IS NULL)`,
    [companyId]
  );
  const map = new Map();
  for (const r of rows) if (!map.has(r.kode)) map.set(r.kode, r.id);
  return map;
}

async function upsertUnits(c, scope) {
  for (const [kode, nama, tipe, deskripsi] of UNITS) {
    await c.query(
      `INSERT INTO item.units (kode, nama, tipe, deskripsi, company_id, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (company_id, kode) WHERE company_id IS NOT NULL AND deleted_at IS NULL DO UPDATE
         SET nama = EXCLUDED.nama, tipe = EXCLUDED.tipe, deskripsi = EXCLUDED.deskripsi,
             is_active = true, deleted_at = NULL, updated_at = NOW()`,
      [kode, nama, tipe, deskripsi, scope.company_id]
    );
  }
}

async function upsertRmCategories(c, scope) {
  for (const [code, nama, deskripsi] of RM_CATEGORIES) {
    await c.query(
      `INSERT INTO item.raw_material_categories (code, nama, deskripsi, company_id, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (company_id, code) WHERE company_id IS NOT NULL AND deleted_at IS NULL DO UPDATE
         SET nama = EXCLUDED.nama, deskripsi = EXCLUDED.deskripsi,
             is_active = true, deleted_at = NULL, updated_at = NOW()`,
      [code, nama, deskripsi, scope.company_id]
    );
  }
}

async function upsertProductCategories(c) {
  for (const [code, nama, deskripsi] of PRODUCT_CATEGORIES) {
    await c.query(
      `INSERT INTO item.product_categories (code, nama, deskripsi, company_id, is_active)
       VALUES ($1, $2, $3, NULL, true)
       ON CONFLICT (code) WHERE company_id IS NULL AND deleted_at IS NULL DO UPDATE
         SET nama = EXCLUDED.nama, deskripsi = EXCLUDED.deskripsi,
             is_active = true, deleted_at = NULL, updated_at = NOW()`,
      [code, nama, deskripsi]
    );
  }
}

const RM_UPSERT = `
  INSERT INTO item.raw_materials
    (kode, nama, kategori, deskripsi, satuan_besar_id, satuan_kecil_id, konversi_factor,
     stok_minimum, stok_maximum, shelf_life_days, storage_condition, harga_beli, material_type,
     source_product_id, company_id, branch_id, is_active)
  VALUES ($1, $2, $3, $4, $5, $5, 1, $6, $7, $8, $9, $10, $11, $12, $13, $14, true)
  ON CONFLICT (
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kode
  ) WHERE deleted_at IS NULL
  DO UPDATE SET
    nama = EXCLUDED.nama, kategori = EXCLUDED.kategori, deskripsi = EXCLUDED.deskripsi,
    satuan_besar_id = EXCLUDED.satuan_besar_id, satuan_kecil_id = EXCLUDED.satuan_kecil_id,
    konversi_factor = 1, stok_minimum = EXCLUDED.stok_minimum, stok_maximum = EXCLUDED.stok_maximum,
    shelf_life_days = EXCLUDED.shelf_life_days, storage_condition = EXCLUDED.storage_condition,
    harga_beli = EXCLUDED.harga_beli, material_type = EXCLUDED.material_type,
    source_product_id = EXCLUDED.source_product_id,
    is_active = true, deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
  RETURNING id, kode, nama, satuan_besar_id
`;

async function upsertMaterials(c, scope, uid) {
  const map = new Map();
  for (const m of MATERIALS) {
    const [kode, nama, kategori, satuan, harga, stokAwal, min, max, shelf, storage, deskripsi, beliUnit, beliIsi] = m;
    const isWip = kategori === "WIP";
    const { rows } = await c.query(RM_UPSERT, [
      kode, nama, kategori, deskripsi, uid(satuan), min, max, shelf, storage, harga,
      isWip ? "WIP" : "PURCHASED", null, scope.company_id, scope.branch_id,
    ]);
    map.set(kode, { ...rows[0], stokAwal, harga: Number(harga), satuan, unitId: uid(satuan), isWip });

    // Konversi satuan beli → satuan stok (mis. 1 LUSIN = 12 PCS)
    await c.query(`DELETE FROM item.raw_material_unit_conversions WHERE raw_material_id = $1`, [rows[0].id]);
    await c.query(
      `INSERT INTO item.raw_material_unit_conversions (raw_material_id, satuan_id, qty_in_base_unit, is_base, is_active)
       VALUES ($1, $2, 1, true, true)`,
      [rows[0].id, uid(satuan)]
    );
    if (beliUnit) {
      await c.query(
        `INSERT INTO item.raw_material_unit_conversions (raw_material_id, satuan_id, qty_in_base_unit, is_base, is_active)
         VALUES ($1, $2, $3, false, true)`,
        [rows[0].id, uid(beliUnit), beliIsi]
      );
    }
  }
  return map;
}

async function upsertProduct(c, p, scope, unitId, warehouseId, modal, outputType) {
  const jual = p.jual ?? modal;
  const markup = modal > 0 ? Math.round(((jual - modal) / modal) * 100) : 0;
  const { rows } = await c.query(
    `INSERT INTO item.products
       (kode, nama, deskripsi, kategori, satuan_id, harga_jual, harga_modal, markup_persen,
        company_id, branch_id, warehouse_id, production_output_type, station, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true)
     ON CONFLICT (
       COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
       COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
       warehouse_id, kode
     ) WHERE deleted_at IS NULL
     DO UPDATE SET
       nama = EXCLUDED.nama, deskripsi = EXCLUDED.deskripsi, kategori = EXCLUDED.kategori,
       satuan_id = EXCLUDED.satuan_id, harga_jual = EXCLUDED.harga_jual,
       harga_modal = EXCLUDED.harga_modal, markup_persen = EXCLUDED.markup_persen,
       production_output_type = EXCLUDED.production_output_type, station = EXCLUDED.station,
       is_active = true, deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
     RETURNING id, kode, nama, deskripsi, harga_jual, harga_modal, satuan_id`,
    [p.kode, p.nama, p.deskripsi, p.kategori, unitId, jual, modal, markup,
     scope.company_id, scope.branch_id, warehouseId, outputType, STATION]
  );
  return rows[0];
}

/** Bahan WIP hasil produk WIP — meniru ensureWipRawMaterial di API (kode WP<kode>). */
async function ensureWipMaterial(c, scope, product, unitId, satuan, modal) {
  const kode = `WP${product.kode.replace(/[^A-Za-z0-9]/g, "").slice(0, 17)}`.slice(0, 20).toUpperCase();
  const { rows } = await c.query(RM_UPSERT, [
    kode, product.nama, "WIP", `Hasil produksi ${product.kode} — stok bahan setengah jadi`,
    unitId, 5, 200, null, "SUHU_RUANG", modal, "WIP", product.id, scope.company_id, scope.branch_id,
  ]);
  return { ...rows[0], stokAwal: 0, harga: modal, satuan, unitId, isWip: true };
}

async function replaceBom(c, productId, components, materialMap) {
  await c.query(`DELETE FROM manufacturing.bom_items WHERE product_id = $1`, [productId]);
  for (const [ref, qty, waste] of components) {
    const m = materialMap.get(ref);
    if (!m) throw new Error(`Bahan ${ref} belum ada`);
    await c.query(
      `INSERT INTO manufacturing.bom_items (product_id, raw_material_id, qty_required, satuan_id, waste_factor, is_active)
       VALUES ($1, $2, $3, $4, $5, true)`,
      [productId, m.id, qty, m.unitId, waste || 0]
    );
  }
}

async function upsertInventory(c, scope, warehouseId, m, qty, unitCost) {
  const { rows } = await c.query(
    `INSERT INTO inventory.inventory
       (raw_material_id, qty_available, qty_on_order, qty_minimum, qty_maximum, unit_cost,
        lokasi_rak, catatan, is_active, branch_id, warehouse_id, last_movement_at)
     VALUES ($1, $2, 0, 0, 0, $3, 'RAK-AP', 'Stok seed apparel', true, $4, $5, NOW())
     ON CONFLICT (raw_material_id,
                  COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
                  COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid))
     DO UPDATE SET qty_available = EXCLUDED.qty_available, unit_cost = EXCLUDED.unit_cost,
                   is_active = true, catatan = EXCLUDED.catatan, last_movement_at = NOW(), updated_at = NOW()
     RETURNING id`,
    [m.id, qty, unitCost, scope.branch_id, warehouseId]
  );
  return rows[0].id;
}

async function seedRawStock(c, scope, warehouseId, materialMap) {
  let count = 0;
  for (const m of materialMap.values()) {
    const inventoryId = await upsertInventory(c, scope, warehouseId, m, m.stokAwal, m.harga);
    m.inventoryId = inventoryId;
    // Mutasi seed/demo lama dibersihkan supaya tidak menumpuk saat di-run ulang.
    await c.query(
      `DELETE FROM inventory.inventory_movements
       WHERE raw_material_id = $1 AND reference_type = 'seed_apparel'`,
      [m.id]
    );
    if (m.stokAwal > 0) {
      await c.query(
        `INSERT INTO inventory.inventory_movements
           (inventory_id, raw_material_id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost,
            reference_type, reference_number, alasan, is_active, branch_id, warehouse_id)
         VALUES ($1, $2, 'in', $3::numeric, 0, $3::numeric, $4::numeric, $3::numeric * $4::numeric,
                 'seed_apparel', 'SEED-AP', 'Stok awal seed apparel', true, $5, $6)`,
        [inventoryId, m.id, m.stokAwal, m.harga, scope.branch_id, warehouseId]
      );
    }
    count += 1;
  }
  return count;
}

async function upsertPosProduct(c, product, p) {
  const sku = `${SKU_PREFIX}-${product.kode}`;
  const existing = await c.query(`SELECT id FROM pos.pos_categories WHERE lower(name) = lower($1) LIMIT 1`, [p.pos_category]);
  const categoryId = existing.rows[0]
    ? existing.rows[0].id
    : (await c.query(`INSERT INTO pos.pos_categories (name, is_active) VALUES ($1, true) RETURNING id`, [p.pos_category])).rows[0].id;
  await c.query(`UPDATE pos.pos_categories SET is_active = true WHERE id = $1`, [categoryId]);
  const { rows } = await c.query(
    `INSERT INTO pos.pos_products
       (sku, name, description, category_id, base_price, cost_price, is_active, is_available,
        inventory_tracking, station, product_kind, source_product_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, true, false, $7, 'merchandise', $8, NOW())
     ON CONFLICT (sku) DO UPDATE SET
       name = EXCLUDED.name, description = EXCLUDED.description, category_id = EXCLUDED.category_id,
       base_price = EXCLUDED.base_price, cost_price = EXCLUDED.cost_price, is_active = true,
       is_available = true, station = EXCLUDED.station, product_kind = 'merchandise',
       source_product_id = EXCLUDED.source_product_id, updated_at = NOW()
     RETURNING sku, (xmax = 0) AS inserted`,
    [sku, product.nama, product.deskripsi, categoryId, Number(product.harga_jual),
     Number(product.harga_modal), STATION, product.id]
  );
  return rows[0];
}

/* ─────────────────────────────── main ─────────────────────────────── */

async function main() {
  let url;
  try {
    url = resolveDatabaseUrl();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();

  try {
    await c.query("BEGIN");
    const scope = await ensureScope(c);
    console.log(`Scope: ${scope.company_name} / ${scope.branch_name}`);
    const warehouseId = scope.warehouse_main_id;

    await upsertUnits(c, scope);
    const unitMap = await loadUnitMap(c, scope.company_id);
    const uid = (code) => {
      const id = unitMap.get(code);
      if (!id) throw new Error(`Unit "${code}" tidak ditemukan — cek UNITS di apparel-items.js`);
      return id;
    };
    await upsertRmCategories(c, scope);
    await upsertProductCategories(c);

    // 1. Bahan baku + konversi satuan beli
    const materialMap = await upsertMaterials(c, scope, uid);
    console.log(`✓ Bahan baku: ${materialMap.size} item (satuan stok = satuan resep; konversi beli tercatat)`);

    // 2. Produk WIP (badan kaos/kemeja, upper sepatu) + BOM + bahan WIP hasilnya
    const targets = {};
    let bomRowCount = 0;
    for (const p of WIP_PRODUCTS) {
      const bahan = p.components.reduce((s, [k, q, w]) => s + materialMap.get(k).harga * q * (1 + (w || 0)), 0);
      const modal = ceil100(bahan + p.biaya_produksi);
      const product = await upsertProduct(c, p, scope, uid(p.satuan), warehouseId, modal, "WIP");
      await replaceBom(c, product.id, p.components, materialMap);
      bomRowCount += p.components.length;
      const wipMat = await ensureWipMaterial(c, scope, product, uid(p.satuan), p.satuan, modal);
      materialMap.set(`WIP:${p.kode}`, wipMat);
      targets[p.kode] = { kind: "wip", id: product.id, outputType: "WIP", wipMaterialId: wipMat.id };
      console.log(`✓ Produk WIP ${p.kode} ${p.nama} — HPP resep Rp ${modal.toLocaleString("id-ID")} → bahan ${wipMat.kode}`);
    }

    // 3. Stok awal semua bahan (WIP = 0, terisi saat produksi)
    const stockCount = await seedRawStock(c, scope, warehouseId, materialMap);
    console.log(`✓ Stok awal bahan @ MAIN: ${stockCount} baris`);

    // 4. Produk jadi + BOM (bisa memakai badan/upper WIP) + stok awal + POS
    for (const p of PRODUCTS) {
      const bahan = p.components.reduce((s, [k, q, w]) => s + materialMap.get(k).harga * q * (1 + (w || 0)), 0);
      const modal = ceil100(bahan + p.biaya_produksi);
      const product = await upsertProduct(c, p, scope, uid(p.satuan), warehouseId, modal, "FINISHED_GOOD");
      await replaceBom(c, product.id, p.components, materialMap);
      bomRowCount += p.components.length;
      await c.query(
        `INSERT INTO inventory.finished_goods_inventory (product_id, qty_available, unit_cost, last_movement_at, is_active)
         VALUES ($1, $2, $3, NOW(), true)
         ON CONFLICT (product_id) DO UPDATE SET qty_available = EXCLUDED.qty_available, unit_cost = EXCLUDED.unit_cost,
           last_movement_at = NOW(), is_active = true, updated_at = NOW()`,
        [product.id, p.stok_awal, modal]
      );
      const pos = await upsertPosProduct(c, product, p);
      targets[p.kode] = { kind: "product", id: product.id, outputType: "FINISHED_GOOD" };
      console.log(`  ✓ ${p.kode} ${p.nama} — modal Rp ${modal.toLocaleString("id-ID")} / jual Rp ${p.jual.toLocaleString("id-ID")} · ${p.components.length} BOM · stok ${p.stok_awal} → POS ${pos.sku} [${pos.inserted ? "created" : "updated"}]`);
    }

    await c.query("COMMIT");
    console.log(`\nSelesai: ${materialMap.size} bahan (termasuk ${WIP_PRODUCTS.length} WIP), ${WIP_PRODUCTS.length} produk WIP, ${PRODUCTS.length} produk jadi, ${bomRowCount} baris BOM.`);
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
