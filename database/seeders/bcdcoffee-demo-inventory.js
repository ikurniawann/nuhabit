#!/usr/bin/env node
/**
 * Seeder demo Inventory BCD Coffee: stok bahan baku & produk jadi,
 * lengkap dengan riwayat pergerakan.
 *
 * Seeder bahan baku sebelumnya hanya mengisi DATA MASTER, sehingga semua item
 * tampil "Stok Habis" dan kartu stok kosong. Berkas ini mengisi sumber stok
 * yang benar-benar dibaca aplikasi:
 *   - bahan baku  → inventory.inventory   (dibaca v_raw_materials_stock)
 *   - produk jadi → inventory.finished_goods_inventory (v_finished_goods_stock)
 * beserta tabel pergerakannya masing-masing.
 *
 * Sebaran stok sengaja dibuat campur — aman, menipis, dan habis — supaya
 * indikator dan peringatan stok benar-benar terlihat bekerja, bukan seragam.
 *
 * Riwayat pergerakan dibangun berurutan (qty_before → qty_after) dan berakhir
 * tepat pada stok akhir, jadi kartu stok bisa ditelusuri dan tidak kontradiktif.
 *
 * Deterministik: profil tiap item diturunkan dari kodenya, jadi dijalankan
 * ulang menghasilkan angka yang sama persis.
 *
 * Usage:
 *   node database/seeders/bcdcoffee-demo-inventory.js
 *   npm run db:seed:bcdcoffee-inventory
 */

const { runSeeder, firstStall, anyAdmin } = require("./lib/bcdcoffee-demo");

/** Hash stabil dari string — dasar semua variasi angka di seeder ini. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const RAK = ["A", "B", "C", "D"];

/**
 * Profil stok per item. Proporsi dipilih agar dashboard menampilkan ketiga
 * status sekaligus: mayoritas aman, sebagian menipis, sedikit habis.
 */
function profileFor(kode) {
  const n = hash(kode) % 100;
  if (n < 15) return "HABIS";
  if (n < 40) return "MENIPIS";
  return "AMAN";
}

/** Stok akhir yang dituju, relatif terhadap batas minimum/maksimum item. */
function targetQty(kode, min, max) {
  const profile = profileFor(kode);
  const h = hash(kode + "q");
  if (profile === "HABIS") return 0;
  if (profile === "MENIPIS") {
    // Di bawah atau tepat di minimum, tapi masih ada barangnya.
    const q = Math.max(1, Math.round(min * (0.3 + (h % 60) / 100)));
    return Math.min(q, Math.max(1, min));
  }
  const span = Math.max(max - min, min || 1);
  return Math.round(min + span * (0.35 + (h % 50) / 100));
}

function dayAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

/**
 * Rangkaian pergerakan yang berakhir tepat di `target`.
 * Cerita: stok awal masuk → terpakai → restock → terpakai → koreksi opname.
 * Nilai apa pun tidak pernah membuat stok negatif.
 */
function buildMovements(kode, target, unitCost) {
  const h = hash(kode + "m");
  const restock1 = Math.max(target + (h % 7) + 3, 5);
  const pakai1 = Math.max(1, Math.round(restock1 * 0.35));
  const restock2 = Math.max(1, Math.round(restock1 * 0.4));
  const pakai2 = Math.max(1, Math.round((restock1 - pakai1 + restock2) * 0.3));

  const steps = [
    { tipe: "in", jumlah: restock1, hari: 26, ref: "grn", nomor: "DEMO-GRN-0001", alasan: "Penerimaan awal dari supplier" },
    { tipe: "out", jumlah: pakai1, hari: 19, ref: "production_wip", nomor: "DEMO-PROD-0001", alasan: "Pemakaian produksi harian" },
    { tipe: "in", jumlah: restock2, hari: 12, ref: "grn", nomor: "DEMO-GRN-0002", alasan: "Restock mingguan" },
    { tipe: "out", jumlah: pakai2, hari: 5, ref: "production_wip", nomor: "DEMO-PROD-0002", alasan: "Pemakaian produksi harian" },
  ];

  const out = [];
  let qty = 0;
  for (const s of steps) {
    const delta = s.tipe === "in" ? s.jumlah : -Math.min(s.jumlah, qty);
    if (delta === 0) continue;
    const before = qty;
    qty += delta;
    out.push({ ...s, jumlah: Math.abs(delta), qty_before: before, qty_after: qty, unit_cost: unitCost });
  }

  // Koreksi opname menutup selisih ke stok akhir yang dituju.
  if (qty !== target) {
    const before = qty;
    out.push({
      tipe: "adjustment",
      jumlah: Math.abs(target - before),
      qty_before: before,
      qty_after: target,
      unit_cost: unitCost,
      hari: 2,
      ref: "stock_opname",
      nomor: "DEMO-OPN-0001",
      alasan: target > before ? "Koreksi opname: temuan lebih" : "Koreksi opname: susut & rusak",
    });
    qty = target;
  }
  return out;
}

