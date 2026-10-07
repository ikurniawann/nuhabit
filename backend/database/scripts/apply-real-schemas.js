#!/usr/bin/env node
/**
 * Konversi file migrasi yang sudah di-generate (semua tabel di `public`) menjadi
 * schema asli per domain (mis. `hris.employees`, `crm.crm_rewards`).
 *
 * Yang dilakukan:
 *   1. Pindai semua file tabel di `migrations/schemas/<domain>/` untuk menyusun
 *      peta nama_tabel -> schema target (lihat database/schema-map.js).
 *   2. Tulis ulang referensi `public.<table>` / `"public"."<table>"` di SELURUH
 *      file .sql (tabel, foreign_keys, functions, views, triggers, incremental)
 *      ke schema target. Enum/function/view tetap di `public`.
 *   3. Tambahkan `CREATE SCHEMA IF NOT EXISTS` untuk tiap schema domain di
 *      prelude.
 *   4. Tulis migrasi transisi idempoten (ALTER ... SET SCHEMA) agar database yang
 *      sudah terlanjur ter-apply di `public` ikut pindah, plus set search_path
 *      level database.
 *
 * Idempoten: aman dijalankan berulang.
 *
 * Usage:
 *   node database/scripts/apply-real-schemas.js
 */

const fs = require("fs");
const path = require("path");
const {
  tableTargetSchema,
  allRealSchemas,
  searchPathSchemas,
} = require("../schema-map");

const ROOT = path.join(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "database", "migrations");
const SCHEMAS_DIR = path.join(MIGRATIONS_DIR, "schemas");
const PRELUDE = path.join(MIGRATIONS_DIR, "00000000000001_prelude.sql");
const TRANSITION = path.join(MIGRATIONS_DIR, "20260624180000_real_schemas.sql");
const TRANSITION_NAME = path.basename(TRANSITION);

const q = (id) => `"${id.replace(/"/g, '""')}"`;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.name.endsWith(".sql")) out.push(full);
  }
  return out;
}

/** Susun daftar tabel { name, source, target } dari file tabel. */
function collectTables() {
  const tables = [];
  for (const file of walk(SCHEMAS_DIR)) {
    const sql = fs.readFileSync(file, "utf-8");
    const m = sql.match(/CREATE TABLE\s+"(\w+)"\."(\w+)"/);
    if (!m) continue;
    const source = m[1];
    const name = m[2];
    tables.push({ name, source, target: tableTargetSchema(name, source) });
  }
  return tables;
}

/** Rewrite referensi schema pada satu string SQL. */
function rewrite(sql, tables) {
  let out = sql;
  for (const { name, source, target } of tables) {
    if (!target || target === source) continue;
    out = out.split(`"${source}"."${name}"`).join(`"${target}"."${name}"`);
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${source}\\.${esc}\\b`, "g"), `${target}.${name}`);
  }
  return out;
}

function updatePrelude() {
  if (!fs.existsSync(PRELUDE)) return;
  let sql = fs.readFileSync(PRELUDE, "utf-8");
  const lines = allRealSchemas()
    .filter((s) => !new RegExp(`CREATE SCHEMA IF NOT EXISTS ${q(s)}`).test(sql))
    .map((s) => `CREATE SCHEMA IF NOT EXISTS ${q(s)};`);
  if (!lines.length) return;
  // Sisipkan setelah blok extensions (baris pgcrypto), atau setelah header.
  const anchor = sql.indexOf('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
  const block = lines.join("\n") + "\n";
  if (anchor >= 0) {
    const eol = sql.indexOf("\n", anchor) + 1;
    sql = sql.slice(0, eol) + "\n" + block + sql.slice(eol).replace(/^\n+/, "\n");
  } else {
    sql += "\n" + block;
  }
  fs.writeFileSync(PRELUDE, sql, "utf-8");
}

function header(label) {
  return (
    `-- =============================================================================\n` +
    `-- ${label}\n` +
    `-- Idempoten: aman di fresh DB (no-op) maupun DB yang sudah ada di public.\n` +
    `-- =============================================================================\n\n`
  );
}

function writeTransition(tables) {
  // Tabel yang di DB lama berada di `public` = semua tabel domain (target bukan
  // public/iam/auth). Pemindahan tetap diberi guard `IF to_regclass(public.x)`
  // sehingga aman walau dijalankan ulang / di fresh DB.
  const moves = tables
    .filter((t) => !["public", "iam", "auth"].includes(t.target))
    .sort((a, b) =>
      a.target === b.target ? a.name.localeCompare(b.name) : a.target.localeCompare(b.target)
    );
  let sql = header("Pindahkan tabel public -> schema domain + set search_path");

  sql += "-- 1) Pastikan semua schema domain ada.\n";
  for (const s of allRealSchemas()) sql += `CREATE SCHEMA IF NOT EXISTS ${q(s)};\n`;
  sql += "\n";

  sql += "-- 2) Pindahkan tabel yang masih di public ke schema targetnya.\n";
  sql += "DO $$\nBEGIN\n";
  for (const t of moves) {
    sql +=
      `  IF to_regclass('public.${q(t.name)}') IS NOT NULL THEN ` +
      `EXECUTE 'ALTER TABLE public.${q(t.name)} SET SCHEMA ${q(t.target)}'; END IF;\n`;
  }
  sql += "END $$;\n\n";

  sql += "-- 3) search_path level database untuk sesi mendatang (psql/tooling lain).\n";
  sql += "DO $$\nBEGIN\n";
  sql +=
    `  EXECUTE format('ALTER DATABASE %I SET search_path TO ${searchPathSchemas().join(", ")}', current_database());\n`;
  sql += "END $$;\n";

  fs.writeFileSync(TRANSITION, sql, "utf-8");
}

function main() {
  const tables = collectTables();
  if (!tables.length) {
    console.error("Tidak ada file tabel di migrations/schemas/. Jalankan db:pull dulu.");
    process.exit(1);
  }

  // Hanya file GENERATED yang di-rewrite: tabel di schemas/** + band files
  // (functions/foreign_keys/views/triggers). File hand-written (app_auth,
  // strip_rls, migrasi bertanggal) memakai nama tabel "bare" dan dibiarkan apa
  // adanya agar tidak bergantung pada urutan pindah-schema.
  const isGenerated = (file) =>
    file.startsWith(SCHEMAS_DIR + path.sep) ||
    /_(functions|foreign_keys|views|triggers)\.sql$/.test(path.basename(file));

  let changed = 0;
  for (const file of walk(MIGRATIONS_DIR)) {
    if (path.basename(file) === TRANSITION_NAME) continue; // ditulis terpisah
    if (!isGenerated(file)) continue;
    const before = fs.readFileSync(file, "utf-8");
    const after = rewrite(before, tables);
    if (after !== before) {
      fs.writeFileSync(file, after, "utf-8");
      changed += 1;
    }
  }

  updatePrelude();
  writeTransition(tables);

  const moved = tables.filter((t) => !["public", "iam", "auth"].includes(t.target));
  console.log(
    `Selesai: ${changed} file di-rewrite, ${moved.length} tabel ke schema domain, ` +
      `${allRealSchemas().length} schema domain.`
  );
  console.log(`Transisi: ${path.relative(ROOT, TRANSITION)}`);
}

main();
