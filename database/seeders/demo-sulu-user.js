#!/usr/bin/env node
/**
 * Seeder: Demo user cabang Sulu Bandung (branch-scoped, bukan super_admin).
 *
 *   Email   : demo@sulu.id
 *   Password: DEMO_SULU_PASSWORD, atau acak (dicetak sekali) bila kosong
 *   Role    : purchasing_admin (API / auth metadata)
 *   Menus   : sulu_bandung_demo (IAM sidebar — Items + POS, tanpa Finance/Accounting/Laporan)
 *   Scope   : Prologe → Sulu → Sulu Bandung
 *
 * Usage:
 *   node database/seeders/demo-sulu-user.js
 *   npm run db:seed:demo-sulu
 */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");
const { seedPassword, passwordSource } = require("./lib/seed-password");

const ROOT = path.join(__dirname, "..", "..");

const EMAIL = process.env.DEMO_SULU_EMAIL || "demo@sulu.id";
const FULL_NAME = process.env.DEMO_SULU_NAME || "Demo Sulu Bandung";
const NIP = process.env.DEMO_SULU_NIP || "DEMOSULU";
const PHONE = process.env.DEMO_SULU_PHONE || "-";
/** Auth + API role (unchanged for purchasing module access). */
const PROFILE_ROLE = "purchasing_admin";
/** IAM sidebar role (see database/seeders/iam-role-permissions.sql). */
const MENU_ROLE = "sulu_bandung_demo";

const HOLDING_CODE = "PROLOGE";
const COMPANY_CODE = "SULU";
const BRANCH_CODE = "SULU-DAGO";

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

async function resolveBusinessScope(client) {
  const { rows } = await client.query(
    `SELECT h.id AS holding_id,
            c.id AS company_id,
            b.id AS branch_id,
            h.name AS holding_name,
            c.name AS company_name,
            b.name AS branch_name
     FROM configuration.holdings h
     JOIN configuration.companies c
       ON c.holding_id = h.id AND c.code = $2
     JOIN configuration.branches b
       ON b.company_id = c.id AND b.code = $3
     WHERE h.code = $1`,
    [HOLDING_CODE, COMPANY_CODE, BRANCH_CODE]
  );
  return rows[0] ?? null;
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

  const password = seedPassword("DEMO_SULU_PASSWORD");

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();

  try {
    await c.query("BEGIN");

    const scope = await resolveBusinessScope(c);
    if (!scope) {
      throw new Error(
        `Business scope tidak ditemukan (${HOLDING_CODE} / ${COMPANY_CODE} / ${BRANCH_CODE}).`
      );
    }

    const hash = await bcrypt.hash(password, 10);
    const userMeta = JSON.stringify({ role: PROFILE_ROLE, full_name: FULL_NAME });
    const appMeta = JSON.stringify({ role: PROFILE_ROLE });

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

    await c.query(
      `INSERT INTO configuration.users (
         id, full_name, role, email, status,
         business_scope, holding_id, company_id, branch_id
       )
       VALUES ($1, $2, $3, $4, 'active', 'branch', $5, $6, $7)
       ON CONFLICT (id) DO UPDATE
         SET full_name = EXCLUDED.full_name,
             role = EXCLUDED.role,
             email = EXCLUDED.email,
             status = 'active',
             business_scope = 'branch',
             holding_id = EXCLUDED.holding_id,
             company_id = EXCLUDED.company_id,
             branch_id = EXCLUDED.branch_id,
             updated_at = NOW()`,
      [userId, FULL_NAME, PROFILE_ROLE, EMAIL, scope.holding_id, scope.company_id, scope.branch_id]
    );
    console.log("configuration.users: ok");
    console.log(
      "  scope   :",
      `${scope.holding_name} → ${scope.company_name} → ${scope.branch_name}`
    );

    const menuRole = await c.query(
      `SELECT id FROM iam.roles WHERE code = $1 AND deleted_at IS NULL LIMIT 1`,
      [MENU_ROLE]
    );
    if (!menuRole.rowCount) {
      throw new Error(
        `IAM role "${MENU_ROLE}" belum ada. Jalankan npm run db:seed:iam-roles dulu.`
      );
    }
    const menuRoleId = menuRole.rows[0].id;

    await c.query(
      `DELETE FROM iam.user_roles ur
       USING iam.roles r
       WHERE ur.user_id = $1
         AND ur.role_id = r.id
         AND r.code IN ('purchasing_admin', 'sulu_bandung_demo', 'sulu_dago_demo')`,
      [userId]
    );

    await c.query(
      `INSERT INTO iam.user_roles (user_id, role_id, is_primary)
       VALUES ($1, $2, true)
       ON CONFLICT (user_id, role_id) DO UPDATE SET is_primary = true`,
      [userId, menuRoleId]
    );
    console.log("iam.user_roles     : ok (menu role:", MENU_ROLE + ")");

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
    console.log("\nDemo user siap:");
    console.log("  Email   :", EMAIL);
    console.log("  Password:", passwordSource("DEMO_SULU_PASSWORD"));
    console.log("  Role    :", PROFILE_ROLE, "(API)");
    console.log("  Menus   :", MENU_ROLE);
    console.log(
      "  Scope   :",
      `${scope.holding_name} / ${scope.company_name} / ${scope.branch_name}`
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
