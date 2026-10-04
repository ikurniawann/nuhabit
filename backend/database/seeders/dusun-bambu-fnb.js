#!/usr/bin/env node
/**
 * Seeder TENANT DUSUN BAMBU — bagian 2: F&B Sunda & Nusantara untuk empat
 * restoran bertema + Bebek Kabayan (data lokal, owner 2026-09-06).
 *
 * Mengisi (idempoten, satu transaksi, HANYA database lokal):
 *   - item.raw_material_categories / raw_materials (+konversi satuan beli)
 *   - manufacturing.raw_material_bom_items : 5 bumbu/kaldu prep dapur (WIP bahan)
 *   - item.products (WIP ungkep + menu jadi per restoran) + manufacturing.bom_items
 *   - inventory.inventory / finished_goods_inventory : stok awal
 *   - manufacturing.production_orders : 8 contoh prep dapur
 *   - pos.pos_products : menu tampil di kasir tiap outlet
 *
 * Prasyarat: npm run db:seed:dusun-bambu  (perusahaan, cabang, outlet)
 * Usage:     npm run db:seed:dusun-bambu-fnb
 */

const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");
const { loadEnv, ensureScope, outletMap } = require("./lib/dusun-bambu-scope");

const DEMO_PREFIX = "PROD-DB";
const SEED_REF = "seed_dusun_bambu";

// Satuan wajib ada per perusahaan (unit Sulu tidak terlihat oleh tenant lain)
const UNITS = [
  ["GR", "Gram", "KECIL"], ["ML", "Mililiter", "KECIL"], ["PCS", "Pieces", "KECIL"],
  ["BUTIR", "Butir", "KECIL"], ["LBR", "Lembar", "KECIL"], ["PORSI", "Porsi", "KECIL"],
  ["KG", "Kilogram", "BESAR"], ["L", "Liter", "BESAR"], ["TRAY", "Tray", "BESAR"],
  ["PACK", "Pack", "BESAR"], ["SACK", "Karung", "BESAR"], ["GAL", "Jerigen", "BESAR"],
  ["BTL", "Botol", "BESAR"], ["BOX", "Box", "BESAR"],
];

const RM_CATEGORIES = [
  ["DB-PROTEIN", "Protein & Ternak", "Ayam kampung, bebek, sapi, ikan air tawar"],
  ["DB-SAYUR", "Sayur & Lalapan", "Lalapan segar, sayur asem, kol, kacang panjang"],
  ["DB-BUMBU", "Bumbu Dapur Sunda", "Cabai, bawang, terasi, kencur, kunyit, sereh"],
  ["DB-KERING", "Bahan Kering & Pokok", "Beras, tepung, gula aren, kecap, minyak"],
  ["DB-MINUMAN", "Bahan Minuman", "Kopi, kelapa muda, susu, jahe, rempah bandrek"],
];

