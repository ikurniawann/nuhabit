#!/usr/bin/env node
/**
 * Seeder: Karyawan + akses aplikasi per stall (cabang Dago).
 *
 * Setiap stall mendapat 1 akun:
 *   Email   : <slug>@sulu.id
 *   Password: SULU_STALL_PASSWORD, atau acak (dicetak sekali) bila kosong
 *   Role    : purchasing_admin
 *   Approval: purchasing PR + PO sebagai approver
 *   Stall   : ditempatkan di warehouse masing-masing
 *
 * Usage:
 *   node database/seeders/sulu-stall-purchasing-users.js
 *   npm run db:seed:sulu-stall-purchasing
 */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");
const { seedPassword, passwordSource } = require("./lib/seed-password");

const ROOT = path.join(__dirname, "..", "..");

const EMAIL_DOMAIN = process.env.SULU_STALL_EMAIL_DOMAIN || "sulu.id";
const PROFILE_ROLE = "purchasing_admin";
const IAM_ROLE = "purchasing_admin";
const BRANCH_CODE = process.env.SULU_STALL_BRANCH_CODE || "SULU-DAGO";

/** Stall yang di-seed (nama harus cocok / akan di-upsert bila belum ada). */
const STALL_SEEDS = [
  { name: "Operasional", emailLocal: "operasional", codeHint: "WH-01", is_default: true },
  { name: "Yakitori Stall", emailLocal: "yakitori", codeHint: "STALL-02", is_default: false },
  { name: "Teppanyaki Stall", emailLocal: "teppanyaki", codeHint: "STALL-03", is_default: false },
  { name: "Dumpling Stall", emailLocal: "dumpling", codeHint: "STALL-04", is_default: false },
  { name: "Sushi - Sashimi Stall", emailLocal: "sushi", codeHint: "STALL-05", is_default: false },
  { name: "Bakery Stall", emailLocal: "bakery", codeHint: "STALL-06", is_default: false },
  { name: "Burger - sandwiches Stall", emailLocal: "burger", codeHint: "STALL-07", is_default: false },
  { name: "Agemono - Frying Section Stall", emailLocal: "agemono", codeHint: "STALL-08", is_default: false },
  { name: "Rice bowl Stall", emailLocal: "ricebowl", codeHint: "STALL-09", is_default: false },
  { name: "Ramen - Noodles Stall", emailLocal: "ramen", codeHint: "STALL-10", is_default: false },
  { name: "Udon - Noodles Stall", emailLocal: "udon", codeHint: "STALL-11", is_default: false },
  { name: "Japanese Poridge Stall", emailLocal: "okayu", codeHint: "STALL-12", is_default: false },
  { name: "Yakimono - Griiled Stall", emailLocal: "yakimono", codeHint: "STALL-13", is_default: false },
  { name: "Onigiri Corner Stall", emailLocal: "onigiri", codeHint: "STALL-14", is_default: false },
  { name: "Yokoco Beverage Stall", emailLocal: "yokoco", codeHint: "STALL-15", is_default: false },
  { name: "Sando Stall", emailLocal: "sando", codeHint: "STALL-16", is_default: false },
];

const APPROVAL_PERMS = [
  { module: "purchasing", workflow: "purchase_request", approval_level: "approver" },
  { module: "purchasing", workflow: "purchase_order", approval_level: "approver" },
];

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

async function resolveBranchScope(client) {
  const { rows } = await client.query(
    `SELECT h.id AS holding_id,
            c.id AS company_id,
            b.id AS branch_id,
            h.name AS holding_name,
            c.name AS company_name,
            b.name AS branch_name,
            b.code AS branch_code
     FROM configuration.branches b
     JOIN configuration.companies c ON c.id = b.company_id
     JOIN configuration.holdings h ON h.id = c.holding_id
     WHERE b.code = $1
     LIMIT 1`,
    [BRANCH_CODE]
  );
  return rows[0] ?? null;
}

