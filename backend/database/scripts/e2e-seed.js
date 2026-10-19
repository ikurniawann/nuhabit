#!/usr/bin/env node
/**
 * Seeder: throwaway accounts and data for the Playwright suite (frontend/e2e).
 *
 * Fills, idempotently and in one transaction:
 *   - staff  : auth.users + configuration.users + iam.user_roles (super_admin)
 *              + hris.employees, so the smoke spec can open every dashboard page
 *   - member : pos.pos_customers with a bcrypt password for the member portal
 *   - credits: tops the member up to E2E_MEMBER_CREDITS (default 20) with an
 *              adjustment lot that covers every class type
 *   - promo  : code E2E_PROMO_CODE (default E2E10, 10% off) on the shop channel
 *              of the default CRM venue, skipped when that venue is not set
 *   - shop   : one web product (sku E2E-TEE-001), only when the web channel
 *              has no product yet, so a fresh CI database can check out
 *
 * Credentials come from env and are never printed:
 *   E2E_STAFF_EMAIL (default e2e-staff@nuhabit.test), E2E_STAFF_PASSWORD (required)
 *   E2E_MEMBER_USERNAME (default e2e-member@nuhabit.test; an email or a phone)
 *   E2E_MEMBER_PHONE (default 089990000001), E2E_MEMBER_PASSWORD (required)
 *
 * Refuses a database that is not localhost/127.0.0.1 unless E2E_ALLOW_SEED=1.
 *
 * Usage (from backend/database):
 *   E2E_STAFF_PASSWORD=... E2E_MEMBER_PASSWORD=... node scripts/e2e-seed.js
 */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { sslForUrl, isLocalDatabaseUrl } = require("./pg-utils");

const ROOT = path.join(__dirname, "..", "..");

// shell env > .env.local > .env, like the other seeders.
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

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`ERROR: set ${name}; the e2e seed never invents passwords.`);
  return value;
}

