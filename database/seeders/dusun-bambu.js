#!/usr/bin/env node
/**
 * Seeder TENANT DUSUN BAMBU — bagian 1: bisnis, outlet, departemen, modul
 * Resort, meja/saung POS, dan user demo (data lokal, owner 2026-09-06).
 *
 * Referensi profil: dusunbambu.id — destinasi keluarga 15 ha di kaki Gunung
 * Burangrang dengan 4 restoran bertema, resort (Cabin & Kampung Layung), dan
 * aktivitas keluarga (Bandung Playground, wahana danau).
 *
 * Mengisi (idempoten, satu transaksi, HANYA database lokal):
 *   - configuration.companies/branches/warehouses : Dusun Bambu → Lembang → 8 outlet
 *   - hris.departments                            : departemen khas resort/atraksi
 *   - pos.pos_tables                              : saung Purbasari, sarang Lutung Kasarung, meja Burangrang
 *   - auth.users + configuration.users            : demo@dusunbambu.id (scope cabang Dusun Bambu)
 *
 * Data modul Resort dibuat seeder terpisah (dusun-bambu-resort.js).
 *
 * Jalankan berurutan:
 *   npm run db:seed:dusun-bambu            (bagian 1 + resort + F&B + ticketing)
 */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");
const { seedPassword, passwordSource } = require("./lib/seed-password");
const {
  HOLDING_CODE, COMPANY_CODE, BRANCH_CODE, COMPANY_NAME, BRANCH_NAME, loadEnv, ensureScope,
} = require("./lib/dusun-bambu-scope");

const DEMO_EMAIL = process.env.DUSUN_BAMBU_EMAIL || "demo@dusunbambu.id";

// ── Outlet (gudang/lokasi jual) ────────────────────────────────────────────
const OUTLETS = [
  ["MAIN", "Main Storage", true],
  ["RESTO-BRG", "Burangrang Restaurant", false],
  ["RESTO-LMU", "Lembur Urang Restaurant", false],
  ["RESTO-PBS", "Purbasari Restaurant", false],
  ["RESTO-LTK", "Lutung Kasarung Restaurant", false],
  ["BEBEK-KBY", "Bebek Kabayan", false],
  ["PLAYGROUND", "Bandung Playground", false],
  ["RESORT-FO", "Resort Front Office", false],
];

const DEPARTMENTS = [
  ["RESORT-FO", "Resort & Front Office", "Reservasi, check-in/out, folio tamu menginap"],
  ["HOUSEKEEPING", "Housekeeping", "Kebersihan kamar, linen, area publik"],
  ["TICKETING", "Ticketing & Activity", "Loket, gate, wahana, Bandung Playground"],
  ["LANDSCAPE", "Landscape & Garden", "Taman, danau, kebun bunga"],
];

// ── Meja / saung POS ───────────────────────────────────────────────────────
const TABLES = [
  ...Array.from({ length: 10 }, (_, i) => [`DB-PBS-${String(i + 1).padStart(2, "0")}`, `Saung Purbasari ${i + 1}`, "Purbasari (lesehan tepi danau)", 8]),
  ...Array.from({ length: 6 }, (_, i) => [`DB-LTK-${String(i + 1).padStart(2, "0")}`, `Sarang Lutung ${i + 1}`, "Lutung Kasarung (sarang di pohon)", 4]),
  ...Array.from({ length: 8 }, (_, i) => [`DB-BRG-${String(i + 1).padStart(2, "0")}`, `Meja Burangrang ${i + 1}`, "Burangrang (indoor & meeting)", 6]),
];

async function seedOutlets(c, scope) {
  const ids = {};
  for (const [code, name, isDefault] of OUTLETS) {
    const { rows } = await c.query(
      `INSERT INTO configuration.warehouses (branch_id, code, name, is_default, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (branch_id, code) DO UPDATE
         SET name = EXCLUDED.name, is_default = EXCLUDED.is_default, is_active = true, updated_at = NOW()
       RETURNING id`,
      [scope.branch_id, code, name, isDefault]
    );
    ids[code] = rows[0].id;
  }
  return ids;
}

async function seedDepartments(c) {
  let added = 0;
  for (const [code, name, description] of DEPARTMENTS) {
    const { rowCount } = await c.query(
      `INSERT INTO hris.departments (name, code, description, is_active)
       SELECT $1, $2, $3, true
       WHERE NOT EXISTS (SELECT 1 FROM hris.departments WHERE lower(name) = lower($1))`,
      [name, code, description]
    );
    added += rowCount;
  }
  return added;
}

