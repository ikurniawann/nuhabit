#!/usr/bin/env node
/**
 * Seeder: petakan produk POS ke satu stall (warehouse).
 *
 * Kenapa perlu: pos.pos_products TIDAK punya kolom stall. Stall sebuah produk
 * diturunkan lewat rantai
 *     pos.pos_products.source_product_id → item.products.warehouse_id
 * (lihat src/lib/pos/pos-sell-stall-server.ts). Selama rantai itu kosong,
 * produk dianggap "tanpa stall" dan POS menolak memasukkannya ke transaksi
 * yang stall-nya aktif dengan pesan
 *     "Ada produk tanpa stall — tidak bisa digabung ke transaksi stall ini".
 *
 * Seeder ini membuat/menyegarkan baris katalog item.products untuk tiap produk
 * POS, menaruhnya di stall tujuan, lalu menautkan source_product_id.
 *
 * Idempotent: upsert per (company, branch, warehouse, kode). Aman dijalankan
 * ulang setelah menambah produk POS baru.
 *
 * Usage:
 *   node database/seeders/bcdcoffee-pos-product-stall.js              # stall default
 *   node database/seeders/bcdcoffee-pos-product-stall.js --stall=COFFEESHOP
 *   npm run db:seed:bcdcoffee-pos-stall
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

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** Stall tujuan: --stall=KODE, atau stall aktif pertama pada branch tsb. */
async function resolveTargetStall(c, branchId, wantedCode) {
  if (wantedCode) {
    const { rows } = await c.query(
      `SELECT id, code, name FROM configuration.warehouses
       WHERE branch_id = $1 AND is_active AND upper(code) = upper($2)`,
      [branchId, wantedCode]
    );
    if (!rows[0]) throw new Error(`Stall dengan kode "${wantedCode}" tidak ditemukan / tidak aktif.`);
    return rows[0];
  }
  const { rows } = await c.query(
    `SELECT id, code, name FROM configuration.warehouses
     WHERE branch_id = $1 AND is_active
     ORDER BY created_at
     LIMIT 1`,
    [branchId]
  );
  if (!rows[0]) {
    throw new Error("Belum ada stall aktif. Buat stall dulu di Pengaturan → Bisnis, atau jalankan seeder stall.");
  }
  return rows[0];
}

const UPSERT_PRODUCT_SQL = `
  INSERT INTO item.products
    (kode, nama, deskripsi, kategori, harga_jual, harga_modal, station,
     production_output_type, warehouse_id, company_id, branch_id, is_active)
  VALUES ($1, $2, $3, $4, $5, $6, $7, 'FINISHED_GOOD', $8, $9, $10, true)
  ON CONFLICT (
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    warehouse_id,
    kode
  ) WHERE deleted_at IS NULL
  DO UPDATE SET
    nama = EXCLUDED.nama,
    deskripsi = EXCLUDED.deskripsi,
    kategori = EXCLUDED.kategori,
    harga_jual = EXCLUDED.harga_jual,
    harga_modal = EXCLUDED.harga_modal,
    station = EXCLUDED.station,
    is_active = true,
    deleted_at = NULL,
    updated_at = NOW()
  RETURNING id
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
    const stall = await resolveTargetStall(c, scope.branch_id, argValue("stall"));

    const { rows: posProducts } = await c.query(
      `SELECT p.id, p.sku, p.name, p.description, p.base_price, p.cost_price, p.station,
              p.source_product_id, c.name AS kategori_nama
       FROM pos.pos_products p
       LEFT JOIN pos.pos_categories c ON c.id = p.category_id
       ORDER BY p.name`
    );

    // Kategori POS ikut dibawa ke katalog item supaya filter kategori di
    // halaman Stok Produk & laporan persediaan tidak kosong.
    const kategoriKode = new Map();
    for (const nama of [...new Set(posProducts.map((p) => p.kategori_nama).filter(Boolean))]) {
      const kode = nama.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
      await c.query(
        `INSERT INTO item.product_categories (code, nama, company_id, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (company_id, code) WHERE deleted_at IS NULL AND company_id IS NOT NULL
         DO UPDATE SET nama = EXCLUDED.nama, is_active = true, deleted_at = NULL, updated_at = NOW()`,
        [kode, nama, scope.company_id]
      );
      kategoriKode.set(nama, kode);
      console.log(`  ✓ kategori produk ${kode} — ${nama}`);
    }
    if (posProducts.length === 0) {
      console.log("Tidak ada produk POS untuk dipetakan.");
      await c.query("COMMIT");
      return;
    }

    console.log(`Memetakan ${posProducts.length} produk POS ke stall "${stall.name}" (${stall.code})...`);
    let linked = 0;
    let already = 0;
    for (const p of posProducts) {
      // Kode katalog mengikuti SKU POS supaya mudah ditelusuri dua arah.
      const kode = (p.sku || p.name).trim().slice(0, 50);
      const { rows } = await c.query(UPSERT_PRODUCT_SQL, [
        kode,
        p.name,
        p.description ?? null,
        kategoriKode.get(p.kategori_nama) ?? null,
        Number(p.base_price) || 0,
        Number(p.cost_price) || 0,
        p.station || "kitchen",
        stall.id,
        scope.company_id,
        scope.branch_id,
      ]);
      const itemId = rows[0].id;

      if (p.source_product_id === itemId) {
        already += 1;
      } else {
        await c.query(`UPDATE pos.pos_products SET source_product_id = $2, updated_at = NOW() WHERE id = $1`, [
          p.id,
          itemId,
        ]);
        linked += 1;
      }
      console.log(`  ✓ ${kode} — ${p.name} → ${stall.name}`);
    }

    // Verifikasi memakai rantai yang sama dengan aplikasi, bukan asumsi.
    const { rows: check } = await c.query(
      `SELECT count(*) FILTER (WHERE w.id IS NULL) AS tanpa_stall,
              count(*) AS total
       FROM pos.pos_products pp
       LEFT JOIN item.products ip ON ip.id = pp.source_product_id AND ip.deleted_at IS NULL
       LEFT JOIN configuration.warehouses w ON w.id = ip.warehouse_id`
    );
    if (Number(check[0].tanpa_stall) > 0) {
      throw new Error(
        `Masih ada ${check[0].tanpa_stall} produk POS tanpa stall setelah pemetaan — dibatalkan.`
      );
    }

    await c.query("COMMIT");
    console.log(
      `\nSelesai: ${check[0].total} produk POS bertaut stall "${stall.name}" ` +
        `(${linked} ditautkan, ${already} sudah benar).`
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