async function seedStaff(c, email, password) {
  const hash = await bcrypt.hash(password, 10);
  const userMeta = JSON.stringify({ role: "super_admin", full_name: "E2E Staff" });
  const appMeta = JSON.stringify({ role: "super_admin" });
  const existing = await c.query("SELECT id FROM auth.users WHERE lower(email) = lower($1)", [email]);
  let userId;
  if (existing.rowCount) {
    userId = existing.rows[0].id;
    await c.query(
      `UPDATE auth.users SET password_hash = $1, email_verified_at = NOW(), banned_until = NULL,
              raw_user_meta_data = $2::jsonb, raw_app_meta_data = $3::jsonb
        WHERE id = $4`,
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
    `INSERT INTO configuration.users (id, full_name, role, email, status)
     VALUES ($1, 'E2E Staff', 'super_admin', $2, 'active')
     ON CONFLICT (id) DO UPDATE
       SET full_name = EXCLUDED.full_name, role = 'super_admin', email = EXCLUDED.email, status = 'active',
           business_scope = NULL, holding_id = NULL, company_id = NULL, branch_id = NULL, updated_at = NOW()`,
    [userId, email]
  );
  const role = await c.query(
    `INSERT INTO iam.roles (code, name, description, is_system, is_active)
     VALUES ('super_admin', 'Super Admin', 'Akses penuh ke seluruh sistem', true, true)
     ON CONFLICT (code) DO UPDATE SET is_active = true
     RETURNING id`
  );
  await c.query(
    `INSERT INTO iam.user_roles (user_id, role_id, is_primary) VALUES ($1, $2, true)
     ON CONFLICT (user_id, role_id) DO UPDATE SET is_primary = true`,
    [userId, role.rows[0].id]
  );
  const emp = await c.query("SELECT id FROM hris.employees WHERE user_id = $1 OR lower(email) = lower($2) LIMIT 1", [
    userId,
    email,
  ]);
  if (emp.rowCount) {
    await c.query(
      `UPDATE hris.employees SET user_id = $1, full_name = 'E2E Staff', email = $2,
              is_active = true, is_access_app = true, updated_at = NOW()
        WHERE id = $3`,
      [userId, email, emp.rows[0].id]
    );
  } else {
    await c.query(
      `INSERT INTO hris.employees (user_id, full_name, nip, email, phone, join_date, employment_status, is_active, is_access_app)
       VALUES ($1, 'E2E Staff', 'E2E-STAFF', $2, '-', CURRENT_DATE, 'permanent', true, true)`,
      [userId, email]
    );
  }
  console.log("staff   : ok", email);
}

async function seedMember(c, username, phone, password) {
  const email = username.includes("@") ? username.toLowerCase() : null;
  const memberPhone = email ? phone : username;
  const hash = await bcrypt.hash(password, 10);
  const existing = await c.query(
    `SELECT id FROM pos.pos_customers
      WHERE ($1::text IS NOT NULL AND lower(email) = $1) OR phone = $2
      ORDER BY (lower(COALESCE(email, '')) = COALESCE($1, '')) DESC LIMIT 1`,
    [email, memberPhone]
  );
  let id;
  if (existing.rowCount) {
    id = existing.rows[0].id;
    await c.query(
      `UPDATE pos.pos_customers SET name = 'E2E Member', email = COALESCE($1, email), phone = $2,
              password_hash = $3, is_active = true, updated_at = now()
        WHERE id = $4`,
      [email, memberPhone, hash, id]
    );
  } else {
    const ins = await c.query(
      `INSERT INTO pos.pos_customers (phone, name, email, password_hash, is_active, member_type)
       VALUES ($1, 'E2E Member', $2, $3, true, 'registered') RETURNING id`,
      [memberPhone, email, hash]
    );
    id = ins.rows[0].id;
  }
  console.log("member  : ok", username);
  return id;
}

/** Tops the balance up to `target` credits; a no-op when the member already has them. */
async function seedCredits(c, customerId, target) {
  const { rows } = await c.query(
    `SELECT COALESCE(SUM(amount), 0)::int AS balance FROM gym.credit_ledger WHERE customer_id = $1`,
    [customerId]
  );
  const missing = target - rows[0].balance;
  if (missing <= 0) {
    console.log("credits : ok, balance", rows[0].balance);
    return;
  }
  const lot = await c.query(
    `INSERT INTO gym.credit_lots (customer_id, credits, expires_at)
     VALUES ($1, $2, now() + interval '365 days') RETURNING id`,
    [customerId, missing]
  );
  await c.query(
    `INSERT INTO gym.credit_ledger (customer_id, type, amount, lot_id, source_type, note, idempotency_key)
     VALUES ($1, 'adjustment', $2, $3, 'admin', 'E2E seed top-up', $4)`,
    [customerId, missing, lot.rows[0].id, `e2e-seed:${customerId}:${Date.now()}`]
  );
  console.log("credits : topped up by", missing, "to", target);
}

/**
 * The default CRM venue owns shop promo codes. A fresh database has none, so
 * the oldest active branch becomes the venue; a configured venue stays.
 */
async function defaultVenue(c) {
  const venue = await c.query(
    `SELECT max(CASE WHEN key = 'default_company_id' THEN value #>> '{}' END) AS company_id,
            max(CASE WHEN key = 'default_branch_id' THEN value #>> '{}' END) AS branch_id
       FROM crm.crm_settings WHERE key IN ('default_company_id', 'default_branch_id')`
  );
  if (venue.rows[0].company_id && venue.rows[0].branch_id) return venue.rows[0];
  const branch = await c.query(
    `SELECT company_id::text, id::text AS branch_id FROM configuration.branches
      WHERE is_active AND company_id IS NOT NULL ORDER BY created_at LIMIT 1`
  );
  if (!branch.rowCount) return null;
  const { company_id: companyId, branch_id: branchId } = branch.rows[0];
  await c.query(
    `INSERT INTO crm.crm_settings (key, value) VALUES ('default_company_id', to_jsonb($1::text)), ('default_branch_id', to_jsonb($2::text))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [companyId, branchId]
  );
  console.log("venue   : default CRM venue set to branch", branchId);
  return branch.rows[0];
}

async function seedPromo(c, code) {
  const venue = await defaultVenue(c);
  if (!venue) {
    console.log("promo   : skipped, no active branch to own the code");
    return;
  }
  const { company_id: companyId, branch_id: branchId } = venue;
  const name = "E2E 10% off";
  const found = await c.query(`SELECT id FROM promo.promo_campaigns WHERE branch_id = $1 AND name = $2 LIMIT 1`, [
    branchId,
    name,
  ]);
  let campaignId;
  if (found.rowCount) {
    campaignId = found.rows[0].id;
    await c.query(
      `UPDATE promo.promo_campaigns SET is_active = true, valid_from = NULL, valid_until = NULL,
              usage_limit = NULL, per_phone_limit = NULL, updated_at = now()
        WHERE id = $1`,
      [campaignId]
    );
  } else {
    const ins = await c.query(
      `INSERT INTO promo.promo_campaigns (company_id, branch_id, name, discount_type, value, scope, per_phone_limit)
       VALUES ($1, $2, $3, 'percent', 10, 'semua', NULL) RETURNING id`,
      [companyId, branchId, name]
    );
    campaignId = ins.rows[0].id;
  }
  await c.query(
    `INSERT INTO promo.promo_codes (company_id, branch_id, campaign_id, code) VALUES ($1, $2, $3, $4)
     ON CONFLICT (branch_id, code) DO UPDATE SET campaign_id = EXCLUDED.campaign_id, is_active = true,
       usage_limit = NULL, updated_at = now()`,
    [companyId, branchId, campaignId, code]
  );
  console.log("promo   : ok", code);
}

async function seedShopProduct(c) {
  const { rowCount } = await c.query(
    `SELECT 1 FROM shop.product_channels pc JOIN pos.pos_products p ON p.id = pc.product_id
      WHERE pc.channel_code = 'web' AND pc.is_distributed AND p.is_active AND p.is_available
        AND p.product_kind = 'merchandise' LIMIT 1`
  );
  if (rowCount) {
    console.log("shop    : ok, the web channel already has products");
    return;
  }
  const product = await c.query(
    `INSERT INTO pos.pos_products (sku, name, description, base_price, product_kind, station, inventory_quantity, is_active, is_available)
     VALUES ('E2E-TEE-001', 'E2E Training Tee', 'Product for the end-to-end suite.', 150000, 'merchandise', 'merchandise', 1000, true, true)
     ON CONFLICT (sku) DO UPDATE SET is_active = true, is_available = true, inventory_quantity = 1000, updated_at = now()
     RETURNING id`
  );
  await c.query(
    `INSERT INTO shop.product_channels (product_id, channel_code, is_distributed) VALUES ($1, 'web', true)
     ON CONFLICT (product_id, channel_code) DO UPDATE SET is_distributed = true, updated_at = now()`,
    [product.rows[0].id]
  );
  console.log("shop    : added E2E-TEE-001 to the web channel");
}

async function main() {
  loadEnv();
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("ERROR: set MIGRATE_DATABASE_URL or DATABASE_URL");
  if (!isLocalDatabaseUrl(url) && process.env.E2E_ALLOW_SEED !== "1") {
    throw new Error("REFUSED: the e2e seed only runs on localhost/127.0.0.1; set E2E_ALLOW_SEED=1 to override.");
  }
  const staffEmail = process.env.E2E_STAFF_EMAIL || "e2e-staff@nuhabit.test";
  const staffPassword = required("E2E_STAFF_PASSWORD");
  const memberUsername = process.env.E2E_MEMBER_USERNAME || "e2e-member@nuhabit.test";
  const memberPhone = process.env.E2E_MEMBER_PHONE || "089990000001";
  const memberPassword = required("E2E_MEMBER_PASSWORD");
  const credits = Number(process.env.E2E_MEMBER_CREDITS || 20);
  const promoCode = (process.env.E2E_PROMO_CODE || "E2E10").toUpperCase();

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    await c.query("BEGIN");
    await seedStaff(c, staffEmail, staffPassword);
    const customerId = await seedMember(c, memberUsername, memberPhone, memberPassword);
    await seedCredits(c, customerId, credits);
    await seedPromo(c, promoCode);
    await seedShopProduct(c);
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await c.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
