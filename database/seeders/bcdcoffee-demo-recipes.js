#!/usr/bin/env node
/**
 * Seeder demo Resep / BOM BCD Coffee — penghubung produk jadi ke bahan baku.
 *
 * Bukan sekadar pelengkap. Halaman stok bahan baku memakai view
 * v_raw_materials_stock_by_warehouse saat pengguna sedang berada di satu stall,
 * dan view itu menentukan bahan baku milik sebuah stall LEWAT RESEP:
 *     bom_items → products → products.warehouse_id
 * Tanpa resep, daftar bahan baku per stall kosong sama sekali meskipun stoknya
 * ada — dan pemakaian bahan tidak bisa ditelusuri dari penjualan.
 *
 * Takaran ditulis dalam SATUAN KECIL bahan (gram, ml, pcs) sesuai konversi di
 * master bahan baku.
 *
 * Idempotent: resep tiap produk ditulis ulang utuh setiap dijalankan.
 *
 * Usage:
 *   node database/seeders/bcdcoffee-demo-recipes.js
 *   npm run db:seed:bcdcoffee-recipes
 */

const { runSeeder } = require("./lib/bcdcoffee-demo");

/**
 * Resep per produk: kodeProduk → [[kodeBahan, qty, waste%], ...]
 * qty dalam satuan kecil bahan (gram / ml / pcs / butir).
 */
const RECIPES = {
  "BCD-KOPI-SUSU": [
    ["BCD-KOP-005", 18, 3],   // house blend 18 gr per shot
    ["BCD-DAI-002", 150, 2],  // fresh milk 150 ml
    ["BCD-SIR-004", 20, 0],   // gula aren 20 ml
    ["BCD-KER-004", 120, 5],  // es batu 120 gr
    ["BCD-KEM-003", 1, 1],    // plastic cup 16oz
    ["BCD-KEM-005", 1, 1],    // lid dingin
    ["BCD-KEM-006", 1, 1],    // sedotan
  ],
  "BCD-ES-TEH": [
    ["BCD-TEH-001", 5, 2],
    ["BCD-SIR-006", 25, 0],
    ["BCD-KER-004", 150, 5],
    ["BCD-KEM-003", 1, 1],
    ["BCD-KEM-005", 1, 1],
    ["BCD-KEM-006", 1, 1],
  ],
  "BCD-JUS-ALPUKAT": [
    ["BCD-DPR-005", 180, 8],  // alpukat 180 gr, susut kulit & biji
    ["BCD-DAI-005", 40, 0],   // SKM 40 gr
    ["BCD-DAI-001", 80, 2],   // susu UHT 80 ml
    ["BCD-KER-004", 100, 5],
    ["BCD-KEM-003", 1, 1],
    ["BCD-KEM-005", 1, 1],
    ["BCD-KEM-006", 1, 1],
  ],
  "BCD-NASI-GORENG": [
    ["BCD-DPR-001", 200, 3],  // beras 200 gr
    ["BCD-DPR-003", 60, 5],   // ayam fillet 60 gr
    ["BCD-DAI-009", 1, 2],    // telur 1 butir
    ["BCD-DPR-006", 20, 0],   // minyak 20 ml
    ["BCD-DPR-007", 15, 8],   // bawang merah
    ["BCD-DPR-008", 10, 8],   // bawang putih
    ["BCD-DPR-009", 8, 8],    // cabai
    ["BCD-DPR-010", 15, 0],   // kecap manis
    ["BCD-KER-003", 3, 0],    // garam
  ],
  "BCD-MIE-GORENG": [
    ["BCD-DPR-002", 1, 2],    // 1 pack mie
    ["BCD-DPR-003", 50, 5],
    ["BCD-DAI-009", 1, 2],
    ["BCD-DPR-006", 20, 0],
    ["BCD-DPR-007", 12, 8],
    ["BCD-DPR-008", 8, 8],
    ["BCD-DPR-010", 15, 0],
    ["BCD-KER-003", 3, 0],
  ],
  "BCD-AYAM-BAKAR": [
    ["BCD-DPR-003", 200, 6],
    ["BCD-DPR-001", 150, 3],  // nasi pendamping
    ["BCD-DPR-010", 25, 0],
    ["BCD-DPR-008", 10, 8],
    ["BCD-DPR-009", 10, 8],
    ["BCD-KER-003", 4, 0],
    ["BCD-BAR-001", 0.02, 0], // pemakaian gas per porsi (kg)
  ],
  "BCD-KENTANG-GORENG": [
    ["BCD-DPR-004", 150, 4],
    ["BCD-DPR-006", 30, 0],
    ["BCD-KER-003", 2, 0],
    ["BCD-KEM-011", 1, 1],
  ],
  "BCD-ROTI-BAKAR": [
    ["BCD-BAK-002", 2, 2],    // 2 lembar roti tawar
    ["BCD-DAI-008", 20, 2],   // butter
    ["BCD-BAK-004", 30, 0],   // selai cokelat
    ["BCD-KEM-011", 1, 1],
  ],
};