// [kode, nama, kategori, satuanStok, harga/satuan, stokAwal, min, max, shelfLife, storage, deskripsi, satuanBeli, isi]
const MATERIALS = [
  ["DB-PRO-001", "Ayam Kampung Utuh", "DB-PROTEIN", "GR", 55, 60_000, 15_000, 150_000, 3, "DINGIN", "Ayam kampung ±1 kg/ekor", "KG", 1000],
  ["DB-PRO-002", "Bebek Muda", "DB-PROTEIN", "GR", 62, 40_000, 10_000, 100_000, 3, "BEKU", "Bebek peking muda", "KG", 1000],
  ["DB-PRO-003", "Gurame Segar", "DB-PROTEIN", "GR", 68, 30_000, 8_000, 80_000, 2, "DINGIN", "Gurame kolam ±700 gr/ekor", "KG", 1000],
  ["DB-PRO-004", "Ikan Mas", "DB-PROTEIN", "GR", 45, 20_000, 5_000, 60_000, 2, "DINGIN", "Ikan mas untuk pepes", "KG", 1000],
  ["DB-PRO-005", "Sirloin Sapi", "DB-PROTEIN", "GR", 185, 12_000, 3_000, 30_000, 5, "BEKU", "Sirloin impor untuk steak Burangrang", "KG", 1000],
  ["DB-PRO-006", "Telur Ayam", "DB-PROTEIN", "BUTIR", 2_300, 900, 200, 2_000, 21, "SUHU_RUANG", "Telur ayam negeri", "TRAY", 30],
  ["DB-SAY-001", "Paket Lalapan Segar", "DB-SAYUR", "GR", 15, 30_000, 8_000, 60_000, 3, "DINGIN", "Kubis, timun, kemangi, selada", "KG", 1000],
  ["DB-SAY-002", "Kacang Panjang", "DB-SAYUR", "GR", 14, 15_000, 4_000, 30_000, 4, "DINGIN", "Untuk karedok & sayur asem", "KG", 1000],
  ["DB-SAY-003", "Tauge", "DB-SAYUR", "GR", 12, 8_000, 2_000, 20_000, 2, "DINGIN", "Tauge segar", "KG", 1000],
  ["DB-SAY-004", "Terong Ungu", "DB-SAYUR", "GR", 16, 10_000, 3_000, 25_000, 5, "DINGIN", "Terong untuk lalapan & sayur", "KG", 1000],
  ["DB-BMB-001", "Cabai Rawit Merah", "DB-BUMBU", "GR", 65, 8_000, 2_000, 20_000, 7, "DINGIN", "Cabai rawit sambal dadak", "KG", 1000],
  ["DB-BMB-002", "Bawang Merah", "DB-BUMBU", "GR", 38, 15_000, 4_000, 40_000, 21, "SUHU_RUANG", "Bawang merah lokal", "KG", 1000],
  ["DB-BMB-003", "Bawang Putih", "DB-BUMBU", "GR", 42, 10_000, 3_000, 30_000, 21, "SUHU_RUANG", "Bawang putih kating", "KG", 1000],
  ["DB-BMB-004", "Terasi Bakar", "DB-BUMBU", "GR", 90, 2_000, 500, 5_000, 180, "SUHU_RUANG", "Terasi udang khas Sunda", "PACK", 250],
  ["DB-BMB-005", "Kencur, Kunyit & Jahe", "DB-BUMBU", "GR", 30, 12_000, 3_000, 30_000, 14, "DINGIN", "Rimpang campuran bumbu dasar", "KG", 1000],
  ["DB-BMB-006", "Sereh & Daun Salam", "DB-BUMBU", "GR", 25, 5_000, 1_500, 12_000, 10, "DINGIN", "Aromatik masakan Sunda & Bali", "KG", 1000],
  ["DB-BMB-007", "Tomat", "DB-BUMBU", "GR", 18, 12_000, 3_000, 30_000, 7, "DINGIN", "Tomat merah sambal", "KG", 1000],
  ["DB-KRG-001", "Beras Pandan Wangi", "DB-KERING", "GR", 15, 150_000, 40_000, 300_000, 365, "SUHU_RUANG", "Beras untuk nasi liwet & timbel", "SACK", 25000],
  ["DB-KRG-002", "Kelapa Parut & Santan", "DB-KERING", "ML", 12, 40_000, 10_000, 90_000, 3, "DINGIN", "Santan segar peras", "L", 1000],
  ["DB-KRG-003", "Gula Aren", "DB-KERING", "GR", 28, 15_000, 4_000, 40_000, 180, "SUHU_RUANG", "Gula aren cetak untuk bandrek & bumbu", "KG", 1000],
  ["DB-KRG-004", "Kecap Manis", "DB-KERING", "ML", 30, 12_000, 3_000, 30_000, 365, "SUHU_RUANG", "Kecap manis botol besar", "L", 1000],
  ["DB-KRG-005", "Minyak Goreng", "DB-KERING", "ML", 18, 50_000, 15_000, 120_000, 365, "SUHU_RUANG", "Minyak goreng jerigen", "GAL", 18000],
  ["DB-KRG-006", "Garam & Penyedap", "DB-KERING", "GR", 8, 12_000, 3_000, 30_000, 365, "SUHU_RUANG", "Garam + kaldu jamur", "KG", 1000],
  ["DB-KRG-007", "Spaghetti Kering", "DB-KERING", "GR", 32, 8_000, 2_000, 20_000, 365, "SUHU_RUANG", "Pasta untuk menu Burangrang", "KG", 1000],
  ["DB-KRG-008", "Roti Tawar & Keju", "DB-KERING", "GR", 55, 6_000, 1_500, 15_000, 7, "DINGIN", "Roti + keju untuk sandwich", "KG", 1000],
  ["DB-MIN-001", "Kelapa Muda Utuh", "DB-MINUMAN", "PCS", 12_000, 300, 80, 800, 5, "DINGIN", "Kelapa muda segar", "PACK", 10],
  ["DB-MIN-002", "Kopi Robusta Bubuk", "DB-MINUMAN", "GR", 120, 6_000, 1_500, 15_000, 90, "SUHU_RUANG", "Kopi tubruk khas Bandung", "KG", 1000],
  ["DB-MIN-003", "Susu Kental Manis", "DB-MINUMAN", "ML", 35, 10_000, 3_000, 25_000, 365, "SUHU_RUANG", "Untuk bajigur & kopi susu", "L", 1000],
  ["DB-MIN-004", "Rempah Bandrek (jahe, cengkeh, kayu manis)", "DB-MINUMAN", "GR", 70, 5_000, 1_500, 12_000, 180, "SUHU_RUANG", "Campuran rempah minuman hangat", "KG", 1000],
  ["DB-KEM-001", "Besek & Daun Pisang", "KEMASAN", "PCS", 3_500, 800, 200, 2_000, 14, "SUHU_RUANG", "Kemasan piknik Lutung Kasarung", "PACK", 25],
  ["DB-KEM-002", "Cup & Tutup Minuman", "KEMASAN", "PCS", 1_000, 1_500, 400, 4_000, null, "SUHU_RUANG", "Cup take-away", "PACK", 50],
  // Bahan setengah jadi (hasil prep dapur)
  ["DB-WIP-SAMBAL", "Sambal Dadak Purbasari", "WIP", "GR", 0, 0, 2_000, 20_000, 2, "DINGIN", "Sambal terasi ulek segar", null, null],
  ["DB-WIP-KUNING", "Bumbu Kuning Bali", "WIP", "GR", 0, 0, 1_500, 15_000, 7, "DINGIN", "Base genep untuk ayam betutu & sate lilit", null, null],
  ["DB-WIP-BAKAR", "Bumbu Bakar Kecap", "WIP", "ML", 0, 0, 1_500, 15_000, 7, "DINGIN", "Olesan bakar ayam/ikan/bebek", null, null],
  ["DB-WIP-KALDU", "Kaldu Ayam Kampung", "WIP", "ML", 0, 0, 3_000, 30_000, 2, "DINGIN", "Kaldu untuk nasi liwet & sayur", null, null],
  ["DB-WIP-BANDREK", "Base Bandrek Gula Aren", "WIP", "ML", 0, 0, 1_000, 10_000, 14, "DINGIN", "Rebusan rempah + gula aren", null, null],
];

const RAW_MATERIAL_RECIPES = [
  { output: "DB-WIP-SAMBAL", components: [["DB-BMB-001", 0.5, 0.05], ["DB-BMB-007", 0.25, 0.05], ["DB-BMB-002", 0.15, 0.05], ["DB-BMB-004", 0.05, 0], ["DB-KRG-006", 0.02, 0]] },
  { output: "DB-WIP-KUNING", components: [["DB-BMB-005", 0.35, 0.05], ["DB-BMB-002", 0.25, 0.05], ["DB-BMB-003", 0.15, 0.05], ["DB-BMB-006", 0.1, 0.05], ["DB-KRG-005", 0.1, 0]] },
  { output: "DB-WIP-BAKAR", components: [["DB-KRG-004", 0.6, 0], ["DB-BMB-003", 0.1, 0.05], ["DB-BMB-005", 0.08, 0.05], ["DB-KRG-003", 0.12, 0]] },
  { output: "DB-WIP-KALDU", components: [["DB-PRO-001", 0.25, 0.05], ["DB-BMB-006", 0.02, 0], ["DB-BMB-003", 0.02, 0], ["DB-KRG-006", 0.008, 0]] },
  { output: "DB-WIP-BANDREK", components: [["DB-MIN-004", 0.12, 0.02], ["DB-KRG-003", 0.4, 0]] },
];