async function seedTables(c) {
  let count = 0;
  for (const [number, name, area, capacity] of TABLES) {
    await c.query(
      `INSERT INTO pos.pos_tables (table_number, name, area, capacity, status, is_active, notes)
       VALUES ($1, $2, $3, $4, 'available', true, 'Seeder Dusun Bambu')
       ON CONFLICT (table_number) DO UPDATE SET
         name = EXCLUDED.name, area = EXCLUDED.area, capacity = EXCLUDED.capacity,
         is_active = true, updated_at = NOW()`,
      [number, name, area, capacity]
    );
    count += 1;
  }
  return count;
}

async function seedDemoUser(c, scope, password) {
  const hash = await bcrypt.hash(password, 10);
  const userMeta = JSON.stringify({ full_name: "Demo Dusun Bambu", role: "admin" });
  const appMeta = JSON.stringify({ role: "admin", provider: "email" });
  const existing = await c.query(`SELECT id FROM auth.users WHERE lower(email) = lower($1)`, [DEMO_EMAIL]);
  let userId = existing.rows[0]?.id;
  if (userId) {
    await c.query(
      `UPDATE auth.users SET password_hash = $1, email_verified_at = NOW(),
         raw_user_meta_data = $2::jsonb, raw_app_meta_data = $3::jsonb WHERE id = $4`,
      [hash, userMeta, appMeta, userId]
    );
  } else {
    const ins = await c.query(
      `INSERT INTO auth.users (email, password_hash, email_verified_at, raw_user_meta_data, raw_app_meta_data)
       VALUES ($1, $2, NOW(), $3::jsonb, $4::jsonb) RETURNING id`,
      [DEMO_EMAIL, hash, userMeta, appMeta]
    );
    userId = ins.rows[0].id;
  }
  await c.query(
    `INSERT INTO configuration.users (id, full_name, role, email, status, business_scope, holding_id, company_id, branch_id)
     VALUES ($1, 'Demo Dusun Bambu', 'admin', $2, 'active', 'branch', $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       full_name = EXCLUDED.full_name, role = EXCLUDED.role, email = EXCLUDED.email, status = 'active',
       business_scope = 'branch', holding_id = EXCLUDED.holding_id, company_id = EXCLUDED.company_id,
       branch_id = EXCLUDED.branch_id, updated_at = NOW()`,
    [userId, DEMO_EMAIL, scope.holding_id, scope.company_id, scope.branch_id]
  );
  const role = await c.query(`SELECT id FROM iam.roles WHERE code = 'admin' AND deleted_at IS NULL LIMIT 1`);
  if (role.rows[0]) {
    await c.query(
      `INSERT INTO iam.user_roles (user_id, role_id, is_primary) VALUES ($1, $2, true)
       ON CONFLICT (user_id, role_id) DO UPDATE SET is_primary = true`,
      [userId, role.rows[0].id]
    );
  }
  return userId;
}

async function main() {
  loadEnv();
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) { console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL"); process.exit(1); }
  try { assertLocalTarget(url, "MIGRATE_DATABASE_URL"); } catch (err) { console.error(err.message); process.exit(1); }

  const password = seedPassword("DUSUN_BAMBU_PASSWORD");

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    await c.query("BEGIN");
    const scope = await ensureScope(c);
    console.log(`Tenant: ${HOLDING_CODE} → ${COMPANY_NAME} (${COMPANY_CODE}) → ${BRANCH_NAME} (${BRANCH_CODE})`);

    const outlets = await seedOutlets(c, scope);
    console.log(`✓ Outlet: ${Object.keys(outlets).length} lokasi (${OUTLETS.map((o) => o[0]).join(", ")})`);

    const deptAdded = await seedDepartments(c);
    console.log(`✓ Departemen: ${DEPARTMENTS.length} dicek, ${deptAdded} baru ditambahkan`);

    const tables = await seedTables(c);
    console.log(`✓ Meja & saung POS: ${tables} (Purbasari lesehan, sarang Lutung Kasarung, Burangrang)`);

    const demoUser = await seedDemoUser(c, scope, password);
    console.log(`✓ User demo: ${DEMO_EMAIL}, password ${passwordSource("DUSUN_BAMBU_PASSWORD")} (role admin, scope cabang ${BRANCH_NAME})`);

    await c.query("COMMIT");
    console.log(`\nSelesai bagian 1. User demo id ${demoUser}.`);
    console.log("Lanjutkan: npm run db:seed:dusun-bambu-resort && npm run db:seed:dusun-bambu-fnb && npm run db:seed:dusun-bambu-ticketing");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
