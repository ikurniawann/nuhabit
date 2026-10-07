#!/usr/bin/env node
/**
 * Seeder: Super Admin (account + employee + role).
 *
 * Mengisi (idempoten, satu transaksi):
 *   - auth.users            : identitas login (email + password bcrypt)
 *   - configuration.users   : profil app (role super_admin)
 *   - iam.roles             : role sistem "super_admin" (jika belum ada)
 *   - iam.user_roles        : assignment user -> role (primary)
 *   - hris.employees        : data karyawan, terhubung via user_id, is_access_app
 *
 * Kredensial lewat env: SUPER_USER_EMAIL, SUPER_USER_PASSWORD, SUPER_USER_NAME.
 * Tanpa SUPER_USER_PASSWORD, seeder membuat password acak dan mencetaknya sekali.
 *
 * Usage:
 *   node database/seeders/super-admin.js
 *   npm run db:seed:super-admin
 */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");
const { seedPassword, passwordSource } = require("./lib/seed-password");

const ROOT = path.join(__dirname, "..", "..");

// --- env loader (shell env > .env.local > .env) -----------------------------
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

  // Dibaca setelah loadEnv() supaya nilai di .env / .env.local ikut terpakai.
  const EMAIL = process.env.SUPER_USER_EMAIL || "super@arkivworld.com";
  const PASSWORD = seedPassword("SUPER_USER_PASSWORD");
  const FULL_NAME = process.env.SUPER_USER_NAME || "Super Admin";
  const NIP = process.env.SUPER_USER_NIP || "SUPERADMIN";
  const PHONE = process.env.SUPER_USER_PHONE || "-";

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();

  try {
    await c.query("BEGIN");

    const hash = await bcrypt.hash(PASSWORD, 10);
    const userMeta = JSON.stringify({ role: "super_admin", full_name: FULL_NAME });
    const appMeta = JSON.stringify({ role: "super_admin" });

    // 1) auth.users
    const existing = await c.query(
      "SELECT id FROM auth.users WHERE lower(email) = lower($1)",
      [EMAIL]
    );
    let userId;
    if (existing.rowCount) {
      userId = existing.rows[0].id;
      await c.query(
        `UPDATE auth.users
           SET password_hash = $1, email_verified_at = NOW(),
               raw_user_meta_data = $2::jsonb, raw_app_meta_data = $3::jsonb
         WHERE id = $4`,
        [hash, userMeta, appMeta, userId]
      );
      console.log("auth.users        : updated", userId);
    } else {
      const ins = await c.query(
        `INSERT INTO auth.users (email, password_hash, email_verified_at, raw_user_meta_data, raw_app_meta_data)
         VALUES ($1, $2, NOW(), $3::jsonb, $4::jsonb)
         RETURNING id`,
        [EMAIL, hash, userMeta, appMeta]
      );
      userId = ins.rows[0].id;
      console.log("auth.users        : created", userId);
    }

    // 2) configuration.users (profil app — super_admin tetap unscoped)
    await c.query(
      `INSERT INTO configuration.users (id, full_name, role, email, status)
       VALUES ($1, $2, 'super_admin', $3, 'active')
       ON CONFLICT (id) DO UPDATE
         SET full_name = EXCLUDED.full_name,
             role = 'super_admin',
             email = EXCLUDED.email,
             status = 'active',
             business_scope = NULL,
             holding_id = NULL,
             company_id = NULL,
             branch_id = NULL,
             updated_at = NOW()`,
      [userId, FULL_NAME, EMAIL]
    );
    console.log("configuration.users: ok");

    // 3) iam.roles (role sistem super_admin)
    const role = await c.query(
      `INSERT INTO iam.roles (code, name, description, is_system, is_active)
       VALUES ('super_admin', 'Super Admin', 'Akses penuh ke seluruh sistem', true, true)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, is_active = true
       RETURNING id`,
      []
    );
    const roleId = role.rows[0].id;
    console.log("iam.roles          : ok", roleId);

    // 4) iam.user_roles (assignment primary)
    await c.query(
      `INSERT INTO iam.user_roles (user_id, role_id, is_primary)
       VALUES ($1, $2, true)
       ON CONFLICT (user_id, role_id) DO UPDATE SET is_primary = true`,
      [userId, roleId]
    );
    console.log("iam.user_roles     : ok");

    // 5) hris.employees (data karyawan, terhubung ke user)
    const emp = await c.query(
      "SELECT id FROM hris.employees WHERE user_id = $1 OR lower(email) = lower($2) LIMIT 1",
      [userId, EMAIL]
    );
    if (emp.rowCount) {
      await c.query(
        `UPDATE hris.employees
           SET user_id = $1, full_name = $2, email = $3,
               is_active = true, is_access_app = true, updated_at = NOW()
         WHERE id = $4`,
        [userId, FULL_NAME, EMAIL, emp.rows[0].id]
      );
      console.log("hris.employees     : updated", emp.rows[0].id);
    } else {
      const insEmp = await c.query(
        `INSERT INTO hris.employees
           (user_id, full_name, nip, email, phone, join_date, employment_status, is_active, is_access_app)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'permanent', true, true)
         RETURNING id`,
        [userId, FULL_NAME, NIP, EMAIL, PHONE]
      );
      console.log("hris.employees     : created", insEmp.rows[0].id);
    }

    await c.query("COMMIT");
    console.log("\nSuper admin siap:");
    console.log("  Email   :", EMAIL);
    console.log("  Password:", passwordSource("SUPER_USER_PASSWORD"));
    console.log("  Role    : super_admin");
    console.log("  Scope   : unscoped (lihat semua)");
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
