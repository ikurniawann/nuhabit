#!/usr/bin/env node
/**
 * Run a single .sql seeder file in one transaction.
 *
 * Usage:
 *   node database/seeders/run-sql-file.js database/seeders/iam-menus.sql
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");

const ROOT = path.join(__dirname, "..", "..");

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

async function main() {
  const sqlFile = process.argv[2];
  if (!sqlFile) {
    console.error("Usage: node database/seeders/run-sql-file.js <path-to.sql>");
    process.exit(1);
  }

  loadEnv();
  const databaseUrl = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL / MIGRATE_DATABASE_URL belum diset.");
    process.exit(1);
  }
  assertLocalTarget(databaseUrl);

  const absolutePath = path.isAbsolute(sqlFile) ? sqlFile : path.join(ROOT, sqlFile);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File tidak ditemukan: ${absolutePath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(absolutePath, "utf-8");
  const client = new Client({ connectionString: databaseUrl, ssl: sslForUrl(databaseUrl) });

  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log(`Selesai: ${path.relative(ROOT, absolutePath)}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Seeder gagal:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
