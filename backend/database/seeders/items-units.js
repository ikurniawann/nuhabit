#!/usr/bin/env node
/**
 * Seeder: item.units — satuan umum operasional restoran / F&B.
 *
 * Idempotent (upsert by kode).
 *
 * Usage:
 *   node database/seeders/items-units.js
 *   npm run db:seed:items-units
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

/** Satuan standar restoran: berat, volume, kemasan, dan takaran dapur. */
const UNITS = [
  // Berat
  { kode: "KG", nama: "Kilogram", tipe: "BESAR", deskripsi: "Satuan berat utama (daging, tepung, gula)" },
  { kode: "GR", nama: "Gram", tipe: "KECIL", deskripsi: "Satuan berat kecil (bumbu, rempah)" },
  { kode: "MG", nama: "Miligram", tipe: "KECIL", deskripsi: "Takaran sangat kecil (pewarna, ragi)" },
  { kode: "TON", nama: "Ton", tipe: "BESAR", deskripsi: "Pengadaan bahan baku skala besar" },
  // Volume
  { kode: "L", nama: "Liter", tipe: "BESAR", deskripsi: "Cairan masak (minyak, susu, kaldu)" },
  { kode: "ML", nama: "Mililiter", tipe: "KECIL", deskripsi: "Cairan takaran kecil (ekstrak, sirup)" },
  // Kemasan beli / stok
  { kode: "PCS", nama: "Pieces", tipe: "KECIL", deskripsi: "Per buah atau per unit" },
  { kode: "BOX", nama: "Box", tipe: "BESAR", deskripsi: "Kemasan box dari supplier" },
  { kode: "PACK", nama: "Pack", tipe: "BESAR", deskripsi: "Kemasan pack (tissue, sedotan, dll.)" },
  { kode: "BTL", nama: "Botol", tipe: "BESAR", deskripsi: "Kemasan botol (minuman, saus)" },
  { kode: "CAN", nama: "Kaleng", tipe: "BESAR", deskripsi: "Kemasan kaleng (susu, krim, minuman)" },
  { kode: "DOS", nama: "Dus", tipe: "BESAR", deskripsi: "Kemasan dus dari distributor" },
  { kode: "CTN", nama: "Karton", tipe: "KONVERSI", deskripsi: "Karton — konversi dari box/pack" },
  { kode: "SACK", nama: "Karung", tipe: "BESAR", deskripsi: "Karung (beras, tepung, gula pasir)" },
  { kode: "BKS", nama: "Bungkus", tipe: "KECIL", deskripsi: "Bungkus kecil (tepung instan, bumbu)" },
  { kode: "SACHET", nama: "Sachet", tipe: "KECIL", deskripsi: "Sachet saus, bumbu, atau gula" },
  { kode: "BAG", nama: "Bag", tipe: "BESAR", deskripsi: "Kantong besar (es batu, sampah, dll.)" },
  { kode: "ROLL", nama: "Roll", tipe: "BESAR", deskripsi: "Roll plastik wrap, aluminium foil" },
  // Produksi & sajian
  { kode: "PORSI", nama: "Porsi", tipe: "KECIL", deskripsi: "Porsi sajian menu" },
  { kode: "SLICE", nama: "Slice", tipe: "KECIL", deskripsi: "Irisan (roti, keju, daging)" },
  { kode: "BUTIR", nama: "Butir", tipe: "KECIL", deskripsi: "Butir telur atau biji" },
  { kode: "IKAT", nama: "Ikat", tipe: "BESAR", deskripsi: "Ikat sayuran segar" },
  { kode: "LBR", nama: "Lembar", tipe: "KECIL", deskripsi: "Lembar (roti tawar, nori, pastry)" },
  { kode: "CUP", nama: "Cup", tipe: "KECIL", deskripsi: "Cup sajian atau kemasan takeaway" },
  { kode: "TRAY", nama: "Tray", tipe: "BESAR", deskripsi: "Tray pastry / baking sheet" },
  // Takaran dapur
  { kode: "TSP", nama: "Sendok Teh", tipe: "KECIL", deskripsi: "Takaran sendok teh (resep)" },
  { kode: "TBSP", nama: "Sendok Makan", tipe: "KECIL", deskripsi: "Takaran sendok makan (resep)" },
  { kode: "OZ", nama: "Ounce", tipe: "KECIL", deskripsi: "Takaran internasional (minuman, sirup bar)" },
  { kode: "GAL", nama: "Galon", tipe: "BESAR", deskripsi: "Galon air minum / cairan curah" },
];

async function upsertUnit(c, companyId, { kode, nama, tipe, deskripsi }) {
  await c.query(
    `INSERT INTO item.units (kode, nama, tipe, deskripsi, company_id, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     ON CONFLICT (company_id, kode) WHERE company_id IS NOT NULL AND deleted_at IS NULL DO UPDATE
       SET nama = EXCLUDED.nama,
           tipe = EXCLUDED.tipe,
           deskripsi = EXCLUDED.deskripsi,
           is_active = true,
           deleted_at = NULL,
           updated_at = NOW()`,
    [kode, nama, tipe, deskripsi, companyId]
  );
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

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();

  try {
    await c.query("BEGIN");

    const scope = await resolveSeedBusinessScope(c);
    console.log(`Seeding item.units (${scope.company_name})...`);
    for (const unit of UNITS) {
      await upsertUnit(c, scope.company_id, unit);
      console.log(`  ✓ ${unit.kode} — ${unit.nama} (${unit.tipe})`);
    }

    await c.query("COMMIT");
    console.log(`\nItems units selesai: ${UNITS.length} satuan`);
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
