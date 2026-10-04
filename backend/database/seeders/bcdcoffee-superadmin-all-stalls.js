#!/usr/bin/env node
/**
 * Seeder: pastikan akun super admin bisa membuka POS di SEMUA stall.
 *
 * Temuan saat verifikasi: peran super_admin SUDAH lolos pemeriksaan izin stall
 * (isSellStallAllowed di src/lib/users/stall-assignment.ts) dan pemilih stall di
 * POS pun sudah terisi dari hak akses penuh itu — tanpa perlu baris penugasan
 * apa pun di configuration.user_warehouses.
 *
 * Yang justru MERUGIKAN adalah menambahkan penugasan stall untuk super admin:
 * getUser() memakai stall pertama yang ditugaskan sebagai stall bawaan saat
 * cookie kosong, sehingga seluruh dashboard terkunci ke satu stall. Efek
 * paling terasa di daftar bahan baku — mode per-stall hanya memuat bahan yang
 * dipakai resep produk stall tersebut (28 dari 66 bahan pada data demo ini).
 *
 * Karena itu seeder ini hanya menyalakan can_switch_stall dan TIDAK membuat
 * penugasan stall; super admin tetap berada di "Semua Stall" dan bebas memilih
 * stall mana pun saat membuka POS.
 *
 * Untuk akun NON super admin (mis. kasir), penugasan stall memang cara yang
 * benar untuk memberi akses — itu di luar cakupan seeder ini.
 *
 * Idempotent.
 *
 * Usage:
 *   node database/seeders/bcdcoffee-superadmin-all-stalls.js
 *   node database/seeders/bcdcoffee-superadmin-all-stalls.js --email=admin@bcdcoffee.id
 *   npm run db:seed:bcdcoffee-superadmin-stalls
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

    const { rows: stalls } = await c.query(
      `SELECT id, code, name FROM configuration.warehouses
       WHERE branch_id = $1 AND is_active
       ORDER BY created_at`,
      [scope.branch_id]
    );
    if (stalls.length === 0) throw new Error("Belum ada stall aktif pada cabang ini.");

    const email = argValue("email");
    const { rows: admins } = await c.query(
      `SELECT id, email, full_name
       FROM configuration.users
       WHERE role = 'super_admin'
         AND status = 'active'
         AND ($1::text IS NULL OR lower(email) = lower($1))
       ORDER BY created_at`,
      [email]
    );
    if (admins.length === 0) {
      throw new Error(email ? `Super admin "${email}" tidak ditemukan.` : "Tidak ada akun super_admin aktif.");
    }

    console.log(`Menyiapkan akses POS semua stall (${stalls.length}) untuk ${admins.length} super admin...`);
    for (const admin of admins) {
      await c.query(
        `UPDATE configuration.users
         SET can_switch_stall = true, updated_at = NOW()
         WHERE id = $1`,
        [admin.id]
      );
      // Penugasan stall untuk super admin dibersihkan: keberadaannya mengunci
      // dashboard ke satu stall tanpa menambah akses apa pun.
      const { rowCount } = await c.query(
        `DELETE FROM configuration.user_warehouses WHERE user_id = $1`,
        [admin.id]
      );
      console.log(
        `  ✓ ${admin.full_name} <${admin.email}> — bisa ganti stall` +
          (rowCount ? `, ${rowCount} penugasan lama dibersihkan` : "")
      );
    }

    const { rows: check } = await c.query(
      `SELECT u.email, u.can_switch_stall,
              (SELECT count(*) FROM configuration.user_warehouses uw WHERE uw.user_id = u.id) AS penugasan
       FROM configuration.users u
       WHERE u.role = 'super_admin' AND u.status = 'active'`
    );
    for (const row of check) {
      if (!row.can_switch_stall || Number(row.penugasan) > 0) {
        throw new Error(`Verifikasi gagal untuk ${row.email} — dibatalkan.`);
      }
    }

    await c.query("COMMIT");
    console.log(
      `\nSelesai: ${admins.length} super admin bisa membuka POS di semua stall (${stalls.length}), ` +
        `dan dashboard tetap di mode "Semua Stall".`
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
