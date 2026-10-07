/**
 * Boilerplate bersama untuk seeder demo BCD Coffee.
 *
 * Seeder lama menyalin loadEnv() dan pembukaan koneksi di tiap berkas. Berkas
 * ini memusatkannya supaya seeder baru hanya berisi datanya saja.
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../../scripts/pg-utils");
const { resolveSeedBusinessScope } = require("../../scripts/items-business-scope");

const ROOT = path.join(__dirname, "..", "..", "..");

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

/** Tanggal relatif hari ini (YYYY-MM-DD) — data demo ikut bergerak, tidak basi. */
function dayFrom(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Bungkus satu seeder: muat env, jaga agar target lokal, buka transaksi,
 * resolve scope bisnis, jalankan `run`, commit. Error apa pun → ROLLBACK.
 */
async function runSeeder(label, run) {
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
    console.log(`${label} — ${scope.company_name} / ${scope.branch_name}`);
    const summary = await run(c, scope);
    await c.query("COMMIT");
    if (summary) {
      console.log(
        "\nSelesai: " +
          Object.entries(summary)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ")
      );
    }
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

/** Stall aktif pertama pada cabang; dipakai seeder yang butuh warehouse. */
async function firstStall(c, branchId) {
  const { rows } = await c.query(
    `SELECT id, code, name FROM configuration.warehouses
     WHERE branch_id = $1 AND is_active ORDER BY created_at LIMIT 1`,
    [branchId]
  );
  return rows[0] ?? null;
}

/** Satu user untuk kolom created_by/owner — super admin pertama. */
async function anyAdmin(c) {
  const { rows } = await c.query(
    `SELECT id, full_name, email FROM configuration.users
     WHERE role = 'super_admin' AND status = 'active' ORDER BY created_at LIMIT 1`
  );
  return rows[0] ?? null;
}

module.exports = { loadEnv, dayFrom, runSeeder, firstStall, anyAdmin };
