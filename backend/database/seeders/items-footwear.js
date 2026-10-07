#!/usr/bin/env node
/**
 * Seeder demo PRODUKSI SANDAL & SEPATU (data lokal, permintaan owner 2026-09-04).
 *
 * Mengisi (idempoten, satu transaksi, HANYA database lokal):
 *   - item.units                       : PASANG, LUSIN, M, M2 (scope company)
 *   - item.raw_material_categories     : KULIT, SOL, AKSESORIS, BENANG, PEREKAT, WIP
 *   - item.raw_materials               : 25 bahan baku alas kaki + bahan setengah jadi (WIP)
 *   - item.raw_material_unit_conversions : satuan beli (LUSIN/ROLL/CAN/BOX/PACK) → satuan stok
 *   - item.product_categories          : SANDAL, SEPATU, WIP (global)
 *   - item.products                    : 9 produk jadi + 2 produk WIP (upper) @ gudang MAIN
 *   - manufacturing.bom_items          : resep produk (termasuk resep bertingkat: sepatu memakai upper WIP)
 *   - manufacturing.raw_material_bom_items : resep bahan setengah jadi (campuran lem sol)
 *   - inventory.inventory (+movement)  : stok awal bahan baku di gudang MAIN
 *   - inventory.finished_goods_inventory : stok awal produk jadi
 *   - manufacturing.production_orders  : 7 contoh produksi (COMPLETED / IN_PROGRESS / RELEASED / DRAFT)
 *     lengkap dengan konsumsi bahan, mutasi stok, batch, dan HPP — meniru persis
 *     alur API /api/purchasing/production/orders.
 *   - pos.pos_products                 : sinkron produk jadi ke POS (sku PUR-<kode>)
 *
 * CATATAN SATUAN: mesin produksi aplikasi mengurangi stok memakai qty BOM apa
 * adanya (tanpa konversi satuan). Karena itu satuan STOK = satuan RESEP
 * (satuan_besar = satuan_kecil, konversi 1): sol per PASANG, lem per GR, kulit
 * per M²/M, dst. Satuan pembelian (LUSIN, ROLL, CAN, …) dicatat sebagai konversi
 * di raw_material_unit_conversions.
 *
 * Usage:
 *   npm run db:seed:items-footwear
 *   npm run db:seed:footwear-only   # sembunyikan data F&B dulu, lalu seed ini
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
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!shellKeys.has(k)) process.env[k] = v;
    }
  }
}

const WAREHOUSE_CODE = "MAIN";
const STATION = "merchandise";
const DEMO_PREFIX = "PROD-DEMO";

// ── Satuan tambahan (scope company) ─────────────────────────────────────────
const UNITS = [
  ["PASANG", "Pasang", "KECIL", "Sepasang alas kaki (kiri + kanan)"],
  ["LUSIN", "Lusin", "BESAR", "12 pasang / 12 pcs"],
  ["M", "Meter", "KECIL", "Panjang bahan gulungan (kain, kulit sintetis, tali)"],
  ["M2", "Meter Persegi", "KECIL", "Luas lembaran kulit"],
];

// ── Kategori bahan baku (scope company) ─────────────────────────────────────
const RM_CATEGORIES = [
  ["KULIT", "Kulit & Bahan Atas", "Kulit asli/sintetis, suede, kanvas, mesh untuk upper"],
  ["SOL", "Sol & Alas Kaki", "Outsole, midsole, insole"],
  ["AKSESORIS", "Aksesoris & Pengikat", "Tali, eyelet, gesper, velcro, ring"],
  ["BENANG", "Benang & Jahit", "Benang nilon / wax untuk jahit upper"],
  ["PEREKAT", "Lem & Kimia Sepatu", "Lem kuning, lem PU, primer sol"],
  ["WIP", "Bahan Setengah Jadi (WIP)", "Upper jahit, campuran lem — hasil produksi internal"],
];

// ── Bahan baku ──────────────────────────────────────────────────────────────
// [kode, nama, kategori, satuanStok, hargaPerSatuanStok, stokAwal, stokMin, stokMax,
//  shelfLifeDays, storage, deskripsi, satuanBeli, isiPerSatuanBeli]
const MATERIALS = [
  // Kulit & bahan atas (stok per M² / M)
  ["BB-KUL-001", "Kulit Sapi Nappa", "KULIT", "M2", 225000, 40, 10, 80, null, "SUHU_RUANG", "Kulit sapi nappa grade A — beli per lembar ±2 m²", "LBR", 2],
  ["BB-KUL-002", "Kulit Sintetis PU", "KULIT", "M", 20000, 240, 60, 600, 720, "SUHU_RUANG", "PU leather lebar 1,4 m — beli per roll 30 m", "ROLL", 30],
  ["BB-KUL-003", "Kulit Suede", "KULIT", "M2", 253333, 22, 6, 45, null, "SUHU_RUANG", "Suede sapi — beli per lembar ±1,5 m²", "LBR", 1.5],
  ["BB-KUL-004", "Kanvas 12oz", "KULIT", "M", 18000, 300, 100, 750, 1080, "SUHU_RUANG", "Kanvas katun 12oz lebar 1,5 m — beli per roll 50 m", "ROLL", 50],
  ["BB-KUL-005", "Mesh Sport Breathable", "KULIT", "M", 17500, 200, 80, 600, 1080, "SUHU_RUANG", "Mesh poliester sepatu lari — beli per roll 40 m", "ROLL", 40],
  // Sol & alas (stok per PASANG)
  ["BB-SOL-001", "Sol Karet Sandal", "SOL", "PASANG", 20000, 360, 120, 1200, null, "SUHU_RUANG", "Outsole karet sandal jepit/slide — beli per lusin", "LUSIN", 12],
  ["BB-SOL-002", "Sol EVA Sandal Slide", "SOL", "PASANG", 25000, 240, 120, 960, null, "SUHU_RUANG", "Sol EVA ringan untuk slide — beli per lusin", "LUSIN", 12],
  ["BB-SOL-003", "Outsole Rubber Sneaker", "SOL", "PASANG", 35000, 180, 96, 720, null, "SUHU_RUANG", "Outsole karet vulkanisir sneaker — beli per lusin", "LUSIN", 12],
  ["BB-SOL-004", "Insole Busa Latex", "SOL", "PASANG", 10000, 300, 120, 1200, null, "SUHU_RUANG", "Insole busa latex + kain — beli per lusin", "LUSIN", 12],
  ["BB-SOL-005", "Midsole Phylon", "SOL", "PASANG", 30000, 120, 60, 600, null, "SUHU_RUANG", "Midsole phylon sepatu lari — beli per lusin", "LUSIN", 12],
  ["BB-SOL-006", "Sol Kulit Pantofel", "SOL", "PASANG", 65000, 72, 36, 360, null, "SUHU_RUANG", "Sol kulit + hak karet pantofel — beli per lusin", "LUSIN", 12],
  // Aksesoris & pengikat
  ["BB-AKS-001", "Tali Sepatu 120cm", "AKSESORIS", "PASANG", 3000, 500, 250, 2000, null, "SUHU_RUANG", "Tali sepatu pipih 120 cm — beli per pack 50 pasang", "PACK", 50],
  ["BB-AKS-002", "Eyelet Kuningan 4mm", "AKSESORIS", "PCS", 90, 8000, 3000, 20000, null, "SUHU_RUANG", "Eyelet kuningan — beli per box 1.000 pcs", "BOX", 1000],
  ["BB-AKS-003", "Gesper Sandal Logam", "AKSESORIS", "PCS", 2500, 600, 300, 2000, null, "SUHU_RUANG", "Gesper logam 25 mm — beli per box 100 pcs", "BOX", 100],
  ["BB-AKS-004", "Velcro 25mm", "AKSESORIS", "M", 2400, 250, 75, 500, null, "SUHU_RUANG", "Velcro hook & loop 25 mm — beli per roll 25 m", "ROLL", 25],
  ["BB-AKS-005", "Ring D Logam", "AKSESORIS", "PCS", 150, 2500, 1000, 7500, null, "SUHU_RUANG", "Ring D 20 mm — beli per box 500 pcs", "BOX", 500],
  // Benang
  ["BB-BNG-001", "Benang Nilon 210D", "BENANG", "M", 35, 20000, 5000, 40000, null, "SUHU_RUANG", "Benang nilon jahit upper — beli per roll 1.000 m", "ROLL", 1000],
  ["BB-BNG-002", "Benang Wax Kulit", "BENANG", "M", 90, 6000, 2500, 15000, null, "SUHU_RUANG", "Benang poliester wax untuk kulit — beli per roll 500 m", "ROLL", 500],
  // Lem & kimia
  ["BB-LEM-001", "Lem Kuning (Contact Adhesive)", "PEREKAT", "GR", 85, 15000, 5000, 40000, 365, "KHUSUS", "Lem kuning — beli per kaleng 1 kg", "CAN", 1000],
  ["BB-LEM-002", "Primer Sol", "PEREKAT", "ML", 130, 4000, 1500, 10000, 365, "KHUSUS", "Primer perekat sol — beli per botol 500 ml", "BTL", 500],
  ["BB-LEM-003", "Lem PU Sol", "PEREKAT", "GR", 110, 10000, 5000, 40000, 365, "KHUSUS", "Lem PU pengikat outsole — beli per kaleng 1 kg", "CAN", 1000],
  // Kemasan (kategori KEMASAN sudah ada dari seed F&B)
  ["BB-KEM-101", "Dus Sepatu", "KEMASAN", "PCS", 3000, 300, 100, 800, null, "SUHU_RUANG", "Dus sepatu karton — beli per pack 20 pcs", "PACK", 20],
  ["BB-KEM-102", "Kertas Tisu Pembungkus", "KEMASAN", "LBR", 250, 1000, 500, 4000, null, "SUHU_RUANG", "Tissue paper pembungkus — beli per pack 100 lembar", "PACK", 100],
  ["BB-KEM-103", "Hangtag & Label Ukuran", "KEMASAN", "PCS", 300, 1000, 500, 4000, null, "SUHU_RUANG", "Hangtag + stiker ukuran — beli per pack 100 set", "PACK", 100],
  // Bahan setengah jadi yang diproduksi dari bahan lain (resep bahan)
  ["BB-WIP-LEM", "Campuran Lem Sol Siap Pakai", "WIP", "GR", 0, 0, 500, 5000, 30, "KHUSUS", "Lem PU + primer dicampur sebelum pemasangan sol — diproduksi internal", null, null],
];

// Resep bahan setengah jadi: output (per 1 satuan stok) ← komponen [kode, qty, waste]
// 1.000 GR campuran = 800 GR Lem PU + 200 ML Primer → per GR: 0,8 GR + 0,2 ML
const RAW_MATERIAL_RECIPES = [
  { output: "BB-WIP-LEM", components: [["BB-LEM-003", 0.8, 0], ["BB-LEM-002", 0.2, 0.02]] },
];

// ── Kategori produk (global) ────────────────────────────────────────────────
const PRODUCT_CATEGORIES = [
  ["SANDAL", "Sandal", "Sandal jepit, slide, gunung, kulit"],
  ["SEPATU", "Sepatu", "Sneaker, sepatu lari, pantofel, boots"],
  ["WIP", "Setengah Jadi", "Komponen produksi internal (upper jahit)"],
];

// ── Produk WIP (upper) — output produksi masuk stok bahan (raw_materials WIP) ──
const WIP_PRODUCTS = [
  {
    kode: "WIP-UPPER-KANVAS", nama: "Upper Sneaker Kanvas (jahit)", kategori: "WIP",
    biaya_produksi: 12000, deskripsi: "Upper kanvas sudah dijahit + eyelet, siap dirakit dengan sol",
    components: [["BB-KUL-004", 0.45, 0.05], ["BB-BNG-001", 12, 0], ["BB-AKS-002", 12, 0.02]],
  },
  {
    kode: "WIP-UPPER-KULIT", nama: "Upper Pantofel Kulit (jahit)", kategori: "WIP",
    biaya_produksi: 30000, deskripsi: "Upper kulit nappa full grain sudah dijahit, siap lasting",
    components: [["BB-KUL-001", 0.3, 0.1], ["BB-BNG-002", 10, 0], ["BB-AKS-002", 8, 0.02]],
  },
];

// ── Produk jadi + BOM ───────────────────────────────────────────────────────
// components: [kodeBahan | "WIP:<kodeProdukWIP>", qty dalam satuan stok, waste(0–1)]
const PRODUCTS = [
  {
    kode: "SND-001", nama: "Sandal Jepit Karet Classic", kategori: "SANDAL", pos_category: "Sandal",
    jual: 45000, biaya_produksi: 6000, stok_awal: 60,
    deskripsi: "Sandal jepit karet, tali PU, ukuran 38–43",
    components: [["BB-SOL-001", 1, 0.02], ["BB-KUL-002", 0.15, 0.05], ["BB-LEM-001", 15, 0], ["BB-KEM-103", 1, 0]],
  },
  {
    kode: "SND-002", nama: "Sandal Slide EVA Logo", kategori: "SANDAL", pos_category: "Sandal",
    jual: 85000, biaya_produksi: 9000, stok_awal: 48,
    deskripsi: "Sandal slide EVA dengan strap PU berlogo",
    components: [["BB-SOL-002", 1, 0.02], ["BB-KUL-002", 0.25, 0.05], ["BB-LEM-001", 20, 0], ["BB-BNG-001", 2, 0], ["BB-KEM-103", 1, 0]],
  },
  {
    kode: "SND-003", nama: "Sandal Gunung Strap Velcro", kategori: "SANDAL", pos_category: "Sandal",
    jual: 145000, biaya_produksi: 15000, stok_awal: 30,
    deskripsi: "Sandal gunung sol EVA, strap velcro & ring D",
    components: [["BB-SOL-002", 1, 0.02], ["BB-KUL-004", 0.3, 0.05], ["BB-AKS-004", 0.6, 0.03], ["BB-AKS-005", 4, 0], ["BB-BNG-001", 6, 0], ["BB-LEM-001", 25, 0], ["BB-KEM-103", 1, 0]],
  },
  {
    kode: "SND-004", nama: "Sandal Kulit Pria Casual", kategori: "SANDAL", pos_category: "Sandal",
    jual: 225000, biaya_produksi: 22000, stok_awal: 24,
    deskripsi: "Sandal kulit sapi nappa, gesper logam, sol karet",
    components: [["BB-SOL-001", 1, 0.02], ["BB-KUL-001", 0.12, 0.08], ["BB-SOL-004", 1, 0], ["BB-AKS-003", 1, 0], ["BB-BNG-002", 4, 0], ["BB-WIP-LEM", 20, 0], ["BB-KEM-101", 1, 0], ["BB-KEM-103", 1, 0]],
  },
  {
    kode: "SPT-001", nama: "Sepatu Sneaker Kanvas Low", kategori: "SEPATU", pos_category: "Sepatu",
    jual: 275000, biaya_produksi: 16000, stok_awal: 36,
    deskripsi: "Sneaker kanvas low-cut, sol karet vulkanisir (resep bertingkat: upper WIP)",
    components: [["WIP:WIP-UPPER-KANVAS", 1, 0], ["BB-SOL-003", 1, 0.02], ["BB-SOL-004", 1, 0], ["BB-AKS-001", 1, 0], ["BB-WIP-LEM", 30, 0], ["BB-KEM-101", 1, 0], ["BB-KEM-102", 2, 0], ["BB-KEM-103", 1, 0]],
  },
  {
    kode: "SPT-002", nama: "Sepatu Sneaker Kulit Sintetis", kategori: "SEPATU", pos_category: "Sepatu",
    jual: 320000, biaya_produksi: 30000, stok_awal: 30,
    deskripsi: "Sneaker upper PU leather, midsole phylon",
    components: [["BB-SOL-003", 1, 0.02], ["BB-SOL-005", 1, 0.02], ["BB-KUL-002", 0.5, 0.05], ["BB-SOL-004", 1, 0], ["BB-AKS-001", 1, 0], ["BB-AKS-002", 12, 0.02], ["BB-BNG-001", 14, 0], ["BB-WIP-LEM", 35, 0], ["BB-KEM-101", 1, 0], ["BB-KEM-102", 2, 0], ["BB-KEM-103", 1, 0]],
  },
  {
    kode: "SPT-003", nama: "Sepatu Lari Mesh Phylon", kategori: "SEPATU", pos_category: "Sepatu",
    jual: 395000, biaya_produksi: 35000, stok_awal: 24,
    deskripsi: "Sepatu lari upper mesh breathable, midsole phylon, outsole rubber",
    components: [["BB-SOL-003", 1, 0.02], ["BB-SOL-005", 1, 0.02], ["BB-KUL-005", 0.4, 0.05], ["BB-KUL-002", 0.1, 0.05], ["BB-SOL-004", 1, 0], ["BB-AKS-001", 1, 0], ["BB-AKS-002", 10, 0.02], ["BB-BNG-001", 16, 0], ["BB-WIP-LEM", 35, 0], ["BB-KEM-101", 1, 0], ["BB-KEM-102", 2, 0], ["BB-KEM-103", 1, 0]],
  },
  {
    kode: "SPT-004", nama: "Sepatu Pantofel Kulit Pria", kategori: "SEPATU", pos_category: "Sepatu",
    jual: 550000, biaya_produksi: 30000, stok_awal: 18,
    deskripsi: "Pantofel kulit sapi nappa full grain, sol kulit (resep bertingkat: upper WIP)",
    components: [["WIP:WIP-UPPER-KULIT", 1, 0], ["BB-SOL-006", 1, 0.02], ["BB-SOL-004", 1, 0], ["BB-AKS-001", 1, 0], ["BB-WIP-LEM", 40, 0], ["BB-KEM-101", 1, 0], ["BB-KEM-102", 2, 0], ["BB-KEM-103", 1, 0]],
  },
  {
    kode: "SPT-005", nama: "Sepatu Boots Suede", kategori: "SEPATU", pos_category: "Sepatu",
    jual: 620000, biaya_produksi: 65000, stok_awal: 12,
    deskripsi: "Boots suede mid-cut, sol karet, eyelet kuningan",
    components: [["BB-SOL-003", 1, 0.02], ["BB-KUL-003", 0.45, 0.1], ["BB-SOL-004", 1, 0], ["BB-AKS-001", 1, 0], ["BB-AKS-002", 16, 0.02], ["BB-BNG-002", 14, 0], ["BB-WIP-LEM", 45, 0], ["BB-KEM-101", 1, 0], ["BB-KEM-102", 2, 0], ["BB-KEM-103", 1, 0]],
  },
];

// ── Contoh produksi ─────────────────────────────────────────────────────────
// context 'raw_material' → output bahan (campuran lem); 'wip' → produk WIP (output ke stok bahan);
// 'product' → produk jadi. Urutan penting: lem & upper diproduksi dulu sebelum sepatu.
const DEMO_ORDERS = [
  { no: 1, context: "raw_material", ref: "BB-WIP-LEM", qty: 2000, status: "COMPLETED", labor: 20000, overhead: 5000, days_ago: 9, catatan: "Campuran lem untuk produksi minggu ini" },
  { no: 2, context: "wip", ref: "WIP-UPPER-KANVAS", qty: 30, status: "COMPLETED", labor: 180000, overhead: 40000, days_ago: 7, catatan: "Upper kanvas batch pertama" },
  { no: 3, context: "product", ref: "SPT-001", qty: 20, status: "COMPLETED", labor: 240000, overhead: 60000, packaging: 20000, days_ago: 5, catatan: "Perakitan sneaker kanvas dari upper WIP" },
  { no: 4, context: "product", ref: "SND-002", qty: 50, status: "COMPLETED", labor: 300000, overhead: 100000, packaging: 25000, waste: 15000, days_ago: 3, catatan: "Sandal slide untuk stok toko" },
  { no: 5, context: "product", ref: "SPT-003", qty: 15, status: "IN_PROGRESS", labor: 260000, overhead: 60000, packaging: 15000, days_ago: 1, catatan: "Sedang dikerjakan — lasting & pengeleman" },
  { no: 6, context: "product", ref: "SND-004", qty: 12, status: "RELEASED", labor: 180000, overhead: 40000, packaging: 12000, days_ago: 0, catatan: "Dirilis, menunggu jadwal tukang" },
  { no: 7, context: "wip", ref: "WIP-UPPER-KULIT", qty: 18, status: "DRAFT", labor: 270000, overhead: 45000, days_ago: 0, catatan: "Rencana upper pantofel" },
];

/* ───────────────────────────── helpers ───────────────────────────── */

