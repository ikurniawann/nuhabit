#!/usr/bin/env node
/**
 * Salin DATA dari database sumber -> Postgres lokal (target migrasi).
 *
 * - Sumber : SOURCE_DATABASE_URL (atau DATABASE_URL)
 * - Target : MIGRATE_DATABASE_URL (mis. arkiv lokal)
 *
 * Menyalin semua tabel di schema public + iam, plus auth.users (dengan
 * password hash). FK/trigger dimatikan sementara
 * (session_replication_role=replica) supaya urutan insert tidak masalah.
 * Idempotent: tabel target di-TRUNCATE dulu.
 *
 * Usage: node database/scripts/migrate-data.js
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { sourceDatabaseUrl, sslForUrl, assertLocalTarget } = require("./pg-utils");

const ROOT = path.join(__dirname, "..", "..");
const SCHEMAS = ["public", "iam"];

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

const q = (id) => `"${String(id).replace(/"/g, '""')}"`;

// Kolom non-generated dari target (yang boleh di-insert) + tipe dasarnya.
async function targetColumns(c, schema, table) {
  const { rows } = await c.query(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
     FROM pg_attribute a
     WHERE a.attrelid = format('%I.%I', $1::text, $2::text)::regclass
       AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
     ORDER BY a.attnum`,
    [schema, table]
  );
  return rows;
}

async function sourceColumns(c, schema, table) {
  const { rows } = await c.query(
    `SELECT a.attname AS name
     FROM pg_attribute a
     WHERE a.attrelid = format('%I.%I', $1::text, $2::text)::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [schema, table]
  );
  return rows.map((r) => r.name);
}

function isJsonType(type) {
  return /\bjson\b|\bjsonb\b/.test(type);
}

async function copyTable(src, dst, schema, table, columnMap) {
  const tgtCols = await targetColumns(dst, schema, table);
  const srcCols = new Set(await sourceColumns(src, schema, table));

  // pasangan (kolom target, ekspresi/kolom sumber)
  const pairs = [];
  for (const col of tgtCols) {
    const tc = col.name;
    const sc = (columnMap && columnMap[tc]) || tc;
    if (srcCols.has(sc)) pairs.push({ tgt: tc, src: sc, json: isJsonType(col.type) });
  }
  if (pairs.length === 0) return 0;

  const selectList = pairs.map((p) => q(p.src)).join(", ");
  const { rows } = await src.query(
    `SELECT ${selectList} FROM ${q(schema)}.${q(table)}`
  );
  if (rows.length === 0) return 0;

  const insertCols = pairs.map((p) => q(p.tgt)).join(", ");
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    let n = 1;
    for (const row of slice) {
      const ph = pairs.map((p) => {
        let val = row[p.src] === undefined ? null : row[p.src];
        // jsonb/json: serialize object/array agar pg tidak salah format jadi array literal
        if (p.json && val !== null && typeof val === "object") val = JSON.stringify(val);
        params.push(val);
        return `$${n++}`;
      });
      values.push(`(${ph.join(", ")})`);
    }
    await dst.query(
      `INSERT INTO ${q(schema)}.${q(table)} (${insertCols}) VALUES ${values.join(", ")}`,
      params
    );
    inserted += slice.length;
  }
  return inserted;
}

async function main() {
  loadEnv();
  const srcUrl = sourceDatabaseUrl();
  const dstUrl = process.env.MIGRATE_DATABASE_URL;
  if (!srcUrl) throw new Error("SOURCE_DATABASE_URL / DATABASE_URL belum diset (sumber)");
  if (!dstUrl) throw new Error("MIGRATE_DATABASE_URL belum diset (target)");
  assertLocalTarget(dstUrl, "MIGRATE_DATABASE_URL");

  const src = new Client({ connectionString: srcUrl, ssl: sslForUrl(srcUrl) });
  const dst = new Client({ connectionString: dstUrl, ssl: sslForUrl(dstUrl) });
  await src.connect();
  await dst.connect();
  console.log("Tersambung sumber + target. Mulai salin data...");

  // daftar tabel dari sumber
  const { rows: tables } = await src.query(
    `SELECT n.nspname AS schema, c.relname AS name
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND n.nspname = ANY($1)
       AND c.relname NOT IN ('schema_migrations')
       AND c.relname NOT LIKE '%_migrations%'
     ORDER BY n.nspname, c.relname`,
    [SCHEMAS]
  );

  await dst.query("SET session_replication_role = replica");

  // 1) auth.users (mapping kolom legacy -> lokal)
  let totalRows = 0;
  try {
    await dst.query("TRUNCATE auth.users CASCADE");
    const n = await copyTable(src, dst, "auth", "users", {
      password_hash: "encrypted_password",
      email_verified_at: "email_confirmed_at",
    });
    console.log(`  auth.users: ${n}`);
    totalRows += n;
  } catch (e) {
    console.warn("  auth.users dilewati:", e.message);
  }

  // 2) semua tabel public + iam
  for (const t of tables) {
    try {
      await dst.query(`TRUNCATE ${q(t.schema)}.${q(t.name)} CASCADE`);
      const n = await copyTable(src, dst, t.schema, t.name);
      if (n > 0) console.log(`  ${t.schema}.${t.name}: ${n}`);
      totalRows += n;
    } catch (e) {
      console.error(`  [GAGAL] ${t.schema}.${t.name}: ${e.message}`);
    }
  }

  await dst.query("SET session_replication_role = origin");
  await src.end();
  await dst.end();
  console.log(`Selesai. Total ${totalRows} baris disalin.`);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