runSeeder("Seeding demo Resep (BOM)", async (c, scope) => {
  const { rows: products } = await c.query(
    `SELECT id, kode, nama FROM item.products
     WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR company_id = $1)`,
    [scope.company_id]
  );
  const productByKode = new Map(products.map((p) => [p.kode, p]));

  const { rows: materials } = await c.query(
    `SELECT id, kode, nama, satuan_kecil_id FROM item.raw_materials
     WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR company_id = $1)`,
    [scope.company_id]
  );
  const materialByKode = new Map(materials.map((m) => [m.kode, m]));

  let lines = 0;
  let recipes = 0;
  const missing = [];

  for (const [produkKode, bahan] of Object.entries(RECIPES)) {
    const produk = productByKode.get(produkKode);
    if (!produk) {
      missing.push(`produk ${produkKode}`);
      continue;
    }
    // Tulis ulang utuh supaya perubahan takaran tercermin, bukan menumpuk.
    await c.query(`DELETE FROM manufacturing.bom_items WHERE product_id = $1`, [produk.id]);

    let written = 0;
    for (const [bahanKode, qty, waste] of bahan) {
      const m = materialByKode.get(bahanKode);
      if (!m) {
        missing.push(`bahan ${bahanKode} (resep ${produkKode})`);
        continue;
      }
      await c.query(
        `INSERT INTO manufacturing.bom_items
           (product_id, raw_material_id, qty_required, satuan_id, waste_factor, is_active)
         VALUES ($1,$2,$3,$4,$5,true)`,
        [produk.id, m.id, qty, m.satuan_kecil_id, waste]
      );
      written += 1;
      lines += 1;
    }
    recipes += 1;
    console.log(`  ✓ ${produkKode} — ${produk.nama}: ${written} bahan`);
  }

  if (missing.length > 0) {
    // Resep menggantung membuat perhitungan pemakaian salah diam-diam.
    throw new Error(`Referensi tidak ditemukan: ${missing.join(", ")}`);
  }

  // Verifikasi lewat view yang dipakai aplikasi: bahan baku harus muncul per stall.
  const { rows: perStall } = await c.query(
    `SELECT w.name AS stall, count(*)::int AS bahan
     FROM public.v_raw_materials_stock_by_warehouse v
     JOIN configuration.warehouses w ON w.id = v.warehouse_id
     GROUP BY w.name ORDER BY w.name`
  );
  if (perStall.length === 0) {
    throw new Error("Bahan baku per stall masih kosong setelah resep dibuat.");
  }
  for (const r of perStall) console.log(`  ✓ stall ${r.stall}: ${r.bahan} bahan baku terhubung resep`);

  return { resep: recipes, "baris bahan": lines };
});