const ceil100 = (n) => Math.ceil(n / 100) * 100;
const daysAgo = (d) => new Date(Date.now() - d * 86400000);

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

    // Konversi satuan beli → satuan stok (mis. 1 LUSIN = 12 PASANG)
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
async function ensureWipMaterial(c, scope, product, unitId, modal) {
  const kode = `WP${product.kode.replace(/[^A-Za-z0-9]/g, "").slice(0, 17)}`.slice(0, 20).toUpperCase();
  const { rows } = await c.query(RM_UPSERT, [
    kode, product.nama, "WIP", `Hasil produksi ${product.kode} — stok bahan setengah jadi`,
    unitId, 5, 200, null, "SUHU_RUANG", modal, "WIP", product.id, scope.company_id, scope.branch_id,
  ]);
  return { ...rows[0], stokAwal: 0, harga: modal, satuan: "PASANG", unitId, isWip: true };
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
     VALUES ($1, $2, 0, 0, 0, $3, 'RAK-FW', 'Stok seed footwear', true, $4, $5, NOW())
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
       WHERE raw_material_id = $1 AND (reference_type = 'seed_footwear' OR reference_number LIKE $2)`,
      [m.id, `${DEMO_PREFIX}-%`]
    );
    if (m.stokAwal > 0) {
      await c.query(
        `INSERT INTO inventory.inventory_movements
           (inventory_id, raw_material_id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost,
            reference_type, reference_number, alasan, is_active, branch_id, warehouse_id)
         VALUES ($1, $2, 'in', $3::numeric, 0, $3::numeric, $4::numeric, $3::numeric * $4::numeric,
                 'seed_footwear', 'SEED-FW', 'Stok awal seed sandal & sepatu', true, $5, $6)`,
        [inventoryId, m.id, m.stokAwal, m.harga, scope.branch_id, warehouseId]
      );
    }
    count += 1;
  }
  return count;
}

async function upsertPosProduct(c, product, p) {
  const sku = `PUR-${product.kode}`;
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

/* ───────────────────── contoh produksi (meniru API) ───────────────────── */

async function resetDemoOrders(c) {
  const { rows } = await c.query(
    `SELECT id FROM manufacturing.production_orders WHERE nomor_produksi LIKE $1`, [`${DEMO_PREFIX}-%`]
  );
  const ids = rows.map((r) => r.id);
  await c.query(`DELETE FROM inventory.finished_goods_movements WHERE reference_number LIKE $1`, [`${DEMO_PREFIX}-%`]);
  if (ids.length === 0) return 0;
  await c.query(`DELETE FROM manufacturing.production_batches WHERE production_order_id = ANY($1::uuid[])`, [ids]);
  await c.query(`DELETE FROM manufacturing.production_order_materials WHERE production_order_id = ANY($1::uuid[])`, [ids]);
  await c.query(`DELETE FROM manufacturing.production_orders WHERE id = ANY($1::uuid[])`, [ids]);
  return ids.length;
}

/** Komponen dari BOM produk / resep bahan (kolom diseragamkan: raw_material_id). */
async function loadComponents(c, target) {
  const { rows } = await c.query(
    target.kind === "raw_material"
      ? `SELECT component_raw_material_id AS raw_material_id, qty_required, waste_factor, satuan_id
         FROM manufacturing.raw_material_bom_items WHERE output_raw_material_id = $1 AND is_active`
      : `SELECT raw_material_id, qty_required, waste_factor, satuan_id
         FROM manufacturing.bom_items WHERE product_id = $1 AND is_active`,
    [target.id]
  );
  return rows;
}

async function createDemoOrder(c, scope, warehouseId, spec, targets, materialById) {
  const nomor = `${DEMO_PREFIX}-${String(spec.no).padStart(4, "0")}`;
  const target = targets[spec.ref];
  if (!target) throw new Error(`Target produksi ${spec.ref} tidak ditemukan`);
  const components = await loadComponents(c, target);
  if (components.length === 0) throw new Error(`${spec.ref} belum punya resep/BOM`);

  const materials = components.map((cmp) => {
    const m = materialById.get(cmp.raw_material_id);
    const qtyPlanned = Number(cmp.qty_required) * (1 + Number(cmp.waste_factor || 0)) * spec.qty;
    const unitCost = m ? m.harga : 0;
    return { raw_material_id: cmp.raw_material_id, satuan_id: cmp.satuan_id,
             qty_planned: qtyPlanned, qty_actual: qtyPlanned, unit_cost: unitCost,
             total_cost: qtyPlanned * unitCost };
  });
  const plannedMaterialCost = materials.reduce((s, x) => s + x.total_cost, 0);
  const overhead = spec.overhead || 0, labor = spec.labor || 0, packaging = spec.packaging || 0, waste = spec.waste || 0;
  const totalCost = plannedMaterialCost + overhead + labor + packaging + waste;
  const hpp = totalCost / spec.qty;
  const completed = spec.status === "COMPLETED";
  const started = completed || spec.status === "IN_PROGRESS";
  const at = daysAgo(spec.days_ago);
  const isRaw = target.kind === "raw_material";

  const { rows: ord } = await c.query(
    `INSERT INTO manufacturing.production_orders
       (nomor_produksi, product_id, output_raw_material_id, production_context, output_type,
        company_id, branch_id, planned_qty, actual_qty, status, planned_material_cost,
        actual_material_cost, overhead_cost, labor_cost, packaging_cost, waste_cost, hpp_per_unit,
        catatan, started_at, completed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $21)
     RETURNING id`,
    [nomor, isRaw ? null : target.id, isRaw ? target.id : null, isRaw ? "raw_material" : "product", target.outputType,
     scope.company_id, scope.branch_id, spec.qty, completed ? spec.qty : 0, spec.status,
     plannedMaterialCost, completed ? plannedMaterialCost : 0, overhead, labor, packaging, waste, hpp,
     spec.catatan, started ? at : null, completed ? at : null, daysAgo(spec.days_ago + 1)]
  );
  const orderId = ord[0].id;

  for (const mat of materials) {
    let movementId = null;
    if (completed) {
      // Konsumsi bahan: mutasi 'out' + kurangi stok — persis alur complete di API.
      const m = materialById.get(mat.raw_material_id);
      const { rows: inv } = await c.query(`SELECT qty_available FROM inventory.inventory WHERE id = $1`, [m.inventoryId]);
      const before = Number(inv[0].qty_available);
      const after = before - mat.qty_actual;
      if (after < 0) throw new Error(`Stok ${m.kode} tidak cukup untuk ${nomor} (sisa ${before}, butuh ${mat.qty_actual})`);
      const { rows: mv } = await c.query(
        `INSERT INTO inventory.inventory_movements
           (inventory_id, raw_material_id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost,
            branch_id, warehouse_id, reference_type, reference_id, reference_number, alasan, is_active, created_at)
         VALUES ($1, $2, 'out', $3, $4, $5, $6, $7, $8, $9, 'production', $10, $11, $12, true, $13)
         RETURNING id`,
        [m.inventoryId, mat.raw_material_id, mat.qty_actual, before, after, mat.unit_cost, mat.total_cost,
         scope.branch_id, warehouseId, orderId, nomor, `Pemakaian bahan untuk produksi ${nomor}`, at]
      );
      movementId = mv[0].id;
      await c.query(`UPDATE inventory.inventory SET qty_available = $2, last_movement_at = $3, updated_at = NOW() WHERE id = $1`,
        [m.inventoryId, after, at]);
    }
    await c.query(
      `INSERT INTO manufacturing.production_order_materials
         (production_order_id, raw_material_id, satuan_id, qty_planned, qty_actual, waste_qty, unit_cost, total_cost, inventory_movement_id)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)`,
      [orderId, mat.raw_material_id, mat.satuan_id, mat.qty_planned, mat.qty_actual, mat.unit_cost, mat.total_cost, movementId]
    );
  }

  if (completed) {
    await c.query(
      `INSERT INTO manufacturing.production_batches
         (production_order_id, product_id, output_raw_material_id, output_type, wip_raw_material_id,
          batch_number, qty_produced, hpp_per_unit, total_cost, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'AVAILABLE', $10)`,
      [orderId, isRaw ? null : target.id, isRaw ? target.id : null, target.outputType,
       target.kind === "wip" ? target.wipMaterialId : null, `${nomor}-B01`, spec.qty, hpp, totalCost, at]
    );

    if (target.kind === "product") {
      // Produk jadi masuk stok FG dengan HPP rata-rata tertimbang + mutasi FG.
      const { rows: fg } = await c.query(`SELECT id, qty_available, unit_cost FROM inventory.finished_goods_inventory WHERE product_id = $1`, [target.id]);
      const before = fg[0] ? Number(fg[0].qty_available) : 0;
      const after = before + spec.qty;
      const avgCost = after > 0 ? (before * (fg[0] ? Number(fg[0].unit_cost) : 0) + totalCost) / after : hpp;
      let fgId = fg[0]?.id;
      if (fgId) {
        await c.query(`UPDATE inventory.finished_goods_inventory SET qty_available = $2, unit_cost = $3, last_movement_at = $4, updated_at = NOW() WHERE id = $1`, [fgId, after, avgCost, at]);
      } else {
        fgId = (await c.query(`INSERT INTO inventory.finished_goods_inventory (product_id, qty_available, unit_cost, last_movement_at, is_active) VALUES ($1, $2, $3, $4, true) RETURNING id`, [target.id, after, avgCost, at])).rows[0].id;
      }
      await c.query(
        `INSERT INTO inventory.finished_goods_movements
           (inventory_id, product_id, warehouse_id, branch_id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost,
            reference_type, reference_id, reference_number, alasan, is_active, created_at)
         VALUES ($1, $2, $3, $4, 'in', $5, $6, $7, $8, $9, 'production_order', $10, $11, 'Production completed', true, $12)`,
        [fgId, target.id, warehouseId, scope.branch_id, spec.qty, before, after, avgCost, spec.qty * avgCost, orderId, nomor, at]
      );
    } else {
      // Output WIP / bahan: masuk stok bahan dengan biaya = HPP (rata-rata tertimbang).
      const outMat = target.kind === "wip" ? materialById.get(target.wipMaterialId) : materialById.get(target.id);
      const { rows: inv } = await c.query(`SELECT qty_available, unit_cost FROM inventory.inventory WHERE id = $1`, [outMat.inventoryId]);
      const before = Number(inv[0].qty_available);
      const after = before + spec.qty;
      const avgCost = after > 0 ? (before * Number(inv[0].unit_cost) + totalCost) / after : hpp;
      await c.query(`UPDATE inventory.inventory SET qty_available = $2, unit_cost = $3, last_movement_at = $4, updated_at = NOW() WHERE id = $1`,
        [outMat.inventoryId, after, avgCost, at]);
      outMat.harga = avgCost; // produksi berikutnya memakai biaya terbaru
      await c.query(
        `INSERT INTO inventory.inventory_movements
           (inventory_id, raw_material_id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost,
            branch_id, warehouse_id, reference_type, reference_id, reference_number, alasan, is_active, created_at)
         VALUES ($1, $2, 'in', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, $14)`,
        [outMat.inventoryId, outMat.id, spec.qty, before, after, hpp, totalCost, scope.branch_id, warehouseId,
         isRaw ? "production_output" : "production_wip", orderId, nomor, `Hasil produksi ${nomor}`, at]
      );
    }
  }
  return { nomor, hpp, totalCost, plannedMaterialCost };
}

/* ─────────────────────────────── main ─────────────────────────────── */

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
    console.log(`Scope: ${scope.company_name} / ${scope.branch_name}`);

    await upsertUnits(c, scope);
    const unitMap = await loadUnitMap(c, scope.company_id);
    const uid = (code) => {
      const id = unitMap.get(code);
      if (!id) throw new Error(`Unit "${code}" tidak ditemukan — jalankan npm run db:seed:items-units dulu`);
      return id;
    };
    await upsertRmCategories(c, scope);
    await upsertProductCategories(c);

    const { rows: wh } = await c.query(
      `SELECT id FROM configuration.warehouses WHERE branch_id = $1 AND code = $2 AND is_active = true`,
      [scope.branch_id, WAREHOUSE_CODE]
    );
    if (!wh[0]) throw new Error(`Gudang ${WAREHOUSE_CODE} tidak ditemukan di ${scope.branch_name}`);
    const warehouseId = wh[0].id;

    // 1. Bahan baku + konversi satuan beli
    const materialMap = await upsertMaterials(c, scope, uid);
    console.log(`✓ Bahan baku: ${materialMap.size} item (satuan stok = satuan resep; konversi beli tercatat)`);

    // 2. Resep bahan setengah jadi (raw_material_bom_items)
    for (const r of RAW_MATERIAL_RECIPES) {
      const out = materialMap.get(r.output);
      await c.query(`DELETE FROM manufacturing.raw_material_bom_items WHERE output_raw_material_id = $1`, [out.id]);
      let cost = 0;
      for (const [kode, qty, waste] of r.components) {
        const m = materialMap.get(kode);
        await c.query(
          `INSERT INTO manufacturing.raw_material_bom_items (output_raw_material_id, component_raw_material_id, qty_required, satuan_id, waste_factor, is_active)
           VALUES ($1, $2, $3, $4, $5, true)`,
          [out.id, m.id, qty, m.unitId, waste || 0]
        );
        cost += m.harga * qty * (1 + (waste || 0));
      }
      out.harga = Math.round(cost);
      await c.query(`UPDATE item.raw_materials SET harga_beli = $2 WHERE id = $1`, [out.id, out.harga]);
      console.log(`✓ Resep bahan: ${out.kode} ${out.nama} ← ${r.components.map(([k, q]) => `${q} ${materialMap.get(k).satuan} ${k}`).join(" + ")} → biaya Rp ${out.harga}/${out.satuan}`);
    }

    // 3. Produk WIP (upper) + BOM + bahan WIP hasilnya
    const targets = {};
    for (const p of WIP_PRODUCTS) {
      const bahan = p.components.reduce((s, [k, q, w]) => s + materialMap.get(k).harga * q * (1 + (w || 0)), 0);
      const modal = ceil100(bahan + p.biaya_produksi);
      const product = await upsertProduct(c, p, scope, uid("PASANG"), warehouseId, modal, "WIP");
      await replaceBom(c, product.id, p.components, materialMap);
      const wipMat = await ensureWipMaterial(c, scope, product, uid("PASANG"), modal);
      materialMap.set(`WIP:${p.kode}`, wipMat);
      targets[p.kode] = { kind: "wip", id: product.id, outputType: "WIP", wipMaterialId: wipMat.id };
      console.log(`✓ Produk WIP ${p.kode} ${p.nama} — HPP resep Rp ${modal.toLocaleString("id-ID")} → bahan ${wipMat.kode}`);
    }

    // 4. Stok awal semua bahan (WIP & campuran lem = 0, terisi dari contoh produksi)
    const stockCount = await seedRawStock(c, scope, warehouseId, materialMap);
    console.log(`✓ Stok awal bahan @ ${WAREHOUSE_CODE}: ${stockCount} baris`);

    // 5. Produk jadi + BOM (bisa memakai upper WIP) + stok awal + POS
    for (const p of PRODUCTS) {
      const bahan = p.components.reduce((s, [k, q, w]) => s + materialMap.get(k).harga * q * (1 + (w || 0)), 0);
      const modal = ceil100(bahan + p.biaya_produksi);
      const product = await upsertProduct(c, p, scope, uid("PASANG"), warehouseId, modal, "FINISHED_GOOD");
      await replaceBom(c, product.id, p.components, materialMap);
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
    for (const r of RAW_MATERIAL_RECIPES) {
      const out = materialMap.get(r.output);
      targets[r.output] = { kind: "raw_material", id: out.id, outputType: "WIP" };
    }

    // 6. Contoh produksi
    const materialById = new Map([...materialMap.values()].map((m) => [m.id, m]));
    const removed = await resetDemoOrders(c);
    if (removed) console.log(`↺ ${removed} contoh produksi lama dihapus`);
    for (const spec of DEMO_ORDERS) {
      const r = await createDemoOrder(c, scope, warehouseId, spec, targets, materialById);
      console.log(`  ✓ ${r.nomor} ${spec.status.padEnd(11)} ${spec.ref} × ${spec.qty} — bahan Rp ${Math.round(r.plannedMaterialCost).toLocaleString("id-ID")}, HPP/unit Rp ${Math.round(r.hpp).toLocaleString("id-ID")}`);
    }

    await c.query("COMMIT");
    console.log(`\nSelesai: ${materialMap.size} bahan (termasuk WIP), ${WIP_PRODUCTS.length} produk WIP, ${PRODUCTS.length} produk jadi, ${DEMO_ORDERS.length} contoh produksi.`);
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
