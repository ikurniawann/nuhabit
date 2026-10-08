#!/usr/bin/env node
/**
 * Seeder: password login portal member untuk member DEMO.
 *
 * Login portal member memverifikasi password (bcrypt) terhadap
 * pos.pos_customers.password_hash. Member demo (nomor 081200000001–24) belum
 * punya password, jadi tanpa seeder ini mereka tidak bisa masuk.
 *
 *   Password: MEMBER_DEMO_PASSWORD, atau acak (dicetak SEKALI) bila kosong
 *   Sifat   : idempoten — hanya mengisi password_hash yang masih NULL, jadi
 *             menjalankan ulang TIDAK mengganti password yang sudah diset
 *             (member asli tidak akan tertimpa).
 *
 * Usage:
 *   node database/seeders/member-portal-passwords.js
 */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");
const { seedPassword, passwordSource } = require("./lib/seed-password");

const ROOT = path.join(__dirname, "..", "..");

/** Rentang nomor member demo (081200000001–081200000024). */
const DEMO_PHONE_PATTERN = "^0812000000[0-9]{2}$";

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
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!shellKeys.has(k)) process.env[k] = v;
    }
  }
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

  const password = seedPassword("MEMBER_DEMO_PASSWORD");
  const hash = bcrypt.hashSync(password, 10);

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query(
      `UPDATE pos.pos_customers
          SET password_hash = $1, updated_at = now()
        WHERE password_hash IS NULL
          AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') ~ $2
        RETURNING phone, name`,
      [hash, DEMO_PHONE_PATTERN]
    );
    const missing = await c.query(
      `SELECT count(*)::int AS n FROM pos.pos_customers WHERE password_hash IS NULL`
    );
    await c.query("COMMIT");

    console.log(`Member demo diberi password: ${rows.length}`);
    for (const row of rows.sort((a, b) => a.phone.localeCompare(b.phone))) {
      console.log(`  ${row.phone}  ${row.name ?? "-"}`);
    }
    if (missing.rows[0].n > 0) {
      console.log(
        `\nCatatan: ${missing.rows[0].n} member lain masih TANPA password ` +
          "(bukan rentang demo) — akun itu belum bisa login password."
      );
    }
    console.log("\nLogin portal member siap:");
    console.log("  Username: nomor WhatsApp atau email member di atas");
    console.log("  Password:", passwordSource("MEMBER_DEMO_PASSWORD"));
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