const PRODUCT_CATEGORIES = [
  ["DB-SUNDA", "Sunda", "Masakan Sunda: liwet, bakar, pepes, karedok"],
  ["DB-NUSANTARA", "Nusantara & Bali", "Nasi campur, betutu, sate lilit"],
  ["DB-WESTERN", "Western", "Steak, pasta, sandwich"],
  ["DB-PIKNIK", "Piknik", "Paket besek piknik Lutung Kasarung"],
  ["DB-MINUMAN", "Minuman", "Bandrek, bajigur, kelapa muda, kopi"],
  ["DB-WIP", "Setengah Jadi", "Ungkep & prep dapur Dusun Bambu"],
];

// Produk WIP (ungkep) — output masuk stok bahan
const WIP_PRODUCTS = [
  {
    kode: "DB-WIP-AYAM-UNGKEP", nama: "Ayam Kampung Ungkep (potong)", satuan: "PCS", outlet: "MAIN", station: "kitchen",
    biaya_produksi: 2_500, deskripsi: "Ayam kampung 1/4 potong diungkep bumbu kuning, siap bakar",
    components: [["DB-PRO-001", 250, 0.05], ["DB-WIP-KUNING", 35, 0], ["DB-WIP-KALDU", 80, 0], ["DB-KRG-006", 3, 0]],
  },
  {
    kode: "DB-WIP-BEBEK-UNGKEP", nama: "Bebek Ungkep (potong)", satuan: "PCS", outlet: "MAIN", station: "kitchen",
    biaya_produksi: 3_500, deskripsi: "Bebek 1/4 potong diungkep rempah, siap goreng kremes",
    components: [["DB-PRO-002", 280, 0.05], ["DB-WIP-KUNING", 40, 0], ["DB-BMB-006", 8, 0], ["DB-KRG-006", 3, 0]],
  },
];