async function ensureWarehouse(client, branchId, stall) {
  const byName = await client.query(
    `SELECT id, name, code, is_default
     FROM configuration.warehouses
     WHERE branch_id = $1
       AND lower(name) = lower($2)
     LIMIT 1`,
    [branchId, stall.name]
  );
  if (byName.rowCount) {
    await client.query(
      `UPDATE configuration.warehouses
       SET is_active = true, updated_at = NOW()
       WHERE id = $1`,
      [byName.rows[0].id]
    );
    return byName.rows[0];
  }

  const byCode = await client.query(
    `SELECT id, name, code, is_default
     FROM configuration.warehouses
     WHERE branch_id = $1 AND code = $2
     LIMIT 1`,
    [branchId, stall.codeHint]
  );
  if (byCode.rowCount) {
    await client.query(
      `UPDATE configuration.warehouses
       SET name = $1, is_active = true, updated_at = NOW()
       WHERE id = $2`,
      [stall.name, byCode.rows[0].id]
    );
    return { ...byCode.rows[0], name: stall.name };
  }

  const inserted = await client.query(
    `INSERT INTO configuration.warehouses (branch_id, name, code, is_default, is_active)
     VALUES ($1, $2, $3, $4, true)
     RETURNING id, name, code, is_default`,
    [branchId, stall.name, stall.codeHint, stall.is_default]
  );
  console.log(`  warehouse created : ${stall.name} (${stall.codeHint})`);
  return inserted.rows[0];
}

async function upsertAuthUser(client, { email, passwordHash, fullName }) {
  const userMeta = JSON.stringify({ role: PROFILE_ROLE, full_name: fullName });
  const appMeta = JSON.stringify({ role: PROFILE_ROLE });
  const existing = await client.query(
    `SELECT id FROM auth.users WHERE lower(email) = lower($1)`,
    [email]
  );

  if (existing.rowCount) {
    const userId = existing.rows[0].id;
    await client.query(
      `UPDATE auth.users
         SET password_hash = $1,
             email_verified_at = NOW(),
             banned_until = NULL,
             raw_user_meta_data = $2::jsonb,
             raw_app_meta_data = $3::jsonb,
             updated_at = NOW()
       WHERE id = $4`,
      [passwordHash, userMeta, appMeta, userId]
    );
    return { userId, created: false };
  }

  const inserted = await client.query(
    `INSERT INTO auth.users (email, password_hash, email_verified_at, raw_user_meta_data, raw_app_meta_data)
     VALUES ($1, $2, NOW(), $3::jsonb, $4::jsonb)
     RETURNING id`,
    [email, passwordHash, userMeta, appMeta]
  );
  return { userId: inserted.rows[0].id, created: true };
}

async function upsertConfigUser(client, { userId, fullName, email, scope }) {
  await client.query(
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
    [
      userId,
      fullName,
      PROFILE_ROLE,
      email,
      scope.holding_id,
      scope.company_id,
      scope.branch_id,
    ]
  );
}

async function upsertIamRole(client, userId, roleId) {
  await client.query(
    `DELETE FROM iam.user_roles ur
     USING iam.roles r
     WHERE ur.user_id = $1
       AND ur.role_id = r.id
       AND r.code = $2`,
    [userId, IAM_ROLE]
  );
  await client.query(
    `INSERT INTO iam.user_roles (user_id, role_id, is_primary)
     VALUES ($1, $2, true)
     ON CONFLICT (user_id, role_id) DO UPDATE SET is_primary = true`,
    [userId, roleId]
  );
}

async function upsertEmployee(client, { userId, fullName, email, nip, index }) {
  const phone = `0812${String(10000000 + index).slice(-8)}`;
  const existing = await client.query(
    `SELECT id FROM hris.employees
     WHERE user_id = $1 OR lower(email) = lower($2) OR nip = $3
     LIMIT 1`,
    [userId, email, nip]
  );

  if (existing.rowCount) {
    await client.query(
      `UPDATE hris.employees
         SET user_id = $1,
             full_name = $2,
             email = $3,
             nip = $4,
             phone = $5,
             is_active = true,
             is_access_app = true,
             employment_status = 'permanent',
             updated_at = NOW()
       WHERE id = $6`,
      [userId, fullName, email, nip, phone, existing.rows[0].id]
    );
    return { employeeId: existing.rows[0].id, created: false };
  }

  const inserted = await client.query(
    `INSERT INTO hris.employees
       (user_id, full_name, nip, email, phone, join_date, employment_status, is_active, is_access_app)
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'permanent', true, true)
     RETURNING id`,
    [userId, fullName, nip, email, phone]
  );
  return { employeeId: inserted.rows[0].id, created: true };
}

