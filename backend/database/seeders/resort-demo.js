#!/usr/bin/env node
/**
 * Seeder demo modul RESORT untuk **venue utama** (data lokal, owner
 * 2026-09-06).
 *
 * Modul Resort membaca venue dari scope bisnis user; super admin tidak
 * ber-scope sehingga jatuh ke default venue di CRM Settings
 * (`default_company_id` / `default_branch_id`). Seeder ini mengisi venue
 * itulah, supaya modul langsung terlihat saat login sebagai super admin —
 * berbeda dengan `dusun-bambu-resort.js` yang mengisi cabang tenant demo.
 *
 * Target bisa ditimpa lewat env:
 *   RESORT_COMPANY_CODE=SULU RESORT_BRANCH_CODE=SULU-DAGO npm run db:seed:resort-demo
 *
 * Isi: 5 tipe kamar (glamping & kabin) 24 unit, 4 musim tarif, ±45 reservasi
 * lintas status, folio lengkap, dan status housekeeping campuran.
 *
 * Usage: npm run db:seed:resort-demo
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");
const { seedResortDemo, defaultSeasons } = require("./lib/resort-demo");

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

// [code, nama, zona, dewasa, anak, extraBedMax, weekday, weekend, extraBedRate, fasilitas, unit]
const ROOM_TYPES = [
  ["GL-DOME", "Glamping Dome", "Glamping Field", 2, 1, 1, 850_000, 1_150_000, 200_000,
    ["Tenda dome ber-AC", "Kamar mandi dalam", "Teras pandang"], 6],
  ["GL-TENT", "Safari Tent Keluarga", "Glamping Field", 4, 2, 2, 1_250_000, 1_650_000, 250_000,
    ["2 tempat tidur queen", "Kamar mandi dalam", "Bonfire bersama"], 5],
  ["CB-STD", "Wooden Cabin", "Cabin Hill", 2, 1, 1, 1_100_000, 1_450_000, 250_000,
    ["1 kamar tidur", "Teras kayu", "Pemanas air"], 6],
  ["CB-FAM", "Family Cabin", "Cabin Hill", 5, 3, 2, 1_750_000, 2_250_000, 250_000,
    ["2 kamar tidur", "Ruang keluarga", "Dapur kecil", "Bonfire privat"], 4],
  ["LF-SUITE", "Loft Suite", "Lakeside", 4, 2, 1, 2_400_000, 3_100_000, 300_000,
    ["Loft dua lantai", "Bathtub", "Balkon menghadap danau"], 3],
];

async function resolveVenue(c) {
  const companyCode = process.env.RESORT_COMPANY_CODE;
  const branchCode = process.env.RESORT_BRANCH_CODE;
  if (companyCode && branchCode) {
    const { rows } = await c.query(
      `SELECT co.id AS company_id, b.id AS branch_id, co.name AS company_name, b.name AS branch_name
       FROM configuration.companies co JOIN configuration.branches b ON b.company_id = co.id
       WHERE co.code = $1 AND b.code = $2 LIMIT 1`,
      [companyCode, branchCode]
    );
    if (!rows[0]) throw new Error(`Venue ${companyCode} / ${branchCode} tidak ditemukan`);
    return rows[0];
  }
  // Default venue CRM — persis yang dibaca modul saat user tanpa scope (super admin)
  const { rows } = await c.query(
    `SELECT key, value FROM crm.crm_settings WHERE key IN ('default_company_id', 'default_branch_id')`
  );
  const val = (k) => {
    const raw = rows.find((r) => r.key === k)?.value;
    return typeof raw === "string" ? raw : raw == null ? null : String(raw).replace(/"/g, "");
  };
  const companyId = val("default_company_id");
  const branchId = val("default_branch_id");
  if (!companyId || !branchId) {
    throw new Error("default_company_id / default_branch_id belum diisi di crm.crm_settings — set dulu atau pakai RESORT_COMPANY_CODE & RESORT_BRANCH_CODE");
  }
  const venue = await c.query(
    `SELECT co.id AS company_id, b.id AS branch_id, co.name AS company_name, b.name AS branch_name
     FROM configuration.companies co JOIN configuration.branches b ON b.company_id = co.id
     WHERE co.id = $1 AND b.id = $2 LIMIT 1`,
    [companyId, branchId]
  );
  if (!venue.rows[0]) throw new Error("Default venue CRM menunjuk perusahaan/cabang yang tidak ada");
  return venue.rows[0];
}

async function main() {
  loadEnv();
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) { console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL"); process.exit(1); }
  try { assertLocalTarget(url, "MIGRATE_DATABASE_URL"); } catch (err) { console.error(err.message); process.exit(1); }

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    await c.query("BEGIN");
    const scope = await resolveVenue(c);
    console.log(`Venue resort: ${scope.company_name} / ${scope.branch_name}`);
    const result = await seedResortDemo(c, {
      scope,
      roomTypes: ROOM_TYPES,
      seasons: defaultSeasons(new Date().getFullYear(), "GL-DOME"),
      codePrefix: "RSV-SW",
      seed: 20260907,
      log: console.log,
    });
    await c.query("COMMIT");
    console.log(`\nSelesai. ${result.reservasi} reservasi (${result.menginap} sedang menginap) di ${result.kamar} kamar, ${result.folio} baris folio, nilai Rp ${Math.round(result.nilai).toLocaleString("id-ID")}.`);
    console.log("Buka Resort → Front Office / Reservasi (super admin memakai venue ini).");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