// Menu jadi per outlet
const PRODUCTS = [
  // Purbasari — Sunda lesehan tepi danau
  { kode: "DB-PBS-001", nama: "Nasi Liwet Komplit (2-3 orang)", kategori: "DB-SUNDA", pos_category: "Sunda", outlet: "RESTO-PBS", station: "kitchen",
    jual: 145_000, biaya_produksi: 6_000, stok_awal: 12, deskripsi: "Nasi liwet kastrol, ayam bakar, tahu tempe, lalapan, sambal dadak",
    components: [["DB-KRG-001", 400, 0.02], ["DB-WIP-KALDU", 250, 0], ["WIP:DB-WIP-AYAM-UNGKEP", 1, 0], ["DB-WIP-BAKAR", 30, 0], ["DB-SAY-001", 150, 0.1], ["DB-WIP-SAMBAL", 60, 0], ["DB-KRG-002", 100, 0]] },
  { kode: "DB-PBS-002", nama: "Gurame Bakar Sambal Dadak", kategori: "DB-SUNDA", pos_category: "Sunda", outlet: "RESTO-PBS", station: "kitchen",
    jual: 135_000, biaya_produksi: 5_000, stok_awal: 10, deskripsi: "Gurame bakar utuh, sambal dadak, lalapan",
    components: [["DB-PRO-003", 700, 0.08], ["DB-WIP-BAKAR", 45, 0], ["DB-WIP-SAMBAL", 60, 0], ["DB-SAY-001", 120, 0.1]] },
  { kode: "DB-PBS-003", nama: "Pepes Ikan Mas", kategori: "DB-SUNDA", pos_category: "Sunda", outlet: "RESTO-PBS", station: "kitchen",
    jual: 65_000, biaya_produksi: 3_000, stok_awal: 15, deskripsi: "Ikan mas dibungkus daun pisang, bumbu kuning, kemangi",
    components: [["DB-PRO-004", 300, 0.05], ["DB-WIP-KUNING", 45, 0], ["DB-BMB-007", 30, 0.05], ["DB-KEM-001", 1, 0]] },
  { kode: "DB-PBS-004", nama: "Karedok Sunda", kategori: "DB-SUNDA", pos_category: "Sunda", outlet: "RESTO-PBS", station: "kitchen",
    jual: 38_000, biaya_produksi: 2_000, stok_awal: 20, deskripsi: "Sayuran mentah segar dengan bumbu kacang kencur",
    components: [["DB-SAY-002", 80, 0.1], ["DB-SAY-003", 60, 0.1], ["DB-SAY-004", 60, 0.1], ["DB-SAY-001", 80, 0.1], ["DB-BMB-005", 15, 0]] },
  // Lembur Urang — Nusantara & Bali
  { kode: "DB-LMU-001", nama: "Nasi Campur Bali", kategori: "DB-NUSANTARA", pos_category: "Nusantara", outlet: "RESTO-LMU", station: "kitchen",
    jual: 98_000, biaya_produksi: 4_500, stok_awal: 15, deskripsi: "Nasi dengan sate lilit, ayam sisit, lawar, sambal matah",
    components: [["DB-KRG-001", 200, 0.02], ["WIP:DB-WIP-AYAM-UNGKEP", 1, 0], ["DB-WIP-KUNING", 40, 0], ["DB-SAY-003", 50, 0.1], ["DB-KRG-002", 80, 0], ["DB-WIP-SAMBAL", 40, 0]] },
  { kode: "DB-LMU-002", nama: "Ayam Betutu Khas Bali", kategori: "DB-NUSANTARA", pos_category: "Nusantara", outlet: "RESTO-LMU", station: "kitchen",
    jual: 125_000, biaya_produksi: 5_000, stok_awal: 10, deskripsi: "Ayam utuh dibungkus daun, dipanggang lama dengan base genep",
    components: [["DB-PRO-001", 900, 0.05], ["DB-WIP-KUNING", 120, 0], ["DB-BMB-006", 20, 0], ["DB-KEM-001", 1, 0]] },
  { kode: "DB-LMU-003", nama: "Nasi Goreng Kampung", kategori: "DB-NUSANTARA", pos_category: "Nusantara", outlet: "RESTO-LMU", station: "kitchen",
    jual: 58_000, biaya_produksi: 2_500, stok_awal: 20, deskripsi: "Nasi goreng dengan telur mata sapi dan kerupuk",
    components: [["DB-KRG-001", 200, 0.02], ["DB-PRO-006", 1, 0], ["DB-KRG-004", 25, 0], ["DB-BMB-002", 20, 0.05], ["DB-KRG-005", 20, 0]] },
  // Burangrang — Western & venue meeting
  { kode: "DB-BRG-001", nama: "Sirloin Steak 200gr", kategori: "DB-WESTERN", pos_category: "Western", outlet: "RESTO-BRG", station: "kitchen",
    jual: 195_000, biaya_produksi: 8_000, stok_awal: 12, deskripsi: "Sirloin panggang, saus lada hitam, kentang & sayur",
    components: [["DB-PRO-005", 200, 0.05], ["DB-KRG-008", 30, 0.05], ["DB-SAY-001", 80, 0.1], ["DB-KRG-005", 20, 0]] },
  { kode: "DB-BRG-002", nama: "Spaghetti Aglio Olio", kategori: "DB-WESTERN", pos_category: "Western", outlet: "RESTO-BRG", station: "kitchen",
    jual: 78_000, biaya_produksi: 3_000, stok_awal: 15, deskripsi: "Pasta bawang putih, cabai kering, minyak zaitun",
    components: [["DB-KRG-007", 120, 0.03], ["DB-BMB-003", 25, 0.05], ["DB-BMB-001", 8, 0], ["DB-KRG-005", 30, 0]] },
  { kode: "DB-BRG-003", nama: "Club Sandwich", kategori: "DB-WESTERN", pos_category: "Western", outlet: "RESTO-BRG", station: "kitchen",
    jual: 72_000, biaya_produksi: 3_000, stok_awal: 15, deskripsi: "Roti panggang isi ayam, telur, keju, sayur",
    components: [["DB-KRG-008", 150, 0.05], ["DB-PRO-001", 120, 0.05], ["DB-PRO-006", 1, 0], ["DB-SAY-001", 60, 0.1]] },
  // Lutung Kasarung — piknik di sarang
  { kode: "DB-LTK-001", nama: "Besek Piknik Sunda (2 orang)", kategori: "DB-PIKNIK", pos_category: "Piknik", outlet: "RESTO-LTK", station: "kitchen",
    jual: 235_000, biaya_produksi: 9_000, stok_awal: 8, deskripsi: "Besek berisi nasi timbel, ayam bakar, pepes, lalapan, sambal, kelapa muda",
    components: [["DB-KRG-001", 300, 0.02], ["WIP:DB-WIP-AYAM-UNGKEP", 2, 0], ["DB-WIP-BAKAR", 50, 0], ["DB-WIP-SAMBAL", 80, 0], ["DB-SAY-001", 150, 0.1], ["DB-KEM-001", 2, 0], ["DB-MIN-001", 2, 0]] },
  { kode: "DB-LTK-002", nama: "Nasi Timbel Komplit", kategori: "DB-PIKNIK", pos_category: "Piknik", outlet: "RESTO-LTK", station: "kitchen",
    jual: 89_000, biaya_produksi: 4_000, stok_awal: 12, deskripsi: "Nasi timbel daun pisang, ayam bakar, tahu tempe, sayur asem",
    components: [["DB-KRG-001", 250, 0.02], ["WIP:DB-WIP-AYAM-UNGKEP", 1, 0], ["DB-WIP-BAKAR", 30, 0], ["DB-SAY-002", 60, 0.1], ["DB-WIP-SAMBAL", 50, 0], ["DB-KEM-001", 1, 0]] },
  // Bebek Kabayan
  { kode: "DB-BKY-001", nama: "Bebek Goreng Kremes", kategori: "DB-SUNDA", pos_category: "Sunda", outlet: "BEBEK-KBY", station: "kitchen",
    jual: 95_000, biaya_produksi: 4_000, stok_awal: 15, deskripsi: "Bebek ungkep goreng dengan kremes renyah, sambal dadak",
    components: [["WIP:DB-WIP-BEBEK-UNGKEP", 1, 0], ["DB-KRG-005", 60, 0], ["DB-WIP-SAMBAL", 60, 0], ["DB-SAY-001", 100, 0.1], ["DB-KRG-001", 200, 0.02]] },
  { kode: "DB-BKY-002", nama: "Bebek Bakar Madu", kategori: "DB-SUNDA", pos_category: "Sunda", outlet: "BEBEK-KBY", station: "kitchen",
    jual: 99_000, biaya_produksi: 4_000, stok_awal: 12, deskripsi: "Bebek ungkep dibakar dengan olesan kecap madu",
    components: [["WIP:DB-WIP-BEBEK-UNGKEP", 1, 0], ["DB-WIP-BAKAR", 45, 0], ["DB-WIP-SAMBAL", 60, 0], ["DB-SAY-001", 100, 0.1], ["DB-KRG-001", 200, 0.02]] },
  // Minuman (dijual di semua outlet, ditempatkan di Purbasari sebagai basis stok)
  { kode: "DB-DRK-001", nama: "Bandrek Gula Aren", kategori: "DB-MINUMAN", pos_category: "Minuman", outlet: "RESTO-PBS", station: "bar",
    jual: 28_000, biaya_produksi: 800, stok_awal: 40, deskripsi: "Minuman jahe rempah hangat khas Bandung",
    components: [["DB-WIP-BANDREK", 120, 0], ["DB-KRG-002", 60, 0], ["DB-KEM-002", 1, 0]] },
  { kode: "DB-DRK-002", nama: "Bajigur Susu", kategori: "DB-MINUMAN", pos_category: "Minuman", outlet: "RESTO-PBS", station: "bar",
    jual: 30_000, biaya_produksi: 800, stok_awal: 35, deskripsi: "Bajigur santan gula aren dengan susu",
    components: [["DB-WIP-BANDREK", 100, 0], ["DB-KRG-002", 120, 0], ["DB-MIN-003", 40, 0], ["DB-KEM-002", 1, 0]] },
  { kode: "DB-DRK-003", nama: "Es Kelapa Muda Utuh", kategori: "DB-MINUMAN", pos_category: "Minuman", outlet: "RESTO-PBS", station: "bar",
    jual: 35_000, biaya_produksi: 500, stok_awal: 50, deskripsi: "Kelapa muda utuh disajikan dingin",
    components: [["DB-MIN-001", 1, 0.05], ["DB-KRG-003", 20, 0]] },
  { kode: "DB-DRK-004", nama: "Kopi Tubruk Bandung", kategori: "DB-MINUMAN", pos_category: "Minuman", outlet: "RESTO-BRG", station: "bar",
    jual: 25_000, biaya_produksi: 600, stok_awal: 45, deskripsi: "Kopi robusta tubruk gula aren",
    components: [["DB-MIN-002", 18, 0.03], ["DB-KRG-003", 15, 0], ["DB-KEM-002", 1, 0]] },
];

