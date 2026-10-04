#!/usr/bin/env node
/**
 * Generate migrasi PostgreSQL dari database sumber (introspeksi live).
 *
 * Tidak butuh pg_dump — introspeksi schema lewat library `pg` (pg_catalog),
 * lalu menulis SATU FILE PER TABEL + file terpisah untuk function / foreign key
 * / view / trigger, sehingga setiap file tabel valid mandiri.
 *
 * Artefak vendor (RLS policy, GRANT role, schema `extensions`) tidak ikut
 * karena generator hanya membaca objek user.
 *
 * Requires: SOURCE_DATABASE_URL atau DATABASE_URL di .env / .env.local.
 *
 * Usage:
 *   node database/scripts/generate-from-db.js
 *   npm run db:pull
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const {
  domainForTable,
  folderForDomain,
  tableTargetSchema,
  allRealSchemas,
  rewriteSchemaRefs,
} = require("../schema-map");
const { sourceDatabaseUrl, sslForUrl } = require("./pg-utils");

const ROOT = path.join(__dirname, "..", "..");
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR || path.join(ROOT, "database", "migrations");
const SCHEMAS_DIR = path.join(MIGRATIONS_DIR, "schemas");
const BOOTSTRAP_DIR = path.join(MIGRATIONS_DIR, "bootstrap");

const SCHEMAS = ["public", "iam"]; // urutan: public dulu, lalu iam

// Band prefix (lebar tetap 14 digit agar urut leksikografis).
const PREFIX = {
  prelude: "00000000000001",
  tableBase: 100, // tabel mulai dari 100, increment +1
  functions: "00000000001000",
  foreign_keys: "00000000002000",
  views: "00000000003000",
  triggers: "00000000004000",
};

// --- env loader -------------------------------------------------------------
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
      // shell env selalu menang; antar-file, .env.local (dimuat terakhir) menang
      if (!shellKeys.has(k)) process.env[k] = v;
    }
  }
}

const pad = (n) => String(n).padStart(14, "0");
const q = (id) => `"${id.replace(/"/g, '""')}"`;
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;
const fileName = (s) => s.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();

function header(label) {
  return (
    `-- =============================================================================\n` +
    `-- AUTO-GENERATED dari PostgreSQL (introspeksi pg_catalog) — ${label}\n` +
    `-- JANGAN edit manual; regenerate via: npm run db:pull\n` +
    `-- Generated: ${new Date().toISOString()}\n` +
    `-- =============================================================================\n\n`
  );
}

function cleanGenerated() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
    return;
  }
  const re = /_(prelude|functions|foreign_keys|views|triggers)\.sql$/;
  const manualBootstrap = new Set([
    "00000000000000_app_auth.sql",
    "00000000010000_strip_legacy_rls.sql",
  ]);

  // Hapus band-files generated di bootstrap/ (manual files tetap).
  if (fs.existsSync(BOOTSTRAP_DIR)) {
    for (const f of fs.readdirSync(BOOTSTRAP_DIR)) {
      if (manualBootstrap.has(f)) continue;
      if (re.test(f)) {
        fs.unlinkSync(path.join(BOOTSTRAP_DIR, f));
      }
    }
  }

  // Legacy: band-files flat + table_*.sql di root migrasi (struktur lama).
  for (const f of fs.readdirSync(MIGRATIONS_DIR)) {
    if (re.test(f) || /_table_/.test(f)) {
      fs.unlinkSync(path.join(MIGRATIONS_DIR, f));
    }
  }

  // Hapus seluruh struktur schemas/ (akan ditulis ulang).
  if (fs.existsSync(SCHEMAS_DIR)) {
    fs.rmSync(SCHEMAS_DIR, { recursive: true, force: true });
  }
}

function write(file, contents) {
  const target = path.join(MIGRATIONS_DIR, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf-8");
}

// --- introspeksi ------------------------------------------------------------
async function getEnums(c) {
  const { rows } = await c.query(
    `SELECT n.nspname AS schema, t.typname AS name,
            array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
     FROM pg_type t
     JOIN pg_enum e ON e.enumtypid = t.oid
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = ANY($1)
     GROUP BY n.nspname, t.typname
     ORDER BY n.nspname, t.typname`,
    [SCHEMAS]
  );
  return rows;
}

async function getTables(c) {
  const { rows } = await c.query(
    `SELECT n.nspname AS schema, c.relname AS name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND n.nspname = ANY($1)
       AND c.relname NOT IN ('schema_migrations')
       AND c.relname NOT LIKE '%_migrations%'
     ORDER BY n.nspname, c.relname`,
    [SCHEMAS]
  );
  return rows;
}

async function getColumns(c, schema, table) {
  const { rows } = await c.query(
    `SELECT a.attname AS name,
            pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
            a.attnotnull AS notnull,
            a.attidentity AS identity,
            a.attgenerated AS generated,
            pg_get_expr(d.adbin, d.adrelid) AS default_expr
     FROM pg_attribute a
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = format('%I.%I', $1::text, $2::text)::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [schema, table]
  );
  return rows;
}

async function getConstraints(c, schema, table, types) {
  const { rows } = await c.query(
    `SELECT conname AS name, pg_get_constraintdef(oid, true) AS def, contype
     FROM pg_constraint
     WHERE conrelid = format('%I.%I', $1::text, $2::text)::regclass
       AND contype = ANY($3)
     ORDER BY contype DESC, conname`,
    [schema, table, types]
  );
  return rows;
}

async function getIndexes(c, schema, table) {
  const { rows } = await c.query(
    `SELECT i.relname AS name, pg_get_indexdef(ix.indexrelid) AS def
     FROM pg_index ix
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_class t ON t.oid = ix.indrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = $1 AND t.relname = $2
       AND NOT ix.indisprimary
       AND ix.indexrelid NOT IN (SELECT conindid FROM pg_constraint WHERE conindid <> 0)
     ORDER BY i.relname`,
    [schema, table]
  );
  return rows;
}

async function getTableComment(c, schema, table) {
  const { rows } = await c.query(
    `SELECT obj_description(format('%I.%I', $1::text, $2::text)::regclass, 'pg_class') AS comment`,
    [schema, table]
  );
  return rows[0] && rows[0].comment;
}

async function getColumnComments(c, schema, table) {
  const { rows } = await c.query(
    `SELECT a.attname AS name, col_description(a.attrelid, a.attnum) AS comment
     FROM pg_attribute a
     WHERE a.attrelid = format('%I.%I', $1::text, $2::text)::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
       AND col_description(a.attrelid, a.attnum) IS NOT NULL
     ORDER BY a.attnum`,
    [schema, table]
  );
  return rows;
}

async function getForeignKeys(c) {
  const { rows } = await c.query(
    `SELECT n.nspname AS schema, t.relname AS table,
            con.conname AS name, pg_get_constraintdef(con.oid, true) AS def
     FROM pg_constraint con
     JOIN pg_class t ON t.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE con.contype = 'f' AND n.nspname = ANY($1)
     ORDER BY n.nspname, t.relname, con.conname`,
    [SCHEMAS]
  );
  return rows;
}

async function getFunctions(c) {
  const { rows } = await c.query(
    `SELECT n.nspname AS schema, p.proname AS name,
            pg_get_functiondef(p.oid) AS def
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = ANY($1)
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
       )
     ORDER BY n.nspname, p.proname`,
    [SCHEMAS]
  );
  return rows;
}

async function getViews(c) {
  const { rows } = await c.query(
    `SELECT c.oid, n.nspname AS schema, c.relname AS name, c.relkind AS kind,
            pg_get_viewdef(c.oid, true) AS def
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY($1) AND c.relkind IN ('v', 'm')
     ORDER BY n.nspname, c.relname`,
    [SCHEMAS]
  );
  return rows;
}

async function getViewDeps(c, oids) {
  if (!oids.length) return [];
  const { rows } = await c.query(
    `SELECT DISTINCT r.ev_class AS view_oid, d.refobjid AS dep_oid
     FROM pg_rewrite r
     JOIN pg_depend d ON d.objid = r.oid
     WHERE r.ev_class = ANY($1) AND d.refobjid = ANY($1)
       AND d.refobjid <> r.ev_class`,
    [oids]
  );
  return rows;
}

async function getTriggers(c) {
  const { rows } = await c.query(
    `SELECT n.nspname AS schema, t.relname AS table, tg.tgname AS name,
            pg_get_triggerdef(tg.oid, true) AS def
     FROM pg_trigger tg
     JOIN pg_class t ON t.oid = tg.tgrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = ANY($1) AND NOT tg.tgisinternal
     ORDER BY n.nspname, t.relname, tg.tgname`,
    [SCHEMAS]
  );
  return rows;
}

// Topological sort views berdasarkan dependensi antar-view.
function topoSortViews(views, deps) {
  const byOid = new Map(views.map((v) => [Number(v.oid), v]));
  const edges = new Map(views.map((v) => [Number(v.oid), new Set()]));
  for (const d of deps) {
    const v = Number(d.view_oid);
    const dep = Number(d.dep_oid);
    if (edges.has(v) && byOid.has(dep)) edges.get(v).add(dep);
  }
  const result = [];
  const visited = new Set();
  const temp = new Set();
  const visit = (oid) => {
    if (visited.has(oid)) return;
    if (temp.has(oid)) return; // cycle: abaikan, urutan apa adanya
    temp.add(oid);
    for (const dep of edges.get(oid) || []) visit(dep);
    temp.delete(oid);
    visited.add(oid);
    result.push(byOid.get(oid));
  };
  for (const v of views) visit(Number(v.oid));
  return result;
}

// --- DDL builders -----------------------------------------------------------
function buildColumnLine(col) {
  let line = `    ${q(col.name)} ${col.type}`;
  if (col.generated === "s" && col.default_expr) {
    line += ` GENERATED ALWAYS AS ${col.default_expr} STORED`;
  } else if (col.identity === "a") {
    line += ` GENERATED ALWAYS AS IDENTITY`;
  } else if (col.identity === "d") {
    line += ` GENERATED BY DEFAULT AS IDENTITY`;
  } else if (col.default_expr) {
    line += ` DEFAULT ${col.default_expr}`;
  }
  if (col.notnull) line += ` NOT NULL`;
  return line;
}

function buildTableSql(schema, table, cols, constraints, indexes, tComment, cComments) {
  const qt = `${q(schema)}.${q(table)}`;
  let sql = `-- Table: ${schema}.${table}\n`;
  sql += `CREATE TABLE ${qt} (\n`;
  sql += cols.map(buildColumnLine).join(",\n");
  sql += `\n);\n`;

  for (const con of constraints) {
    sql += `\nALTER TABLE ONLY ${qt}\n    ADD CONSTRAINT ${q(con.name)} ${con.def};\n`;
  }
  for (const idx of indexes) {
    sql += `\n${idx.def};\n`;
  }
  if (tComment) {
    sql += `\nCOMMENT ON TABLE ${qt} IS ${sqlStr(tComment)};\n`;
  }
  for (const cc of cComments) {
    sql += `COMMENT ON COLUMN ${qt}.${q(cc.name)} IS ${sqlStr(cc.comment)};\n`;
  }
  return sql;
}

function ensureSemicolon(def) {
  const d = def.trimEnd();
  return d.endsWith(";") ? d : d + ";";
}

// --- main -------------------------------------------------------------------
async function main() {
  loadEnv();
  const url = sourceDatabaseUrl();
  if (!url) {
    console.error("ERROR: Set SOURCE_DATABASE_URL atau DATABASE_URL di .env");
    process.exit(1);
  }

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  console.log("Terhubung ke database. Mulai introspeksi...");

  // Catatan: client `pg` tunggal tidak boleh menjalankan query paralel,
  // jadi semua introspeksi dijalankan berurutan.
  const enums = await getEnums(c);
  const tables = await getTables(c);
  const fks = await getForeignKeys(c);
  const functions = await getFunctions(c);
  const views = await getViews(c);
  const triggers = await getTriggers(c);

  cleanGenerated();

  // Peta nama_tabel -> schema target untuk rewrite referensi `public.<table>`.
  const tableList = tables.map((t) => ({
    name: t.name,
    source: t.schema,
    target: tableTargetSchema(t.name, t.schema),
  }));
  const rw = (s) => rewriteSchemaRefs(s, tableList);

  // 1) prelude: extensions + schema domain + enums
  let prelude =
    header("prelude (extensions + schemas + enum types)") +
    `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\n` +
    `CREATE EXTENSION IF NOT EXISTS "pgcrypto";\n\n`;
  for (const schema of allRealSchemas()) {
    prelude += `CREATE SCHEMA IF NOT EXISTS ${q(schema)};\n`;
  }
  prelude += "\n";
  for (const e of enums) {
    const labels = e.labels.map(sqlStr).join(", ");
    prelude += `CREATE TYPE ${q(e.schema)}.${q(e.name)} AS ENUM (${labels});\n`;
  }
  write(`bootstrap/${PREFIX.prelude}_prelude.sql`, prelude);

  // 2) satu file per tabel
  let seq = PREFIX.tableBase;
  for (const t of tables) {
    const cols = await getColumns(c, t.schema, t.name);
    const pkUnique = await getConstraints(c, t.schema, t.name, ["p", "u"]);
    const checks = await getConstraints(c, t.schema, t.name, ["c"]);
    const indexes = await getIndexes(c, t.schema, t.name);
    const tComment = await getTableComment(c, t.schema, t.name);
    const cComments = await getColumnComments(c, t.schema, t.name);
    const constraints = [...pkUnique, ...checks];
    const body = buildTableSql(t.schema, t.name, cols, constraints, indexes, tComment, cComments);
    const tag = t.schema === "public" ? "" : `${t.schema}_`;
    const domain = domainForTable(t.name, t.schema);
    const folder = path.join("schemas", folderForDomain(domain));
    const file = path.join(folder, `${pad(seq)}_table_${tag}${fileName(t.name)}.sql`);
    write(file, rw(header(`table: ${t.schema}.${t.name} [domain: ${domain}]`) + body));
    seq += 1;
  }

  // 3) functions
  if (functions.length) {
    let body = header("functions / procedures");
    for (const fn of functions) {
      body += `-- ${fn.schema}.${fn.name}\n${ensureSemicolon(fn.def)}\n\n`;
    }
    write(`bootstrap/${PREFIX.functions}_functions.sql`, rw(body));
  }

  // 4) foreign keys
  if (fks.length) {
    let body = header("foreign keys");
    for (const fk of fks) {
      body += `ALTER TABLE ONLY ${q(fk.schema)}.${q(fk.table)}\n    ADD CONSTRAINT ${q(fk.name)} ${fk.def};\n`;
    }
    write(`bootstrap/${PREFIX.foreign_keys}_foreign_keys.sql`, rw(body));
  }

  // 5) views (topo sorted)
  if (views.length) {
    const ordered = topoSortViews(views, await getViewDeps(c, views.map((v) => Number(v.oid))));
    let body = header("views / materialized views");
    for (const v of ordered) {
      const kw = v.kind === "m" ? "MATERIALIZED VIEW" : "VIEW";
      const create = v.kind === "m" ? `CREATE ${kw}` : `CREATE OR REPLACE ${kw}`;
      body += `-- ${v.schema}.${v.name}\n${create} ${q(v.schema)}.${q(v.name)} AS\n${ensureSemicolon(v.def)}\n\n`;
    }
    write(`bootstrap/${PREFIX.views}_views.sql`, rw(body));
  }

  // 6) triggers
  if (triggers.length) {
    let body = header("triggers");
    for (const tg of triggers) {
      body += `${ensureSemicolon(tg.def)}\n`;
    }
    write(`bootstrap/${PREFIX.triggers}_triggers.sql`, rw(body));
  }

  await c.end();

  console.log(
    `Selesai: ${tables.length} tabel, ${enums.length} enum, ${functions.length} function, ` +
      `${fks.length} FK, ${views.length} view, ${triggers.length} trigger.`
  );
  console.log(`Output: ${MIGRATIONS_DIR}`);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
