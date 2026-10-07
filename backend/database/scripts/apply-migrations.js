#!/usr/bin/env node
/**
 * Apply migrasi dari database/migrations/ ke PostgreSQL target.
 *
 * Pakai library `pg` (tanpa psql). Setiap file dijalankan dalam satu transaksi
 * dan dicatat di tabel `schema_migrations`. File yang sudah diterapkan dilewati.
 *
 * Requires: DATABASE_URL (target) di .env / .env.local atau env var.
 *
 * Usage:
 *   node database/scripts/apply-migrations.js           # dry-run (read-only)
 *   node database/scripts/apply-migrations.js --apply   # eksekusi
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");
const { searchPathSchemas } = require("../schema-map");
const { sslForUrl, assertLocalTarget } = require("./pg-utils");

const ROOT = path.join(__dirname, "..", "..");
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR || path.join(ROOT, "database", "migrations");

// Precedence (ala Next.js): shell env > .env.local > .env
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

// Discovery rekursif: kumpulkan semua .sql (bootstrap/, schemas/<domain>/, deltas/, …).
// Urutan apply ditentukan oleh prefix 14-digit pada NAMA FILE (bukan path),
// sehingga reorganisasi ke subfolder tidak mengubah urutan. Tracking di
// schema_migrations memakai BASENAME (unik global) agar pemindahan file antar
// folder tidak memicu re-apply.
function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith(".sql")) out.push({ name: ent.name, full });
    }
  };
  walk(MIGRATIONS_DIR);

  const seen = new Set();
  const unique = [];
  for (const f of out) {
    if (seen.has(f.name)) {
      throw new Error(`Duplikat nama file migrasi: ${f.name} (basename harus unik)`);
    }
    seen.add(f.name);
    unique.push(f);
  }

  const prefix = (name) => {
    const m = name.match(/^(\d+)/);
    return m ? m[1] : name;
  };
  unique.sort((a, b) => {
    const pa = prefix(a.name);
    const pb = prefix(b.name);
    if (pa !== pb) return pa < pb ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return unique;
}

async function main() {
  loadEnv();
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: Set MIGRATE_DATABASE_URL (target Postgres lokal) di .env.local");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  const allowRemote = process.argv.includes("--allow-remote");
  const files = listMigrationFiles();
  if (files.length === 0) {
    console.error(`Tidak ada file migrasi di ${MIGRATIONS_DIR}`);
    console.error("Jalankan generate dulu: npm run db:pull");
    process.exit(1);
  }

  if (!allowRemote) {
    try {
      assertLocalTarget(url, "MIGRATE_DATABASE_URL");
    } catch (err) {
      console.error(err.message);
      console.error(
        "Untuk target remote (mis. server-sulu), tambahkan --allow-remote."
      );
      process.exit(1);
    }
  } else {
    console.warn(
      `[warn] --allow-remote: apply ke ${url.replace(/:[^:@/]+@/, ":****@")}`
    );
  }

  const client = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await client.connect();
  // Referensi tabel "bare" di FK/trigger/function resolve lewat search_path ini.
  await client.query(`SET search_path TO ${searchPathSchemas().join(", ")}`);

  // Dry-run = read-only: jangan buat tabel apa pun.
  let applied = new Set();
  const reg = await client.query("SELECT to_regclass('public.schema_migrations') AS t");
  const tableExists = reg.rows[0].t !== null;

  if (apply && !tableExists) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checksum   TEXT
      );
    `);
  }
  if (tableExists || apply) {
    const { rows } = await client.query(
      "SELECT filename FROM schema_migrations ORDER BY filename"
    );
    applied = new Set(rows.map((r) => r.filename));
  }

  const pending = files.filter((f) => !applied.has(f.name));

  if (pending.length === 0) {
    console.log("Semua migrasi sudah diterapkan.");
    await client.end();
    return;
  }

  if (!apply) {
    console.log(`Dry-run: ${pending.length} migrasi pending dari ${files.length} file.`);
    for (const f of pending) {
      const size = fs.statSync(f.full).size;
      const rel = path.relative(MIGRATIONS_DIR, f.full);
      console.log(`  [pending] ${rel} (${(size / 1024).toFixed(1)} KB)`);
    }
    console.log("\nJalankan dengan --apply untuk eksekusi.");
    await client.end();
    return;
  }

  let done = 0;
  for (const f of pending) {
    const sql = fs.readFileSync(f.full, "utf-8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
        [f.name, checksum]
      );
      await client.query("COMMIT");
      console.log(`  [ok]    ${f.name}`);
      done += 1;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`  [FAIL]  ${f.name}\n          ${err.message}`);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log(`\nSelesai. ${done} migrasi diterapkan.`);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