const DEMO_ORDERS = [
  { no: 1, context: "raw_material", ref: "DB-WIP-KALDU", qty: 15_000, status: "COMPLETED", labor: 120_000, overhead: 40_000, days_ago: 5, catatan: "Kaldu ayam kampung 15 liter" },
  { no: 2, context: "raw_material", ref: "DB-WIP-KUNING", qty: 4_000, status: "COMPLETED", labor: 90_000, overhead: 25_000, days_ago: 5, catatan: "Base genep 4 kg" },
  { no: 3, context: "raw_material", ref: "DB-WIP-BAKAR", qty: 3_000, status: "COMPLETED", labor: 40_000, overhead: 10_000, days_ago: 4, catatan: "Bumbu olesan bakar 3 liter" },
  { no: 4, context: "raw_material", ref: "DB-WIP-SAMBAL", qty: 5_000, status: "COMPLETED", labor: 100_000, overhead: 20_000, days_ago: 1, catatan: "Sambal dadak harian" },
  { no: 5, context: "raw_material", ref: "DB-WIP-BANDREK", qty: 4_000, status: "COMPLETED", labor: 50_000, overhead: 15_000, days_ago: 3, catatan: "Base bandrek 4 liter" },
  { no: 6, context: "wip", ref: "DB-WIP-AYAM-UNGKEP", qty: 60, status: "COMPLETED", labor: 180_000, overhead: 60_000, days_ago: 2, catatan: "Ungkep ayam untuk liwet & timbel" },
  { no: 7, context: "wip", ref: "DB-WIP-BEBEK-UNGKEP", qty: 40, status: "COMPLETED", labor: 160_000, overhead: 50_000, days_ago: 2, catatan: "Ungkep bebek Kabayan" },
  { no: 8, context: "product", ref: "DB-PBS-001", qty: 10, status: "IN_PROGRESS", labor: 80_000, overhead: 25_000, packaging: 10_000, days_ago: 0, catatan: "Liwet untuk rombongan siang" },
];

/* ─────────────────────────── helpers (pola items-footwear) ─────────────────────────── */
const ceil100 = (n) => Math.ceil(n / 100) * 100;
const daysAgo = (d) => new Date(Date.now() - d * 86_400_000);

async function loadUnitMap(c, companyId) {
  const { rows } = await c.query(
    `SELECT id, kode, company_id FROM item.units
     WHERE deleted_at IS NULL AND (company_id = $1 OR company_id IS NULL) ORDER BY (company_id IS NULL)`,
    [companyId]
  );
  const map = new Map();
  for (const r of rows) if (!map.has(r.kode)) map.set(r.kode, r.id);
  return map;
}

const RM_UPSERT = `
  INSERT INTO item.raw_materials
    (kode, nama, kategori, deskripsi, satuan_besar_id, satuan_kecil_id, konversi_factor,
     stok_minimum, stok_maximum, shelf_life_days, storage_condition, harga_beli, material_type,
     source_product_id, company_id, branch_id, is_active)
  VALUES ($1,$2,$3,$4,$5,$5,1,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)
  ON CONFLICT (
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), kode
  ) WHERE deleted_at IS NULL
  DO UPDATE SET nama = EXCLUDED.nama, kategori = EXCLUDED.kategori, deskripsi = EXCLUDED.deskripsi,
    satuan_besar_id = EXCLUDED.satuan_besar_id, satuan_kecil_id = EXCLUDED.satuan_kecil_id, konversi_factor = 1,
    stok_minimum = EXCLUDED.stok_minimum, stok_maximum = EXCLUDED.stok_maximum,
    shelf_life_days = EXCLUDED.shelf_life_days, storage_condition = EXCLUDED.storage_condition,
    harga_beli = EXCLUDED.harga_beli, material_type = EXCLUDED.material_type,
    source_product_id = EXCLUDED.source_product_id, is_active = true, deleted_at = NULL, updated_at = NOW()
  RETURNING id, kode, nama`;