runSeeder("Seeding demo Inventory", async (c, scope) => {
  const admin = await anyAdmin(c);
  const stall = await firstStall(c, scope.branch_id);
  if (!stall) throw new Error("Belum ada stall aktif — jalankan seeder stall dulu.");
  const by = admin?.id ?? null;

  // ── Bahan baku ────────────────────────────────────────────────────────────
  const { rows: materials } = await c.query(
    `SELECT id, kode, nama, stok_minimum, stok_maximum, harga_beli
     FROM item.raw_materials
     WHERE deleted_at IS NULL AND is_active
       AND ($1::uuid IS NULL OR company_id = $1)
     ORDER BY kode`,
    [scope.company_id]
  );

  const tally = { AMAN: 0, MENIPIS: 0, HABIS: 0 };
  let movementCount = 0;

  for (const m of materials) {
    const min = Number(m.stok_minimum) || 0;
    const max = Number(m.stok_maximum) || min * 4;
    const unitCost = Number(m.harga_beli) || 0;
    const target = targetQty(m.kode, min, max);
    tally[profileFor(m.kode)] += 1;

    const rak = `${RAK[hash(m.kode) % RAK.length]}-${String((hash(m.kode + "r") % 20) + 1).padStart(2, "0")}`;

    const { rows: invRows } = await c.query(
      `INSERT INTO inventory.inventory
         (raw_material_id, qty_available, qty_on_order, qty_minimum, qty_maximum, unit_cost,
          lokasi_rak, last_movement_at, is_active, branch_id, warehouse_id, created_by)
       VALUES ($1,$2,0,$3,$4,$5,$6,$7::timestamptz,true,$8,$9,$10)
       ON CONFLICT (raw_material_id,
                    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET
         qty_available = EXCLUDED.qty_available,
         qty_minimum = EXCLUDED.qty_minimum,
         qty_maximum = EXCLUDED.qty_maximum,
         unit_cost = EXCLUDED.unit_cost,
         lokasi_rak = EXCLUDED.lokasi_rak,
         last_movement_at = EXCLUDED.last_movement_at,
         is_active = true,
         updated_at = NOW()
       RETURNING id`,
      [m.id, target, min, max, unitCost, rak, dayAgo(2), scope.branch_id, stall.id, by]
    );
    const invId = invRows[0].id;

    // Riwayat ditulis ulang tiap jalan supaya tidak menumpuk saat re-run.
    await c.query(
      `DELETE FROM inventory.inventory_movements
       WHERE inventory_id = $1 AND reference_number LIKE 'DEMO-%'`,
      [invId]
    );
    for (const mv of buildMovements(m.kode, target, unitCost)) {
      await c.query(
        `INSERT INTO inventory.inventory_movements
           (inventory_id, raw_material_id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost,
            reference_type, reference_number, alasan, is_active, branch_id, warehouse_id, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13,$14,$15::timestamptz)`,
        [invId, m.id, mv.tipe, mv.jumlah, mv.qty_before, mv.qty_after, mv.unit_cost,
         Math.round(mv.jumlah * mv.unit_cost), mv.ref, mv.nomor, mv.alasan,
         scope.branch_id, stall.id, by, dayAgo(mv.hari)]
      );
      movementCount += 1;
    }
  }
  console.log(
    `  ✓ bahan baku ${materials.length} (aman ${tally.AMAN}, menipis ${tally.MENIPIS}, habis ${tally.HABIS})`
  );

  // ── Produk jadi ───────────────────────────────────────────────────────────
  // Satuan diisi bila kosong supaya kolom satuan di laporan tidak kosong.
  const { rows: unitRows } = await c.query(
    `SELECT id FROM item.units WHERE kode = 'PORSI' AND company_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [scope.company_id]
  );
  if (unitRows[0]) {
    await c.query(
      `UPDATE item.products SET satuan_id = $1, updated_at = NOW()
       WHERE satuan_id IS NULL AND deleted_at IS NULL AND ($2::uuid IS NULL OR company_id = $2)`,
      [unitRows[0].id, scope.company_id]
    );
  }

  const { rows: products } = await c.query(
    `SELECT id, kode, nama, harga_modal FROM item.products
     WHERE deleted_at IS NULL AND is_active AND ($1::uuid IS NULL OR company_id = $1)
     ORDER BY kode`,
    [scope.company_id]
  );

  let productMovements = 0;
  for (const p of products) {
    const unitCost = Number(p.harga_modal) || 0;
    // Produk jadi umumnya disiapkan harian: kuantitas kecil, selalu ada isinya.
    const target = 12 + (hash(p.kode) % 40);

    const { rows: fgRows } = await c.query(
      `INSERT INTO inventory.finished_goods_inventory
         (product_id, qty_available, unit_cost, last_movement_at, is_active, created_by)
       VALUES ($1,$2,$3,$4::timestamptz,true,$5)
       ON CONFLICT (product_id) DO UPDATE SET
         qty_available = EXCLUDED.qty_available,
         unit_cost = EXCLUDED.unit_cost,
         last_movement_at = EXCLUDED.last_movement_at,
         is_active = true,
         updated_at = NOW()
       RETURNING id`,
      [p.id, target, unitCost, dayAgo(1), by]
    );
    const fgId = fgRows[0].id;

    await c.query(
      `DELETE FROM inventory.finished_goods_movements
       WHERE inventory_id = $1 AND reference_number LIKE 'DEMO-%'`,
      [fgId]
    );
    for (const mv of buildMovements(p.kode, target, unitCost)) {
      await c.query(
        `INSERT INTO inventory.finished_goods_movements
           (inventory_id, product_id, warehouse_id, branch_id, tipe, jumlah, qty_before, qty_after,
            unit_cost, total_cost, reference_type, reference_number, alasan, is_active, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$15::timestamptz)`,
        [fgId, p.id, stall.id, scope.branch_id, mv.tipe, mv.jumlah, mv.qty_before, mv.qty_after,
         mv.unit_cost, Math.round(mv.jumlah * mv.unit_cost), mv.ref, mv.nomor, mv.alasan, by,
         dayAgo(mv.hari)]
      );
      productMovements += 1;
    }
  }
  console.log(`  ✓ produk jadi ${products.length} (stok harian 12–51 porsi)`);

  // ── Verifikasi lewat view yang dipakai aplikasi, bukan asumsi ─────────────
  const { rows: check } = await c.query(
    `SELECT status_stok, count(*)::int AS n FROM public.v_raw_materials_stock
     WHERE deleted_at IS NULL GROUP BY status_stok ORDER BY status_stok`
  );
  const status = Object.fromEntries(check.map((r) => [r.status_stok, r.n]));
  if (!status.AMAN || !status.MENIPIS) {
    throw new Error(`Sebaran status stok tidak beragam: ${JSON.stringify(status)}`);
  }

  // Rantai pergerakan harus nyambung: qty_after langkah n = qty_before langkah n+1.
  const { rows: broken } = await c.query(
    `SELECT mv.reference_number, count(*)::int AS n FROM (
       SELECT inventory_id, qty_after,
              lead(qty_before) OVER (PARTITION BY inventory_id ORDER BY created_at, id) AS next_before,
              reference_number
       FROM inventory.inventory_movements WHERE reference_number LIKE 'DEMO-%'
     ) mv
     WHERE mv.next_before IS NOT NULL AND mv.next_before <> mv.qty_after
     GROUP BY mv.reference_number`
  );
  if (broken.length > 0) throw new Error(`Rantai pergerakan putus: ${JSON.stringify(broken)}`);

  const { rows: val } = await c.query(
    `SELECT to_char(COALESCE(sum(total_value), 0), 'FM999G999G999') AS nilai FROM public.v_raw_materials_stock WHERE deleted_at IS NULL`
  );

  return {
    "bahan baku": materials.length,
    "pergerakan bahan baku": movementCount,
    "produk jadi": products.length,
    "pergerakan produk": productMovements,
    "nilai persediaan": `Rp ${val[0].nilai}`,
  };
});
