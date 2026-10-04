#!/usr/bin/env node
/**
 * Seeder demo F&B RESTAURANT (data lokal, permintaan owner 2026-09-06):
 * bahan baku → WIP (kaldu, saus, isian, katsu) → produk jadi menu Jepang
 * sesuai stall yang ada (Ramen, Rice Bowl, Yakitori, Gyoza, Sushi, Sando,
 * Agemono, Yokoco Beverage).
 *
 * Mengisi (idempoten, satu transaksi, HANYA database lokal):
 *   - item.raw_material_categories     : PROTEIN, SAYUR, BUMBU, KERING, DAIRY, MINUMAN (+ KEMASAN, WIP)
 *   - item.raw_materials               : 34 bahan baku + 4 bahan setengah jadi (resep bahan)
 *   - item.raw_material_unit_conversions : satuan beli (KG/L/TRAY/PACK/…) → satuan stok (GR/ML/BUTIR/LBR/PCS)
 *   - item.product_categories          : RAMEN, RICE-BOWL, YAKITORI, GYOZA, SUSHI, SANDO, AGEMONO, MINUMAN, WIP
 *   - item.products                    : 11 menu jadi @ gudang stall masing-masing + 2 produk WIP
 *   - manufacturing.bom_items          : resep menu (bertingkat: memakai kaldu/saus/katsu/isian WIP)
 *   - manufacturing.raw_material_bom_items : resep bahan setengah jadi (kaldu ramen, saus teriyaki, sirup gula, nasi sushi)
 *   - inventory.inventory (+movement)  : stok awal bahan di gudang MAIN
 *   - inventory.finished_goods_inventory : stok awal menu jadi
 *   - manufacturing.production_orders  : 10 contoh produksi (prep dapur COMPLETED / IN_PROGRESS / RELEASED / DRAFT)
 *   - pos.pos_products (+pos_categories Makanan/Minuman) : menu jadi tampil di kasir (sku PUR-<kode>)
 *
 * CATATAN SATUAN: seperti seeder sandal/sepatu — satuan STOK = satuan RESEP
 * (GR/ML/BUTIR/LBR/PCS, konversi 1); satuan beli dicatat di unit_conversions.
 *
 * Usage:  npm run db:seed:items-fnb-restaurant
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

const MAIN_WAREHOUSE = "MAIN";
const DEMO_PREFIX = "PROD-FNB";
const SEED_REF = "seed_fnb";

// ── Kategori bahan baku (scope company) ─────────────────────────────────────
const RM_CATEGORIES = [
  ["PROTEIN", "Daging & Seafood", "Ayam, sapi, salmon, udang, telur"],
  ["SAYUR", "Sayur & Rempah Segar", "Kol, daun bawang, bombay, jamur, jahe, bawang putih"],
  ["BUMBU", "Bumbu & Saus", "Shoyu, mirin, miso, minyak wijen, saus tonkatsu, cuka beras"],
  ["KERING", "Bahan Kering", "Beras, mie, tepung, panko, kulit gyoza, nori, wijen, gula, garam"],
  ["DAIRY", "Susu & Telur", "Susu UHT, telur ayam"],
  ["MINUMAN", "Bahan Minuman", "Kopi, matcha, teh hijau, sirup"],
  ["KEMASAN", "Kemasan & Disposable", "Mangkuk, cup, sumpit, tusuk sate"],
  ["WIP", "Bahan Setengah Jadi (WIP)", "Kaldu, saus, isian, katsu — hasil prep dapur"],
];

// ── Bahan baku ──────────────────────────────────────────────────────────────
// [kode, nama, kategori, satuanStok, hargaPerSatuanStok, stokAwal, stokMin, stokMax,
//  shelfLifeDays, storage, deskripsi, satuanBeli, isiPerSatuanBeli]
const MATERIALS = [
  // Protein (stok GR / BUTIR)
  ["FB-PRO-001", "Ayam Paha Fillet", "PROTEIN", "GR", 45, 25000, 5000, 60000, 3, "DINGIN", "Paha ayam tanpa tulang — beli per KG", "KG", 1000],
  ["FB-PRO-002", "Tulang & Karkas Ayam", "PROTEIN", "GR", 12, 20000, 5000, 40000, 3, "BEKU", "Untuk kaldu ramen — beli per KG", "KG", 1000],
  ["FB-PRO-003", "Daging Sapi Slice Teriyaki", "PROTEIN", "GR", 130, 12000, 3000, 30000, 5, "BEKU", "Sliced beef tipis — beli per KG", "KG", 1000],
  ["FB-PRO-004", "Salmon Fillet Sashimi Grade", "PROTEIN", "GR", 220, 6000, 2000, 15000, 2, "DINGIN", "Salmon Norwegia sashimi grade — beli per KG", "KG", 1000],
  ["FB-PRO-005", "Udang Vaname Kupas", "PROTEIN", "GR", 110, 8000, 2000, 20000, 5, "BEKU", "Udang kupas ukuran 31/40 — beli per KG", "KG", 1000],
  ["FB-PRO-006", "Telur Ayam", "DAIRY", "BUTIR", 2200, 600, 150, 1500, 21, "SUHU_RUANG", "Telur ayam negeri — beli per tray 30 butir", "TRAY", 30],
  // Sayur & rempah
  ["FB-SAY-001", "Kol / Kubis", "SAYUR", "GR", 8, 20000, 5000, 40000, 7, "DINGIN", "Kol putih — beli per KG", "KG", 1000],
  ["FB-SAY-002", "Daun Bawang", "SAYUR", "GR", 25, 5000, 1000, 10000, 5, "DINGIN", "Daun bawang segar — beli per KG", "KG", 1000],
  ["FB-SAY-003", "Bawang Bombay", "SAYUR", "GR", 22, 10000, 2000, 20000, 14, "SUHU_RUANG", "Bombay kuning — beli per KG", "KG", 1000],
  ["FB-SAY-004", "Jamur Enoki", "SAYUR", "GR", 40, 3000, 1000, 8000, 5, "DINGIN", "Enoki segar — beli per pack 200 gr", "PACK", 200],
  ["FB-SAY-005", "Jahe & Bawang Putih Cincang", "SAYUR", "GR", 30, 4000, 1000, 8000, 7, "DINGIN", "Campuran jahe + bawang putih cincang — beli per KG", "KG", 1000],
  // Bumbu & saus (ML / GR)
  ["FB-BMB-001", "Shoyu (Kecap Asin Jepang)", "BUMBU", "ML", 45, 12000, 3000, 24000, 365, "SUHU_RUANG", "Shoyu Kikkoman — beli per botol 1 L", "L", 1000],
  ["FB-BMB-002", "Mirin", "BUMBU", "ML", 60, 6000, 2000, 12000, 365, "SUHU_RUANG", "Mirin masak — beli per botol 1 L", "L", 1000],
  ["FB-BMB-003", "Miso Paste", "BUMBU", "GR", 70, 4000, 1000, 8000, 180, "DINGIN", "Miso putih — beli per pack 1 kg", "KG", 1000],
  ["FB-BMB-004", "Minyak Wijen", "BUMBU", "ML", 120, 3000, 1000, 6000, 365, "SUHU_RUANG", "Minyak wijen — beli per botol 500 ml", "BTL", 500],
  ["FB-BMB-005", "Saus Tonkatsu", "BUMBU", "ML", 55, 5000, 1500, 10000, 365, "SUHU_RUANG", "Saus tonkatsu Bulldog — beli per botol 500 ml", "BTL", 500],
  ["FB-BMB-006", "Cuka Beras", "BUMBU", "ML", 35, 4000, 1000, 8000, 365, "SUHU_RUANG", "Rice vinegar — beli per botol 1 L", "L", 1000],
  ["FB-BMB-007", "Minyak Goreng", "BUMBU", "ML", 18, 40000, 10000, 80000, 365, "SUHU_RUANG", "Minyak goreng — beli per jerigen 18 L", "GAL", 18000],
  // Bahan kering
  ["FB-KRG-001", "Beras Jepang (Koshihikari)", "KERING", "GR", 28, 100000, 25000, 200000, 365, "SUHU_RUANG", "Beras japonica — beli per karung 5 kg", "SACK", 5000],
  ["FB-KRG-002", "Mie Ramen Segar", "KERING", "GR", 30, 20000, 5000, 40000, 7, "DINGIN", "Mie ramen segar — beli per pack 1 kg", "PACK", 1000],
  ["FB-KRG-003", "Tepung Terigu", "KERING", "GR", 12, 25000, 5000, 50000, 365, "SUHU_RUANG", "Terigu protein sedang — beli per sak 25 kg", "SACK", 25000],
  ["FB-KRG-004", "Tepung Panko", "KERING", "GR", 40, 10000, 3000, 20000, 180, "SUHU_RUANG", "Panko Jepang — beli per pack 1 kg", "PACK", 1000],
  ["FB-KRG-005", "Kulit Gyoza", "KERING", "LBR", 350, 1500, 500, 4000, 14, "BEKU", "Kulit gyoza siap pakai — beli per pack 50 lembar", "PACK", 50],
  ["FB-KRG-006", "Nori Lembaran", "KERING", "LBR", 900, 500, 150, 1500, 180, "SUHU_RUANG", "Nori panggang — beli per pack 50 lembar", "PACK", 50],
  ["FB-KRG-007", "Wijen Sangrai", "KERING", "GR", 60, 3000, 1000, 6000, 180, "SUHU_RUANG", "Wijen putih sangrai — beli per pack 500 gr", "PACK", 500],
  ["FB-KRG-008", "Gula Pasir", "KERING", "GR", 16, 30000, 10000, 60000, 365, "SUHU_RUANG", "Gula pasir — beli per KG", "KG", 1000],
  ["FB-KRG-009", "Garam", "KERING", "GR", 6, 10000, 3000, 20000, 365, "SUHU_RUANG", "Garam halus — beli per KG", "KG", 1000],
  ["FB-KRG-010", "Roti Tawar Shokupan", "KERING", "LBR", 2500, 200, 60, 500, 3, "SUHU_RUANG", "Roti tawar Jepang tebal — beli per loaf 10 lembar", "PACK", 10],
  // Susu & minuman
  ["FB-DRY-001", "Susu UHT Full Cream", "DAIRY", "ML", 20, 30000, 10000, 60000, 90, "DINGIN", "Susu UHT — beli per liter", "L", 1000],
  ["FB-MIN-001", "Kopi Biji Arabica Roasted", "MINUMAN", "GR", 180, 5000, 1500, 10000, 60, "SUHU_RUANG", "Kopi arabica medium roast — beli per KG", "KG", 1000],
  ["FB-MIN-002", "Matcha Powder Ceremonial", "MINUMAN", "GR", 900, 1000, 300, 2500, 180, "DINGIN", "Matcha Uji — beli per pack 100 gr", "PACK", 100],
  ["FB-MIN-003", "Teh Hijau Sencha", "MINUMAN", "GR", 250, 2000, 500, 4000, 365, "SUHU_RUANG", "Daun teh sencha — beli per pack 250 gr", "PACK", 250],
  // Kemasan
  ["FB-KEM-001", "Mangkuk Kertas 750 ml + Tutup", "KEMASAN", "PCS", 1800, 1000, 300, 3000, null, "SUHU_RUANG", "Paper bowl take-away — beli per pack 50 pcs", "PACK", 50],
  ["FB-KEM-002", "Cup Plastik 16 oz + Tutup", "KEMASAN", "PCS", 900, 1500, 500, 4000, null, "SUHU_RUANG", "Cup minuman — beli per pack 50 pcs", "PACK", 50],
  ["FB-KEM-003", "Sumpit Sekali Pakai", "KEMASAN", "PCS", 250, 2000, 500, 5000, null, "SUHU_RUANG", "Sumpit bambu — beli per pack 100 pcs", "PACK", 100],
  ["FB-KEM-004", "Tusuk Sate Bambu 20 cm", "KEMASAN", "PCS", 120, 3000, 1000, 6000, null, "SUHU_RUANG", "Tusuk sate — beli per pack 250 pcs", "PACK", 250],
  // Bahan setengah jadi hasil resep bahan (stok awal 0 — terisi dari contoh produksi)
  ["FB-WIP-KALDU", "Kaldu Ayam Ramen (Tori Paitan)", "WIP", "ML", 0, 0, 3000, 30000, 2, "DINGIN", "Kaldu ayam pekat direbus 6 jam — prep dapur", null, null],
  ["FB-WIP-TERIYAKI", "Saus Teriyaki House Blend", "WIP", "ML", 0, 0, 1000, 10000, 14, "DINGIN", "Shoyu + mirin + gula dimasak — prep dapur", null, null],
  ["FB-WIP-SIRUP", "Sirup Gula Cair", "WIP", "ML", 0, 0, 1000, 10000, 30, "DINGIN", "Gula : air 1:1 — prep bar", null, null],
  ["FB-WIP-SUSHIRICE", "Nasi Sushi (Sumeshi)", "WIP", "GR", 0, 0, 2000, 15000, 1, "SUHU_RUANG", "Nasi Jepang + cuka sushi — prep dapur sushi", null, null],
];

// Resep bahan setengah jadi: per 1 satuan stok output ← komponen [kode, qty, waste]
const RAW_MATERIAL_RECIPES = [
  // 1.000 ML kaldu = 400 GR tulang + 20 GR jahe-bawang + 8 GR garam
  { output: "FB-WIP-KALDU", components: [["FB-PRO-002", 0.4, 0.05], ["FB-SAY-005", 0.02, 0], ["FB-KRG-009", 0.008, 0]] },
  // 1.000 ML teriyaki = 500 ML shoyu + 300 ML mirin + 150 GR gula + 30 GR jahe-bawang
  { output: "FB-WIP-TERIYAKI", components: [["FB-BMB-001", 0.5, 0], ["FB-BMB-002", 0.3, 0], ["FB-KRG-008", 0.15, 0], ["FB-SAY-005", 0.03, 0]] },
  // 1.000 ML sirup = 600 GR gula (+ air)
  { output: "FB-WIP-SIRUP", components: [["FB-KRG-008", 0.6, 0]] },
  // 1.000 GR nasi sushi = 450 GR beras + 60 ML cuka beras + 30 GR gula + 8 GR garam
  { output: "FB-WIP-SUSHIRICE", components: [["FB-KRG-001", 0.45, 0.02], ["FB-BMB-006", 0.06, 0], ["FB-KRG-008", 0.03, 0], ["FB-KRG-009", 0.008, 0]] },
];

// ── Kategori produk (global) ────────────────────────────────────────────────
const PRODUCT_CATEGORIES = [
  ["RAMEN", "Ramen & Mie", "Ramen, udon"],
  ["RICE-BOWL", "Rice Bowl", "Donburi / rice bowl"],
  ["YAKITORI", "Yakitori", "Sate ayam Jepang"],
  ["GYOZA", "Dumpling", "Gyoza & dumpling"],
  ["SUSHI", "Sushi & Sashimi", "Nigiri, roll, sashimi"],
  ["SANDO", "Sando", "Sandwich Jepang"],
  ["AGEMONO", "Agemono", "Gorengan Jepang (katsu, furai, tempura)"],
  ["MINUMAN", "Minuman", "Kopi, matcha, ocha"],
  ["WIP", "Setengah Jadi", "Komponen produksi internal"],
];

// ── Produk WIP — output masuk stok bahan (raw_materials WIP, kode WP<kode>) ──
const WIP_PRODUCTS = [
  {
    kode: "WIP-ISIAN-GYOZA", nama: "Isian Gyoza Ayam (adonan)", kategori: "WIP", satuan: "GR", stall: MAIN_WAREHOUSE, station: "kitchen",
    biaya_produksi: 5, deskripsi: "Ayam cincang + kol + daun bawang + bumbu, siap dibungkus (per GR)",
    components: [["FB-PRO-001", 0.55, 0.03], ["FB-SAY-001", 0.3, 0.1], ["FB-SAY-002", 0.08, 0.05], ["FB-SAY-005", 0.04, 0], ["FB-BMB-001", 0.03, 0], ["FB-BMB-004", 0.01, 0]],
  },
  {
    kode: "WIP-KATSU", nama: "Chicken Katsu Goreng (siap potong)", kategori: "WIP", satuan: "PCS", stall: MAIN_WAREHOUSE, station: "kitchen",
    biaya_produksi: 1500, deskripsi: "Paha ayam 130 gr dibalut terigu-telur-panko, digoreng — 1 pcs per porsi",
    components: [["FB-PRO-001", 130, 0.03], ["FB-KRG-003", 20, 0.05], ["FB-PRO-006", 0.5, 0], ["FB-KRG-004", 30, 0.05], ["FB-BMB-007", 40, 0], ["FB-KRG-009", 1, 0]],
  },
];

// ── Produk jadi + BOM ───────────────────────────────────────────────────────
// components: [kodeBahan | "WIP:<kodeProdukWIP>", qty (satuan stok), waste]
const PRODUCTS = [
  {
    kode: "MENU-RAMEN-001", nama: "Ramen Shoyu Ayam", kategori: "RAMEN", pos_category: "Makanan", stall: "STALL-10", station: "kitchen",
    jual: 45000, biaya_produksi: 2500, stok_awal: 20, deskripsi: "Mie ramen, kaldu tori paitan, chashu ayam, ajitama, nori",
    components: [["FB-KRG-002", 150, 0.02], ["FB-WIP-KALDU", 350, 0.05], ["FB-BMB-001", 30, 0], ["FB-PRO-001", 60, 0.03], ["FB-PRO-006", 1, 0], ["FB-SAY-002", 10, 0], ["FB-KRG-006", 1, 0], ["FB-KEM-001", 1, 0], ["FB-KEM-003", 1, 0]],
  },
  {
    kode: "MENU-RAMEN-002", nama: "Ramen Miso Sapi", kategori: "RAMEN", pos_category: "Makanan", stall: "STALL-10", station: "kitchen",
    jual: 52000, biaya_produksi: 2500, stok_awal: 15, deskripsi: "Kaldu miso, beef slice, enoki, daun bawang",
    components: [["FB-KRG-002", 150, 0.02], ["FB-WIP-KALDU", 350, 0.05], ["FB-BMB-003", 25, 0], ["FB-PRO-003", 60, 0.03], ["FB-SAY-004", 30, 0.05], ["FB-SAY-002", 10, 0], ["FB-KEM-001", 1, 0], ["FB-KEM-003", 1, 0]],
  },
  {
    kode: "MENU-RICE-001", nama: "Chicken Katsu Rice Bowl", kategori: "RICE-BOWL", pos_category: "Makanan", stall: "STALL-09", station: "kitchen",
    jual: 38000, biaya_produksi: 2000, stok_awal: 25, deskripsi: "Nasi Jepang, chicken katsu, saus tonkatsu, kol iris, wijen (resep bertingkat: katsu WIP)",
    components: [["FB-KRG-001", 150, 0.02], ["WIP:WIP-KATSU", 1, 0], ["FB-BMB-005", 25, 0], ["FB-SAY-001", 30, 0.1], ["FB-KRG-007", 2, 0], ["FB-KEM-001", 1, 0], ["FB-KEM-003", 1, 0]],
  },
  {
    kode: "MENU-RICE-002", nama: "Beef Teriyaki Don", kategori: "RICE-BOWL", pos_category: "Makanan", stall: "STALL-09", station: "kitchen",
    jual: 48000, biaya_produksi: 2000, stok_awal: 18, deskripsi: "Beef slice tumis bombay saus teriyaki house blend, telur onsen",
    components: [["FB-KRG-001", 150, 0.02], ["FB-PRO-003", 120, 0.03], ["FB-SAY-003", 40, 0.1], ["FB-WIP-TERIYAKI", 40, 0], ["FB-PRO-006", 1, 0], ["FB-KRG-007", 2, 0], ["FB-KEM-001", 1, 0], ["FB-KEM-003", 1, 0]],
  },
  {
    kode: "MENU-YAKI-001", nama: "Yakitori Negima (3 tusuk)", kategori: "YAKITORI", pos_category: "Makanan", stall: "STALL-02", station: "kitchen",
    jual: 27000, biaya_produksi: 1500, stok_awal: 30, deskripsi: "Sate ayam & daun bawang, olesan tare teriyaki, dibakar arang",
    components: [["FB-PRO-001", 90, 0.05], ["FB-SAY-002", 25, 0.1], ["FB-WIP-TERIYAKI", 25, 0], ["FB-KEM-004", 3, 0.05]],
  },
  {
    kode: "MENU-GYOZA-001", nama: "Gyoza Ayam (6 pcs)", kategori: "GYOZA", pos_category: "Makanan", stall: "STALL-04", station: "kitchen",
    jual: 28000, biaya_produksi: 1200, stok_awal: 30, deskripsi: "Gyoza pan-fried isi ayam-kol, saus shoyu-cuka (resep bertingkat: isian WIP)",
    components: [["FB-KRG-005", 6, 0.05], ["WIP:WIP-ISIAN-GYOZA", 90, 0.03], ["FB-BMB-007", 15, 0], ["FB-BMB-001", 10, 0], ["FB-BMB-006", 5, 0], ["FB-KEM-003", 1, 0]],
  },
  {
    kode: "MENU-SUSHI-001", nama: "Salmon Nigiri (4 pcs)", kategori: "SUSHI", pos_category: "Makanan", stall: "STALL-05", station: "kitchen",
    jual: 42000, biaya_produksi: 1500, stok_awal: 12, deskripsi: "Nigiri salmon sashimi grade di atas sumeshi (resep bertingkat: nasi sushi WIP)",
    components: [["FB-PRO-004", 80, 0.08], ["FB-WIP-SUSHIRICE", 100, 0.03], ["FB-KEM-003", 1, 0]],
  },
  {
    kode: "MENU-SANDO-001", nama: "Chicken Katsu Sando", kategori: "SANDO", pos_category: "Makanan", stall: "STALL-16", station: "kitchen",
    jual: 36000, biaya_produksi: 1500, stok_awal: 15, deskripsi: "Shokupan tebal, chicken katsu, kol iris, saus tonkatsu",
    components: [["FB-KRG-010", 2, 0.02], ["WIP:WIP-KATSU", 1, 0], ["FB-SAY-001", 25, 0.1], ["FB-BMB-005", 20, 0]],
  },
  {
    kode: "MENU-AGE-001", nama: "Ebi Furai (5 pcs)", kategori: "AGEMONO", pos_category: "Makanan", stall: "STALL-08", station: "kitchen",
    jual: 39000, biaya_produksi: 1800, stok_awal: 15, deskripsi: "Udang goreng tepung panko, saus tonkatsu",
    components: [["FB-PRO-005", 100, 0.05], ["FB-KRG-003", 15, 0.05], ["FB-PRO-006", 0.5, 0], ["FB-KRG-004", 25, 0.05], ["FB-BMB-007", 40, 0], ["FB-BMB-005", 20, 0], ["FB-SAY-001", 20, 0.1]],
  },
  {
    kode: "MENU-DRINK-001", nama: "Es Kopi Susu Gula Aren", kategori: "MINUMAN", pos_category: "Minuman", stall: "STALL-15", station: "bar",
    jual: 25000, biaya_produksi: 800, stok_awal: 40, deskripsi: "Espresso arabica, susu full cream, sirup gula (resep bertingkat: sirup WIP)",
    components: [["FB-MIN-001", 18, 0.03], ["FB-DRY-001", 120, 0], ["FB-WIP-SIRUP", 30, 0], ["FB-KEM-002", 1, 0]],
  },
  {
    kode: "MENU-DRINK-002", nama: "Iced Matcha Latte", kategori: "MINUMAN", pos_category: "Minuman", stall: "STALL-15", station: "bar",
    jual: 30000, biaya_produksi: 800, stok_awal: 30, deskripsi: "Matcha ceremonial, susu, sirup gula",
    components: [["FB-MIN-002", 4, 0.02], ["FB-DRY-001", 200, 0], ["FB-WIP-SIRUP", 20, 0], ["FB-KEM-002", 1, 0]],
  },
];

// ── Contoh produksi (prep dapur) ────────────────────────────────────────────
// Urutan penting: bahan WIP diproduksi dulu sebelum menu yang memakainya.
const DEMO_ORDERS = [
  { no: 1, context: "raw_material", ref: "FB-WIP-KALDU", qty: 20000, status: "COMPLETED", labor: 150000, overhead: 60000, days_ago: 6, catatan: "Rebus kaldu tori paitan 6 jam — 20 liter" },
  { no: 2, context: "raw_material", ref: "FB-WIP-TERIYAKI", qty: 5000, status: "COMPLETED", labor: 40000, overhead: 10000, days_ago: 6, catatan: "Saus teriyaki house blend 5 liter" },
  { no: 3, context: "raw_material", ref: "FB-WIP-SIRUP", qty: 5000, status: "COMPLETED", labor: 20000, overhead: 5000, days_ago: 5, catatan: "Sirup gula bar 5 liter" },
  { no: 4, context: "raw_material", ref: "FB-WIP-SUSHIRICE", qty: 6000, status: "COMPLETED", labor: 60000, overhead: 15000, days_ago: 2, catatan: "Sumeshi untuk shift siang" },
  { no: 5, context: "wip", ref: "WIP-ISIAN-GYOZA", qty: 5000, status: "COMPLETED", labor: 80000, overhead: 20000, days_ago: 4, catatan: "Adonan isian gyoza 5 kg" },
  { no: 6, context: "wip", ref: "WIP-KATSU", qty: 60, status: "COMPLETED", labor: 90000, overhead: 30000, days_ago: 3, catatan: "Katsu goreng 60 pcs untuk rice bowl & sando" },
  { no: 7, context: "product", ref: "MENU-GYOZA-001", qty: 30, status: "COMPLETED", labor: 60000, overhead: 15000, packaging: 9000, days_ago: 2, catatan: "Gyoza pan-fried batch siang" },
  { no: 8, context: "product", ref: "MENU-RAMEN-001", qty: 12, status: "IN_PROGRESS", labor: 40000, overhead: 12000, packaging: 6000, days_ago: 0, catatan: "Batch ramen jam makan siang" },
  { no: 9, context: "product", ref: "MENU-RICE-001", qty: 20, status: "RELEASED", labor: 50000, overhead: 15000, packaging: 10000, days_ago: 0, catatan: "Rice bowl untuk pre-order kantor" },
  { no: 10, context: "product", ref: "MENU-AGE-001", qty: 15, status: "DRAFT", labor: 40000, overhead: 10000, packaging: 5000, days_ago: 0, catatan: "Rencana ebi furai akhir pekan" },
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
     scope.company_id, scope.branch_id, warehouseId, outputType, p.station]
  );
  return rows[0];
}

/** Bahan WIP hasil produk WIP — meniru ensureWipRawMaterial di API (kode WP<kode>). */
async function ensureWipMaterial(c, scope, product, unitId, satuan, modal) {
  const kode = `WP${product.kode.replace(/[^A-Za-z0-9]/g, "").slice(0, 17)}`.slice(0, 20).toUpperCase();
  const { rows } = await c.query(RM_UPSERT, [
    kode, product.nama, "WIP", `Hasil produksi ${product.kode} — stok bahan setengah jadi`,
    unitId, 5, 5000, 3, "DINGIN", modal, "WIP", product.id, scope.company_id, scope.branch_id,
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
     VALUES ($1, $2, 0, 0, 0, $3, 'RAK-FNB', 'Stok seed F&B restaurant', true, $4, $5, NOW())
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
    await c.query(
      `DELETE FROM inventory.inventory_movements
       WHERE raw_material_id = $1 AND (reference_type = $2 OR reference_number LIKE $3)`,
      [m.id, SEED_REF, `${DEMO_PREFIX}-%`]
    );
    if (m.stokAwal > 0) {
      await c.query(
        `INSERT INTO inventory.inventory_movements
           (inventory_id, raw_material_id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost,
            reference_type, reference_number, alasan, is_active, branch_id, warehouse_id)
         VALUES ($1, $2, 'in', $3::numeric, 0, $3::numeric, $4::numeric, $3::numeric * $4::numeric,
                 $5, 'SEED-FNB', 'Stok awal seed F&B restaurant', true, $6, $7)`,
        [inventoryId, m.id, m.stokAwal, m.harga, SEED_REF, scope.branch_id, warehouseId]
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
     VALUES ($1, $2, $3, $4, $5, $6, true, true, false, $7, 'regular', $8, NOW())
     ON CONFLICT (sku) DO UPDATE SET
       name = EXCLUDED.name, description = EXCLUDED.description, category_id = EXCLUDED.category_id,
       base_price = EXCLUDED.base_price, cost_price = EXCLUDED.cost_price, is_active = true,
       is_available = true, station = EXCLUDED.station, product_kind = 'regular',
       source_product_id = EXCLUDED.source_product_id, updated_at = NOW()
     RETURNING sku, (xmax = 0) AS inserted`,
    [sku, product.nama, product.deskripsi, categoryId, Number(product.harga_jual),
     Number(product.harga_modal), p.station, product.id]
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
        [fgId, target.id, target.warehouseId, scope.branch_id, spec.qty, before, after, avgCost, spec.qty * avgCost, orderId, nomor, at]
      );
    } else {
      const outMat = target.kind === "wip" ? materialById.get(target.wipMaterialId) : materialById.get(target.id);
      const { rows: inv } = await c.query(`SELECT qty_available, unit_cost FROM inventory.inventory WHERE id = $1`, [outMat.inventoryId]);
      const before = Number(inv[0].qty_available);
      const after = before + spec.qty;
      const avgCost = after > 0 ? (before * Number(inv[0].unit_cost) + totalCost) / after : hpp;
      await c.query(`UPDATE inventory.inventory SET qty_available = $2, unit_cost = $3, last_movement_at = $4, updated_at = NOW() WHERE id = $1`,
        [outMat.inventoryId, after, avgCost, at]);
      outMat.harga = avgCost;
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

    const unitMap = await loadUnitMap(c, scope.company_id);
    const uid = (code) => {
      const id = unitMap.get(code);
      if (!id) throw new Error(`Unit "${code}" tidak ditemukan — jalankan npm run db:seed:items-units dulu`);
      return id;
    };
    await upsertRmCategories(c, scope);
    await upsertProductCategories(c);

    // Gudang: MAIN untuk bahan; produk jadi ditempatkan di stall masing-masing.
    const { rows: whRows } = await c.query(
      `SELECT id, code FROM configuration.warehouses WHERE branch_id = $1 AND is_active = true`,
      [scope.branch_id]
    );
    const warehouseByCode = new Map(whRows.map((w) => [w.code, w.id]));
    const mainWarehouse = warehouseByCode.get(MAIN_WAREHOUSE);
    if (!mainWarehouse) throw new Error(`Gudang ${MAIN_WAREHOUSE} tidak ditemukan di ${scope.branch_name}`);
    const whFor = (code) => warehouseByCode.get(code) ?? mainWarehouse;

    // 1. Bahan baku
    const materialMap = await upsertMaterials(c, scope, uid);
    console.log(`✓ Bahan baku: ${materialMap.size} item (satuan stok = satuan resep; konversi beli tercatat)`);

    // 2. Resep bahan setengah jadi
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
      out.harga = Math.round(cost * 100) / 100;
      await c.query(`UPDATE item.raw_materials SET harga_beli = $2 WHERE id = $1`, [out.id, out.harga]);
      console.log(`✓ Resep bahan: ${out.kode} ${out.nama} → biaya Rp ${out.harga}/${out.satuan}`);
    }

    // 3. Produk WIP + BOM + bahan WIP hasilnya
    const targets = {};
    for (const p of WIP_PRODUCTS) {
      const bahan = p.components.reduce((s, [k, q, w]) => s + materialMap.get(k).harga * q * (1 + (w || 0)), 0);
      const modal = Math.ceil(bahan + p.biaya_produksi);
      const product = await upsertProduct(c, p, scope, uid(p.satuan), whFor(p.stall), modal, "WIP");
      await replaceBom(c, product.id, p.components, materialMap);
      const wipMat = await ensureWipMaterial(c, scope, product, uid(p.satuan), p.satuan, modal);
      materialMap.set(`WIP:${p.kode}`, wipMat);
      targets[p.kode] = { kind: "wip", id: product.id, outputType: "WIP", wipMaterialId: wipMat.id };
      console.log(`✓ Produk WIP ${p.kode} ${p.nama} — HPP resep Rp ${modal.toLocaleString("id-ID")}/${p.satuan} → bahan ${wipMat.kode}`);
    }

    // 4. Stok awal bahan (WIP = 0, terisi dari contoh produksi)
    const stockCount = await seedRawStock(c, scope, mainWarehouse, materialMap);
    console.log(`✓ Stok awal bahan @ ${MAIN_WAREHOUSE}: ${stockCount} baris`);

    // 5. Menu jadi + BOM + stok awal + POS (per stall)
    for (const p of PRODUCTS) {
      const bahan = p.components.reduce((s, [k, q, w]) => s + materialMap.get(k).harga * q * (1 + (w || 0)), 0);
      const modal = ceil100(bahan + p.biaya_produksi);
      const warehouseId = whFor(p.stall);
      const product = await upsertProduct(c, p, scope, uid("PORSI"), warehouseId, modal, "FINISHED_GOOD");
      await replaceBom(c, product.id, p.components, materialMap);
      await c.query(
        `INSERT INTO inventory.finished_goods_inventory (product_id, qty_available, unit_cost, last_movement_at, is_active)
         VALUES ($1, $2, $3, NOW(), true)
         ON CONFLICT (product_id) DO UPDATE SET qty_available = EXCLUDED.qty_available, unit_cost = EXCLUDED.unit_cost,
           last_movement_at = NOW(), is_active = true, updated_at = NOW()`,
        [product.id, p.stok_awal, modal]
      );
      const pos = await upsertPosProduct(c, product, p);
      targets[p.kode] = { kind: "product", id: product.id, outputType: "FINISHED_GOOD", warehouseId };
      console.log(`  ✓ ${p.kode} ${p.nama} @${p.stall} — modal Rp ${modal.toLocaleString("id-ID")} / jual Rp ${p.jual.toLocaleString("id-ID")} · ${p.components.length} BOM · stok ${p.stok_awal} → POS ${pos.sku} [${pos.inserted ? "created" : "updated"}]`);
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
      const r = await createDemoOrder(c, scope, mainWarehouse, spec, targets, materialById);
      console.log(`  ✓ ${r.nomor} ${spec.status.padEnd(11)} ${spec.ref} × ${spec.qty} — bahan Rp ${Math.round(r.plannedMaterialCost).toLocaleString("id-ID")}, HPP/unit Rp ${Math.round(r.hpp).toLocaleString("id-ID")}`);
    }

    await c.query("COMMIT");
    console.log(`\nSelesai: ${materialMap.size} bahan (termasuk WIP), ${WIP_PRODUCTS.length} produk WIP, ${PRODUCTS.length} menu jadi, ${DEMO_ORDERS.length} contoh produksi.`);
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