async function main() {
  loadEnv();
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) { console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL"); process.exit(1); }
  try { assertLocalTarget(url, "MIGRATE_DATABASE_URL"); } catch (err) { console.error(err.message); process.exit(1); }

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    await c.query("BEGIN");
    const scope = await ensureScope(c);
    const outlets = await outletMap(c, scope.branch_id);
    if (!outlets.get("MAIN")) throw new Error("Outlet MAIN belum ada — jalankan npm run db:seed:dusun-bambu dulu");
    console.log(`Tenant: ${scope.company_name} / ${scope.branch_name} — ${outlets.size} outlet`);

    for (const [kode, nama, tipe] of UNITS) {
      await c.query(
        `INSERT INTO item.units (kode, nama, tipe, deskripsi, company_id, is_active)
         VALUES ($1,$2,$3,$4,$5,true)
         ON CONFLICT (company_id, kode) WHERE company_id IS NOT NULL AND deleted_at IS NULL
         DO UPDATE SET nama = EXCLUDED.nama, tipe = EXCLUDED.tipe, is_active = true, deleted_at = NULL, updated_at = NOW()`,
        [kode, nama, tipe, `Satuan ${nama} — tenant Dusun Bambu`, scope.company_id]
      );
    }
    const unitMap = await loadUnitMap(c, scope.company_id);
    const uid = (code) => {
      const id = unitMap.get(code);
      if (!id) throw new Error(`Unit "${code}" tidak ada — jalankan npm run db:seed:items-units dulu`);
      return id;
    };

    for (const [code, nama, deskripsi] of RM_CATEGORIES) {
      await c.query(
        `INSERT INTO item.raw_material_categories (code, nama, deskripsi, company_id, is_active)
         VALUES ($1,$2,$3,$4,true)
         ON CONFLICT (company_id, code) WHERE company_id IS NOT NULL AND deleted_at IS NULL
         DO UPDATE SET nama = EXCLUDED.nama, deskripsi = EXCLUDED.deskripsi, is_active = true, deleted_at = NULL, updated_at = NOW()`,
        [code, nama, deskripsi, scope.company_id]
      );
    }
    for (const [code, nama, deskripsi] of [["KEMASAN", "Kemasan & Disposable", "Besek, daun pisang, cup"], ["WIP", "Bahan Setengah Jadi (WIP)", "Bumbu & kaldu prep dapur"]]) {
      await c.query(
        `INSERT INTO item.raw_material_categories (code, nama, deskripsi, company_id, is_active)
         VALUES ($1,$2,$3,$4,true) ON CONFLICT (company_id, code) WHERE company_id IS NOT NULL AND deleted_at IS NULL
         DO UPDATE SET is_active = true, deleted_at = NULL, updated_at = NOW()`,
        [code, nama, deskripsi, scope.company_id]
      );
    }
    for (const [code, nama, deskripsi] of PRODUCT_CATEGORIES) {
      await c.query(
        `INSERT INTO item.product_categories (code, nama, deskripsi, company_id, is_active)
         VALUES ($1,$2,$3,NULL,true)
         ON CONFLICT (code) WHERE company_id IS NULL AND deleted_at IS NULL
         DO UPDATE SET nama = EXCLUDED.nama, deskripsi = EXCLUDED.deskripsi, is_active = true, deleted_at = NULL, updated_at = NOW()`,
        [code, nama, deskripsi]
      );
    }

    // Bahan baku + konversi satuan beli
    const materialMap = new Map();
    for (const m of MATERIALS) {
      const [kode, nama, kategori, satuan, harga, stokAwal, min, max, shelf, storage, deskripsi, beliUnit, beliIsi] = m;
      const isWip = kategori === "WIP";
      const { rows } = await c.query(RM_UPSERT, [
        kode, nama, kategori, deskripsi, uid(satuan), min, max, shelf, storage, harga,
        isWip ? "WIP" : "PURCHASED", null, scope.company_id, scope.branch_id,
      ]);
      materialMap.set(kode, { ...rows[0], stokAwal, harga: Number(harga), satuan, unitId: uid(satuan) });
      await c.query(`DELETE FROM item.raw_material_unit_conversions WHERE raw_material_id = $1`, [rows[0].id]);
      await c.query(
        `INSERT INTO item.raw_material_unit_conversions (raw_material_id, satuan_id, qty_in_base_unit, is_base, is_active)
         VALUES ($1,$2,1,true,true)`, [rows[0].id, uid(satuan)]
      );
      if (beliUnit) {
        await c.query(
          `INSERT INTO item.raw_material_unit_conversions (raw_material_id, satuan_id, qty_in_base_unit, is_base, is_active)
           VALUES ($1,$2,$3,false,true)`, [rows[0].id, uid(beliUnit), beliIsi]
        );
      }
    }
    console.log(`✓ Bahan baku: ${materialMap.size} item`);

    // Resep bahan setengah jadi
    for (const r of RAW_MATERIAL_RECIPES) {
      const out = materialMap.get(r.output);
      await c.query(`DELETE FROM manufacturing.raw_material_bom_items WHERE output_raw_material_id = $1`, [out.id]);
      let cost = 0;
      for (const [kode, qty, waste] of r.components) {
        const m = materialMap.get(kode);
        await c.query(
          `INSERT INTO manufacturing.raw_material_bom_items (output_raw_material_id, component_raw_material_id, qty_required, satuan_id, waste_factor, is_active)
           VALUES ($1,$2,$3,$4,$5,true)`, [out.id, m.id, qty, m.unitId, waste || 0]
        );
        cost += m.harga * qty * (1 + (waste || 0));
      }
      out.harga = Math.round(cost * 100) / 100;
      await c.query(`UPDATE item.raw_materials SET harga_beli = $2 WHERE id = $1`, [out.id, out.harga]);
      console.log(`✓ Resep bahan ${out.kode} ${out.nama} → Rp ${out.harga}/${out.satuan}`);
    }

    const upsertProduct = async (p, modal, outputType, warehouseId, unitCode) => {
      const jual = p.jual ?? modal;
      const markup = modal > 0 ? Math.round(((jual - modal) / modal) * 100) : 0;
      const { rows } = await c.query(
        `INSERT INTO item.products
           (kode, nama, deskripsi, kategori, satuan_id, harga_jual, harga_modal, markup_persen,
            company_id, branch_id, warehouse_id, production_output_type, station, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
         ON CONFLICT (
           COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
           COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), warehouse_id, kode
         ) WHERE deleted_at IS NULL
         DO UPDATE SET nama = EXCLUDED.nama, deskripsi = EXCLUDED.deskripsi, kategori = EXCLUDED.kategori,
           satuan_id = EXCLUDED.satuan_id, harga_jual = EXCLUDED.harga_jual, harga_modal = EXCLUDED.harga_modal,
           markup_persen = EXCLUDED.markup_persen, production_output_type = EXCLUDED.production_output_type,
           station = EXCLUDED.station, is_active = true, deleted_at = NULL, updated_at = NOW()
         RETURNING id, kode, nama, deskripsi, harga_jual, harga_modal`,
        [p.kode, p.nama, p.deskripsi, p.kategori ?? "DB-WIP", uid(unitCode), jual, modal, markup,
         scope.company_id, scope.branch_id, warehouseId, outputType, p.station]
      );
      return rows[0];
    };
    const replaceBom = async (productId, components) => {
      await c.query(`DELETE FROM manufacturing.bom_items WHERE product_id = $1`, [productId]);
      for (const [ref, qty, waste] of components) {
        const m = materialMap.get(ref);
        if (!m) throw new Error(`Bahan ${ref} belum ada`);
        await c.query(
          `INSERT INTO manufacturing.bom_items (product_id, raw_material_id, qty_required, satuan_id, waste_factor, is_active)
           VALUES ($1,$2,$3,$4,$5,true)`, [productId, m.id, qty, m.unitId, waste || 0]
        );
      }
    };

    // Produk WIP (ungkep) + bahan WIP hasilnya
    const targets = {};
    for (const p of WIP_PRODUCTS) {
      const bahan = p.components.reduce((s, [k, q, w]) => s + materialMap.get(k).harga * q * (1 + (w || 0)), 0);
      const modal = Math.ceil(bahan + p.biaya_produksi);
      const product = await upsertProduct({ ...p, kategori: "DB-WIP" }, modal, "WIP", outlets.get(p.outlet), p.satuan);
      await replaceBom(product.id, p.components);
      const wipKode = `WP${p.kode.replace(/[^A-Za-z0-9]/g, "").slice(0, 17)}`.slice(0, 20).toUpperCase();
      const { rows } = await c.query(RM_UPSERT, [
        wipKode, p.nama, "WIP", `Hasil produksi ${p.kode}`, uid(p.satuan), 5, 500, 3, "DINGIN", modal,
        "WIP", product.id, scope.company_id, scope.branch_id,
      ]);
      materialMap.set(`WIP:${p.kode}`, { ...rows[0], stokAwal: 0, harga: modal, satuan: p.satuan, unitId: uid(p.satuan) });
      targets[p.kode] = { kind: "wip", id: product.id, outputType: "WIP", wipMaterialId: rows[0].id };
      console.log(`✓ Produk WIP ${p.kode} ${p.nama} — HPP Rp ${modal.toLocaleString("id-ID")}/${p.satuan}`);
    }

    // Stok awal bahan @ MAIN
    const mainWarehouse = outlets.get("MAIN");
    for (const m of materialMap.values()) {
      const { rows } = await c.query(
        `INSERT INTO inventory.inventory
           (raw_material_id, qty_available, qty_on_order, qty_minimum, qty_maximum, unit_cost, lokasi_rak, catatan, is_active, branch_id, warehouse_id, last_movement_at)
         VALUES ($1,$2,0,0,0,$3,'RAK-DB','Stok seed Dusun Bambu',true,$4,$5,NOW())
         ON CONFLICT (raw_material_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid))
         DO UPDATE SET qty_available = EXCLUDED.qty_available, unit_cost = EXCLUDED.unit_cost, is_active = true, last_movement_at = NOW(), updated_at = NOW()
         RETURNING id`,
        [m.id, m.stokAwal ?? 0, m.harga, scope.branch_id, mainWarehouse]
      );
      m.inventoryId = rows[0].id;
      await c.query(
        `DELETE FROM inventory.inventory_movements WHERE raw_material_id = $1 AND (reference_type = $2 OR reference_number LIKE $3)`,
        [m.id, SEED_REF, `${DEMO_PREFIX}-%`]
      );
      if ((m.stokAwal ?? 0) > 0) {
        await c.query(
          `INSERT INTO inventory.inventory_movements
             (inventory_id, raw_material_id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost, reference_type, reference_number, alasan, is_active, branch_id, warehouse_id)
           VALUES ($1,$2,'in',$3::numeric,0,$3::numeric,$4::numeric,$3::numeric * $4::numeric,$5,'SEED-DB','Stok awal seed Dusun Bambu',true,$6,$7)`,
          [m.inventoryId, m.id, m.stokAwal, m.harga, SEED_REF, scope.branch_id, mainWarehouse]
        );
      }
    }
    console.log(`✓ Stok awal bahan @ MAIN: ${materialMap.size} baris`);

    // Menu jadi + BOM + stok + POS
    for (const p of PRODUCTS) {
      const bahan = p.components.reduce((s, [k, q, w]) => s + materialMap.get(k).harga * q * (1 + (w || 0)), 0);
      const modal = ceil100(bahan + p.biaya_produksi);
      const warehouseId = outlets.get(p.outlet) ?? mainWarehouse;
      const product = await upsertProduct(p, modal, "FINISHED_GOOD", warehouseId, "PORSI");
      await replaceBom(product.id, p.components);
      await c.query(
        `INSERT INTO inventory.finished_goods_inventory (product_id, qty_available, unit_cost, last_movement_at, is_active)
         VALUES ($1,$2,$3,NOW(),true)
         ON CONFLICT (product_id) DO UPDATE SET qty_available = EXCLUDED.qty_available, unit_cost = EXCLUDED.unit_cost, last_movement_at = NOW(), is_active = true, updated_at = NOW()`,
        [product.id, p.stok_awal, modal]
      );
      const cat = await c.query(`SELECT id FROM pos.pos_categories WHERE lower(name) = lower($1) LIMIT 1`, [p.pos_category]);
      const categoryId = cat.rows[0]?.id
        ?? (await c.query(`INSERT INTO pos.pos_categories (name, is_active) VALUES ($1, true) RETURNING id`, [p.pos_category])).rows[0].id;
      await c.query(`UPDATE pos.pos_categories SET is_active = true WHERE id = $1`, [categoryId]);
      await c.query(
        `INSERT INTO pos.pos_products (sku, name, description, category_id, base_price, cost_price, is_active, is_available, inventory_tracking, station, product_kind, source_product_id, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,true,true,false,$7,'regular',$8,NOW())
         ON CONFLICT (sku) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, category_id = EXCLUDED.category_id,
           base_price = EXCLUDED.base_price, cost_price = EXCLUDED.cost_price, is_active = true, is_available = true,
           station = EXCLUDED.station, source_product_id = EXCLUDED.source_product_id, updated_at = NOW()`,
        [`PUR-${p.kode}`, product.nama, product.deskripsi, categoryId, Number(product.harga_jual), Number(product.harga_modal), p.station, product.id]
      );
      targets[p.kode] = { kind: "product", id: product.id, outputType: "FINISHED_GOOD", warehouseId };
      console.log(`  ✓ ${p.kode} ${p.nama} @${p.outlet} — modal Rp ${modal.toLocaleString("id-ID")} / jual Rp ${p.jual.toLocaleString("id-ID")}`);
    }
    for (const r of RAW_MATERIAL_RECIPES) {
      targets[r.output] = { kind: "raw_material", id: materialMap.get(r.output).id, outputType: "WIP" };
    }

    // Contoh produksi
    const materialById = new Map([...materialMap.values()].map((m) => [m.id, m]));
    const old = await c.query(`SELECT id FROM manufacturing.production_orders WHERE nomor_produksi LIKE $1`, [`${DEMO_PREFIX}-%`]);
    const oldIds = old.rows.map((r) => r.id);
    await c.query(`DELETE FROM inventory.finished_goods_movements WHERE reference_number LIKE $1`, [`${DEMO_PREFIX}-%`]);
    if (oldIds.length) {
      await c.query(`DELETE FROM manufacturing.production_batches WHERE production_order_id = ANY($1::uuid[])`, [oldIds]);
      await c.query(`DELETE FROM manufacturing.production_order_materials WHERE production_order_id = ANY($1::uuid[])`, [oldIds]);
      await c.query(`DELETE FROM manufacturing.production_orders WHERE id = ANY($1::uuid[])`, [oldIds]);
    }

    for (const spec of DEMO_ORDERS) {
      const target = targets[spec.ref];
      if (!target) throw new Error(`Target produksi ${spec.ref} tidak ditemukan`);
      const isRaw = target.kind === "raw_material";
      const comps = await c.query(
        isRaw
          ? `SELECT component_raw_material_id AS raw_material_id, qty_required, waste_factor, satuan_id FROM manufacturing.raw_material_bom_items WHERE output_raw_material_id = $1 AND is_active`
          : `SELECT raw_material_id, qty_required, waste_factor, satuan_id FROM manufacturing.bom_items WHERE product_id = $1 AND is_active`,
        [target.id]
      );
      const materials = comps.rows.map((cmp) => {
        const m = materialById.get(cmp.raw_material_id);
        const qty = Number(cmp.qty_required) * (1 + Number(cmp.waste_factor || 0)) * spec.qty;
        const unitCost = m ? m.harga : 0;
        return { raw_material_id: cmp.raw_material_id, satuan_id: cmp.satuan_id, qty, unitCost, total: qty * unitCost };
      });
      const plannedMaterialCost = materials.reduce((s, x) => s + x.total, 0);
      const labor = spec.labor || 0, overhead = spec.overhead || 0, packaging = spec.packaging || 0;
      const totalCost = plannedMaterialCost + labor + overhead + packaging;
      const hpp = totalCost / spec.qty;
      const completed = spec.status === "COMPLETED";
      const at = daysAgo(spec.days_ago);
      const nomor = `${DEMO_PREFIX}-${String(spec.no).padStart(4, "0")}`;

      const ord = await c.query(
        `INSERT INTO manufacturing.production_orders
           (nomor_produksi, product_id, output_raw_material_id, production_context, output_type, company_id, branch_id,
            planned_qty, actual_qty, status, planned_material_cost, actual_material_cost, overhead_cost, labor_cost,
            packaging_cost, waste_cost, hpp_per_unit, catatan, started_at, completed_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,0,$16,$17,$18,$19,$20,$20) RETURNING id`,
        [nomor, isRaw ? null : target.id, isRaw ? target.id : null, isRaw ? "raw_material" : "product", target.outputType,
         scope.company_id, scope.branch_id, spec.qty, completed ? spec.qty : 0, spec.status, plannedMaterialCost,
         completed ? plannedMaterialCost : 0, overhead, labor, packaging, hpp, spec.catatan,
         completed || spec.status === "IN_PROGRESS" ? at : null, completed ? at : null, daysAgo(spec.days_ago + 1)]
      );
      const orderId = ord.rows[0].id;

      for (const mat of materials) {
        let movementId = null;
        if (completed) {
          const m = materialById.get(mat.raw_material_id);
          const inv = await c.query(`SELECT qty_available FROM inventory.inventory WHERE id = $1`, [m.inventoryId]);
          const before = Number(inv.rows[0].qty_available);
          const after = before - mat.qty;
          if (after < 0) throw new Error(`Stok ${m.kode} tidak cukup untuk ${nomor} (sisa ${before}, butuh ${Math.round(mat.qty)})`);
          const mv = await c.query(
            `INSERT INTO inventory.inventory_movements
               (inventory_id, raw_material_id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost, branch_id, warehouse_id, reference_type, reference_id, reference_number, alasan, is_active, created_at)
             VALUES ($1,$2,'out',$3,$4,$5,$6,$7,$8,$9,'production',$10,$11,$12,true,$13) RETURNING id`,
            [m.inventoryId, mat.raw_material_id, mat.qty, before, after, mat.unitCost, mat.total, scope.branch_id, mainWarehouse, orderId, nomor, `Pemakaian bahan ${nomor}`, at]
          );
          movementId = mv.rows[0].id;
          await c.query(`UPDATE inventory.inventory SET qty_available = $2, last_movement_at = $3, updated_at = NOW() WHERE id = $1`, [m.inventoryId, after, at]);
        }
        await c.query(
          `INSERT INTO manufacturing.production_order_materials
             (production_order_id, raw_material_id, satuan_id, qty_planned, qty_actual, waste_qty, unit_cost, total_cost, inventory_movement_id)
           VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8)`,
          [orderId, mat.raw_material_id, mat.satuan_id, mat.qty, mat.qty, mat.unitCost, mat.total, movementId]
        );
      }

      if (completed) {
        await c.query(
          `INSERT INTO manufacturing.production_batches
             (production_order_id, product_id, output_raw_material_id, output_type, wip_raw_material_id, batch_number, qty_produced, hpp_per_unit, total_cost, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'AVAILABLE',$10)`,
          [orderId, isRaw ? null : target.id, isRaw ? target.id : null, target.outputType,
           target.kind === "wip" ? target.wipMaterialId : null, `${nomor}-B01`, spec.qty, hpp, totalCost, at]
        );
        const outMat = target.kind === "wip" ? materialById.get(target.wipMaterialId) : isRaw ? materialById.get(target.id) : null;
        if (outMat) {
          const inv = await c.query(`SELECT qty_available, unit_cost FROM inventory.inventory WHERE id = $1`, [outMat.inventoryId]);
          const before = Number(inv.rows[0].qty_available);
          const after = before + spec.qty;
          const avg = after > 0 ? (before * Number(inv.rows[0].unit_cost) + totalCost) / after : hpp;
          await c.query(`UPDATE inventory.inventory SET qty_available = $2, unit_cost = $3, last_movement_at = $4, updated_at = NOW() WHERE id = $1`, [outMat.inventoryId, after, avg, at]);
          outMat.harga = avg;
          await c.query(
            `INSERT INTO inventory.inventory_movements
               (inventory_id, raw_material_id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost, branch_id, warehouse_id, reference_type, reference_id, reference_number, alasan, is_active, created_at)
             VALUES ($1,$2,'in',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14)`,
            [outMat.inventoryId, outMat.id, spec.qty, before, after, hpp, totalCost, scope.branch_id, mainWarehouse,
             isRaw ? "production_output" : "production_wip", orderId, nomor, `Hasil produksi ${nomor}`, at]
          );
        }
      }
      console.log(`  ✓ ${nomor} ${spec.status.padEnd(11)} ${spec.ref} × ${spec.qty} — HPP/unit Rp ${Math.round(hpp).toLocaleString("id-ID")}`);
    }

    await c.query("COMMIT");
    console.log(`\nSelesai bagian 2: ${materialMap.size} bahan, ${WIP_PRODUCTS.length} produk WIP, ${PRODUCTS.length} menu, ${DEMO_ORDERS.length} contoh produksi.`);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
