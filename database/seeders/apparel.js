#!/usr/bin/env node
/**
 * Seeder TENANT SULU-APPAREL — bagian 1: perusahaan, cabang, gudang produksi,
 * outlet toko, departemen HRIS, dan user demo (data lokal, owner 2026-09-09,
 * EPIC-047 Fase 0).
 *
 * Lini bisnis baru — produksi kaos, kemeja, celana, sandal, dan sepatu — di
 * bawah holding Prologe, terpisah dari company SULU (F&B) dan DUSUN-BAMBU.
 * Tidak ada kode aplikasi yang berubah di fase ini (seeder-only).
 *
 * Mengisi (idempoten, satu transaksi, HANYA database lokal):
 *   - configuration.companies/branches/warehouses : Sulu Apparel → Workshop →
 *     gudang produksi MAIN + outlet Workshop Store
 *   - hris.departments                            : Produksi & Jahit, Gudang & QC, Toko
 *   - auth.users + configuration.users            : demo@suluapparel.id (role admin, scope cabang)
 *                                                   apparel@arkivworld.com (role admin, scope COMPANY —
 *                                                   "super admin" Sulu Apparel: semua menu admin,
 *                                                   semua cabang apparel, tidak melihat company lain)
 *
 * Master item/produk dibuat seeder terpisah (apparel-items.js).
 *
 * Jalankan berurutan:
 *   npm run db:seed:apparel-business
 *   npm run db:seed:apparel-items
 *   (atau gabungan: npm run db:seed:apparel)
 */

const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const {
  HOLDING_CODE, COMPANY_CODE, BRANCH_CODE, COMPANY_NAME, BRANCH_NAME,
  sslForUrl, resolveDatabaseUrl, ensureScope,
} = require("./lib/apparel-scope");
const { seedPassword, passwordSource } = require("./lib/seed-password");

const DEMO_EMAIL = process.env.SULU_APPAREL_EMAIL || "demo@suluapparel.id";
// Akun pemilik Sulu Apparel: role `admin` (222/223 menu — hanya tanpa
// Notifikasi WA milik owner holding), business_scope `company` sehingga
// melihat seluruh cabang SULU-APPAREL tetapi bukan SULU (F&B) / DUSUN-BAMBU.
// Sengaja BUKAN role `super_admin`: role itu selalu unscoped (lihat
// src/lib/api/scope.ts → isUnscoped). Password dari env atau acak
// (lib/seed-password.js); hanya berlaku di database lokal.
const OWNER_EMAIL = process.env.SULU_APPAREL_OWNER_EMAIL || "apparel@arkivworld.com";

// ── Departemen HRIS (kode harus unik global — lihat hris.departments) ──────
const DEPARTMENTS = [
  ["SA-PRODUKSI", "Produksi & Jahit", "Potong kain, jahit, perakitan upper, dan lasting sepatu"],
  ["SA-GUDANG-QC", "Gudang & QC", "Penerimaan bahan baku, quality control, dan stok gudang produksi"],
  ["SA-TOKO", "Toko", "Penjualan Workshop Store & kasir POS"],
];

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

async function upsertAdminUser(c, scope, { email, password, fullName, businessScope, branchId }) {
  const hash = await bcrypt.hash(password, 10);
  const userMeta = JSON.stringify({ full_name: fullName, role: "admin" });
  const appMeta = JSON.stringify({ role: "admin", provider: "email" });
  const existing = await c.query(`SELECT id FROM auth.users WHERE lower(email) = lower($1)`, [email]);
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
      [email, hash, userMeta, appMeta]
    );
    userId = ins.rows[0].id;
  }
  await c.query(
    `INSERT INTO configuration.users (id, full_name, role, email, status, business_scope, holding_id, company_id, branch_id, default_warehouse_id)
     VALUES ($1, $2, 'admin', $3, 'active', $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       full_name = EXCLUDED.full_name, role = EXCLUDED.role, email = EXCLUDED.email, status = 'active',
       business_scope = EXCLUDED.business_scope, holding_id = EXCLUDED.holding_id, company_id = EXCLUDED.company_id,
       branch_id = EXCLUDED.branch_id, default_warehouse_id = EXCLUDED.default_warehouse_id, updated_at = NOW()`,
    [userId, fullName, email, businessScope, scope.holding_id, scope.company_id, branchId, scope.warehouse_main_id]
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

function seedDemoUser(c, scope, password) {
  return upsertAdminUser(c, scope, {
    email: DEMO_EMAIL,
    password,
    fullName: "Demo Sulu Apparel",
    businessScope: "branch",
    branchId: scope.branch_id,
  });
}

function seedOwnerUser(c, scope, password) {
  return upsertAdminUser(c, scope, {
    email: OWNER_EMAIL,
    password,
    fullName: "Admin Sulu Apparel",
    businessScope: "company",
    branchId: scope.branch_id, // cabang default; scope company tetap melihat semua cabang
  });
}

async function main() {
  let url;
  try {
    url = resolveDatabaseUrl();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const demoPassword = seedPassword("SULU_APPAREL_PASSWORD");
  const ownerPassword = seedPassword("SULU_APPAREL_OWNER_PASSWORD");

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    await c.query("BEGIN");
    const scope = await ensureScope(c);
    console.log(`Tenant: ${HOLDING_CODE} → ${COMPANY_NAME} (${COMPANY_CODE}) → ${BRANCH_NAME} (${BRANCH_CODE})`);
    console.log(`✓ Gudang produksi MAIN (${scope.warehouse_main_id}) + outlet Workshop Store (${scope.warehouse_store_id})`);

    const deptAdded = await seedDepartments(c);
    console.log(`✓ Departemen: ${DEPARTMENTS.length} dicek, ${deptAdded} baru ditambahkan`);

    const demoUser = await seedDemoUser(c, scope, demoPassword);
    console.log(`✓ User demo: ${DEMO_EMAIL}, password ${passwordSource("SULU_APPAREL_PASSWORD")} (role admin, scope cabang ${BRANCH_NAME})`);
    const ownerUser = await seedOwnerUser(c, scope, ownerPassword);
    console.log(`✓ User pemilik: ${OWNER_EMAIL}, password ${passwordSource("SULU_APPAREL_OWNER_PASSWORD")} (role admin, scope company ${COMPANY_CODE}) id ${ownerUser}`);

    await c.query("COMMIT");
    console.log(`\nSelesai bagian 1. User demo id ${demoUser}.`);
    console.log("Lanjutkan: npm run db:seed:apparel-items");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
