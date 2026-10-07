#!/usr/bin/env node
/**
 * Seeder TENANT DUSUN BAMBU — bagian 2: modul RESORT lengkap
 * (data lokal, owner 2026-09-06).
 *
 * Mengisi seluruh isi modul Resort untuk cabang Dusun Bambu Lembang: 6 tipe
 * kamar (Cabin Area & Kampung Layung) dengan 30 unit, 4 musim tarif, 45
 * reservasi lintas status −60 s.d. +45 hari, folio (kamar, extra bed, diskon,
 * F&B, aktivitas, laundry, denda, pembayaran), dan status housekeeping
 * campuran. Logika pembangkitan ada di lib/resort-demo.js supaya dipakai
 * bersama seeder venue lain.
 *
 * Prasyarat: npm run db:seed:dusun-bambu-business
 * Usage:     npm run db:seed:dusun-bambu-resort
 */

const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");
const { loadEnv, ensureScope } = require("./lib/dusun-bambu-scope");
const { seedResortDemo, defaultSeasons } = require("./lib/resort-demo");

// [code, nama, zona, dewasa, anak, extraBedMax, weekday, weekend, extraBedRate, fasilitas, unit]
const ROOM_TYPES = [
  ["CB-SGL", "Single Cabin", "Cabin Area", 4, 2, 1, 1_800_000, 2_300_000, 350_000,
    ["1 kamar tidur", "1 ruang keluarga", "2 kamar mandi", "Bonfire outdoor"], 5],
  ["CB-FAM", "Family Cabin", "Cabin Area", 6, 3, 2, 2_500_000, 3_200_000, 350_000,
    ["2 kamar tidur", "1 ruang keluarga", "1 kamar mandi", "Bonfire outdoor"], 4],
  ["CB-DBL", "Double Cabin", "Cabin Area", 8, 4, 2, 3_200_000, 4_000_000, 350_000,
    ["2 kamar tidur", "2 ruang keluarga", "2 kamar mandi", "Bonfire outdoor"], 3],
  ["KL-VLG", "Village Residence", "Kampung Layung", 2, 1, 1, 2_200_000, 2_900_000, 400_000,
    ["1 kamar tidur", "Ruang keluarga", "Pantry", "Bonfire", "Hot tub"], 8],
  ["KL-DLX", "Deluxe Residence", "Kampung Layung", 4, 2, 1, 2_800_000, 3_600_000, 400_000,
    ["1 kamar tidur", "Ruang keluarga", "Pantry", "Bonfire", "Hot tub privat"], 6],
  ["KL-FAM", "Family Residence", "Kampung Layung", 6, 3, 2, 3_500_000, 4_500_000, 400_000,
    ["2 kamar tidur", "Ruang keluarga", "Pantry", "Bonfire", "Hot tub privat"], 4],
];

const FNB = [
  ["Makan malam Purbasari (nasi liwet + gurame)", 480_000],
  ["Sarapan Lembur Urang", 220_000],
  ["Besek piknik Lutung Kasarung", 470_000],
  ["Bandrek & bajigur di kamar", 116_000],
  ["Steak & pasta Burangrang", 273_000],
  ["Bebek Kabayan 2 porsi", 194_000],
];
const ACTIVITIES = [
  ["Sewa sepeda listrik 2 jam", 150_000],
  ["Berkuda keliling taman (2 orang)", 100_000],
  ["Tiket Bandung Playground (2 anak)", 100_000],
  ["Wahana danau — sampan (4 orang)", 120_000],
  ["Sesi panahan keluarga", 160_000],
];

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
    console.log(`Venue resort: ${scope.company_name} / ${scope.branch_name}`);
    const result = await seedResortDemo(c, {
      scope,
      roomTypes: ROOM_TYPES,
      seasons: defaultSeasons(new Date().getFullYear(), "KL-VLG"),
      codePrefix: "RSV-DB",
      seed: 20260906,
      fnbItems: FNB,
      activities: ACTIVITIES,
      log: console.log,
    });
    await c.query("COMMIT");
    console.log(`\nSelesai. ${result.reservasi} reservasi (${result.menginap} sedang menginap) di ${result.kamar} kamar, ${result.folio} baris folio, nilai Rp ${Math.round(result.nilai).toLocaleString("id-ID")}.`);
    console.log("Buka Resort → Front Office / Reservasi sebagai user cabang Dusun Bambu (demo@dusunbambu.id).");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