async function upsertWarehouseAssignment(client, userId, warehouseId) {
  await client.query(
    `UPDATE configuration.user_warehouses
     SET is_active = false, updated_at = NOW()
     WHERE user_id = $1 AND warehouse_id <> $2`,
    [userId, warehouseId]
  );
  await client.query(
    `INSERT INTO configuration.user_warehouses (user_id, warehouse_id, is_active)
     VALUES ($1, $2, true)
     ON CONFLICT (user_id, warehouse_id) DO UPDATE
       SET is_active = true, updated_at = NOW()`,
    [userId, warehouseId]
  );
}

async function upsertApprovalPermissions(client, userId) {
  for (const perm of APPROVAL_PERMS) {
    await client.query(
      `UPDATE configuration.user_approval_permissions
       SET is_active = false, updated_at = NOW()
       WHERE user_id = $1
         AND module = $2
         AND workflow = $3
         AND approval_level = $4
         AND is_active = true`,
      [userId, perm.module, perm.workflow, perm.approval_level]
    );
    await client.query(
      `INSERT INTO configuration.user_approval_permissions
         (user_id, module, workflow, approval_level, approval_limit, is_active)
       VALUES ($1, $2, $3, $4, NULL, true)`,
      [userId, perm.module, perm.workflow, perm.approval_level]
    );
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

  const password = seedPassword("SULU_STALL_PASSWORD");

  const client = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await client.connect();

  try {
    await client.query("BEGIN");

    const scope = await resolveBranchScope(client);
    if (!scope) {
      throw new Error(`Branch ${BRANCH_CODE} tidak ditemukan.`);
    }
    console.log(
      `Scope: ${scope.holding_name} → ${scope.company_name} → ${scope.branch_name} (${scope.branch_code})`
    );

    const iamRole = await client.query(
      `SELECT id FROM iam.roles WHERE code = $1 AND deleted_at IS NULL LIMIT 1`,
      [IAM_ROLE]
    );
    if (!iamRole.rowCount) {
      throw new Error(
        `IAM role "${IAM_ROLE}" belum ada. Jalankan npm run db:seed:iam-roles dulu.`
      );
    }
    const iamRoleId = iamRole.rows[0].id;

    const passwordHash = await bcrypt.hash(password, 10);
    const summary = [];

    for (let index = 0; index < STALL_SEEDS.length; index += 1) {
      const stall = STALL_SEEDS[index];
      const warehouse = await ensureWarehouse(client, scope.branch_id, stall);
      const email = `${stall.emailLocal}@${EMAIL_DOMAIN}`;
      const fullName = `Purchasing ${stall.name}`;
      const nip = `SULU-PA-${String(index + 1).padStart(2, "0")}`;

      const { userId, created: userCreated } = await upsertAuthUser(client, {
        email,
        passwordHash,
        fullName,
      });
      await upsertConfigUser(client, { userId, fullName, email, scope });
      await upsertIamRole(client, userId, iamRoleId);
      const { employeeId, created: empCreated } = await upsertEmployee(client, {
        userId,
        fullName,
        email,
        nip,
        index,
      });
      await upsertWarehouseAssignment(client, userId, warehouse.id);
      await upsertApprovalPermissions(client, userId);

      summary.push({
        email,
        stall: warehouse.name,
        code: warehouse.code,
        user: userCreated ? "created" : "updated",
        employee: empCreated ? "created" : "updated",
        employeeId,
      });
      console.log(
        `✓ ${email.padEnd(28)} → ${warehouse.name} (${warehouse.code}) [${userCreated ? "new" : "upd"}]`
      );
    }

    await client.query("COMMIT");

    console.log("\nSeeder selesai.");
    console.log(`  Password : ${passwordSource("SULU_STALL_PASSWORD")}`);
    console.log(`  Role     : ${PROFILE_ROLE}`);
    console.log("  Approval : purchasing PR + PO (approver)");
    console.log(`  Accounts : ${summary.length}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
