import { getPool } from "@/lib/db";
import type { Pool } from "pg";

/**
 * Query builder Postgres (PostgREST-style subset) for server-side routes.
 * Shim lama: kode baru memakai SQL langsung lewat @/lib/db (lihat
 * docs/frontend-conventions.md, bagian "Akses data").
 */

/**
 * Bentuk baris default shim. Sengaja longgar: ratusan route lama membaca
 * `data` tanpa tipe dan tabelnya dipilih saat runtime (`from("nama")`).
 * Kode baru yang butuh tipe baris memakai `query<Row>()` dari @/lib/db.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ShimRow = any;

/** Payload insert/update/upsert: satu objek atau array objek kolom → nilai. */
type Payload = object | readonly object[];
type Params = unknown[];

export interface PgResult<T = ShimRow> {
  data: T | null;
  error: { message: string; code?: string } | null;
  count: number | null;
  status: number;
}

type Filter = { col: string; op: string; value: unknown };

interface ForeignKey {
  srcSchema: string;
  srcTable: string;
  srcCol: string;
  tgtSchema: string;
  tgtTable: string;
  tgtCol: string;
}

let fkCache: ForeignKey[] | null = null;

/**
 * Kolom bertipe json/jsonb per tabel.
 *
 * node-postgres menyerialkan Array JavaScript sebagai LITERAL ARRAY Postgres,
 * bukan JSON. Untuk kolom jsonb akibatnya:
 *   []                   → "{}"      tersimpan sebagai objek kosong (salah bentuk)
 *   [{ id: 1 }]          → "{...}"   error 22P02 invalid input syntax for type json
 * Jadi nilai untuk kolom json/jsonb harus di-JSON.stringify lebih dulu. Daftar
 * ini dipakai agar hanya kolom json yang diperlakukan begitu — kolom array asli
 * (text[], uuid[]) tetap dikirim apa adanya.
 */
let jsonColsCache: Map<string, Set<string>> | null = null;

async function loadJsonColumns(pool: Pool): Promise<Map<string, Set<string>>> {
  if (jsonColsCache) return jsonColsCache;
  const { rows } = await pool.query<{ table_schema: string; table_name: string; column_name: string }>(
    `SELECT table_schema, table_name, column_name
     FROM information_schema.columns
     WHERE data_type IN ('json', 'jsonb')
       AND table_schema NOT IN ('pg_catalog', 'information_schema')`
  );
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = `${r.table_schema}.${r.table_name}`;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(r.column_name);
  }
  jsonColsCache = map;
  return jsonColsCache;
}

/**
 * Skema sebenarnya untuk nama tabel tanpa kualifikasi.
 *
 * Pemanggil umumnya menulis .from("pos_order_items") tanpa skema dan
 * mengandalkan search_path; tabelnya sendiri ada di skema `pos`. Tanpa
 * resolusi ini, pencarian kolom json meleset dan nilai jsonb kembali dikirim
 * sebagai array Postgres.
 */
let tableSchemaCache: Map<string, string | null> | null = null;

async function resolveTableSchema(pool: Pool, table: string): Promise<string | null> {
  if (!tableSchemaCache) tableSchemaCache = new Map();
  if (tableSchemaCache.has(table)) return tableSchemaCache.get(table) ?? null;
  const { rows } = await pool.query<{ nspname: string | null }>(
    `SELECT n.nspname
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.oid = to_regclass($1)`,
    [table]
  );
  const schema = rows[0]?.nspname ?? null;
  tableSchemaCache.set(table, schema);
  return schema;
}

/** Nilai siap-kirim untuk satu kolom: kolom json menerima string JSON. */
function pgValue(value: unknown, isJsonCol: boolean): unknown {
  if (value === undefined) return null;
  if (!isJsonCol) return value;
  if (value === null) return null;
  // String dianggap sudah berbentuk JSON (mis. hasil JSON.stringify pemanggil).
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

async function loadForeignKeys(pool: Pool): Promise<ForeignKey[]> {
  if (fkCache) return fkCache;
  const { rows } = await pool.query<{
    src_schema: string;
    src_table: string;
    src_col: string;
    tgt_schema: string;
    tgt_table: string;
    tgt_col: string;
  }>(
    `SELECT src_ns.nspname AS src_schema, src.relname AS src_table, src_att.attname AS src_col,
            tgt_ns.nspname AS tgt_schema, tgt.relname AS tgt_table, tgt_att.attname AS tgt_col
     FROM pg_constraint con
     JOIN pg_class src ON src.oid = con.conrelid
     JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
     JOIN pg_class tgt ON tgt.oid = con.confrelid
     JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
     JOIN pg_attribute src_att ON src_att.attrelid = con.conrelid AND src_att.attnum = con.conkey[1]
     JOIN pg_attribute tgt_att ON tgt_att.attrelid = con.confrelid AND tgt_att.attnum = con.confkey[1]
     WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1
     -- Urutan wajib deterministik. Saat sebuah tabel punya lebih dari satu FK
     -- ke tabel yang sama, embed tanpa penunjuk (employees!kolom) memakai
     -- kandidat pertama; tanpa ORDER BY urutannya mengikuti urutan fisik baris
     -- katalog dan bisa berubah setelah tabel ditulis ulang. Ini tidak membuat
     -- pilihan otomatisnya benar — untuk itu tetap pakai penunjuk eksplisit —
     -- tetapi mencegahnya berubah diam-diam.
     ORDER BY src_ns.nspname, src.relname, src_att.attname`
  );
  fkCache = rows.map((r) => ({
    srcSchema: r.src_schema,
    srcTable: r.src_table,
    srcCol: r.src_col,
    tgtSchema: r.tgt_schema,
    tgtTable: r.tgt_table,
    tgtCol: r.tgt_col,
  }));
  return fkCache;
}

const qid = (id: string) => `"${id.replace(/"/g, '""')}"`;

/** Peta operator simbolik PostgREST -> operator SQL, dipakai oleh `.not()`. */
const NOT_OP_TRANSLATE: Record<string, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "LIKE",
  ilike: "ILIKE",
  is: "IS",
  in: "IN",
};

/** Parse PostgREST-style IN list: ('a','b') atau ["a","b"] */
export function parseInValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [value];
  const s = value.trim();
  const paren = s.match(/^\(([\s\S]*)\)$/);
  if (!paren) return [value];
  const inner = paren[1].trim();
  if (!inner) return [];
  const items: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      if (ch === quote && inner[i + 1] === quote) {
        cur += ch;
        i++;
        continue;
      }
      if (ch === quote) {
        items.push(cur);
        cur = "";
        quote = null;
        continue;
      }
      cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === ",") {
      if (cur) {
        items.push(cur);
        cur = "";
      }
    } else if (!/\s/.test(ch)) {
      cur += ch;
    }
  }
  if (cur) items.push(cur);
  return items;
}

function buildInClause(col: string, values: unknown[], params: Params, negate = false): string {
  if (values.length === 0) return negate ? "true" : "false";
  const ph = values.map((v) => {
    params.push(v);
    return `$${params.length}`;
  });
  return `${col} ${negate ? "NOT " : ""}IN (${ph.join(", ")})`;
}

// Pisahkan daftar select berdasar koma di level atas (hormati tanda kurung).
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

interface SelectPart {
  type: "column" | "embed";
  raw: string;
  alias?: string;
  table?: string;
  /** PostgREST FK hint, e.g. employees!reporting_to → reporting_to */
  fkHint?: string;
  inner?: string;
}

function parseSelect(sel: string): SelectPart[] {
  return splitTopLevel(sel).map((part) => {
    const embedMatch =
      part.match(/^([\w]+)\s*:\s*([\w]+)(?:!([\w]+))?\s*\(([\s\S]*)\)$/) ||
      part.match(/^([\w]+)(?:!([\w]+))?\s*\(([\s\S]*)\)$/);
    if (embedMatch) {
      if (embedMatch.length === 5) {
        return {
          type: "embed",
          raw: part,
          alias: embedMatch[1],
          table: embedMatch[2],
          fkHint: embedMatch[3],
          inner: embedMatch[4],
        };
      }
      return {
        type: "embed",
        raw: part,
        alias: embedMatch[1],
        table: embedMatch[1],
        fkHint: embedMatch[2],
        inner: embedMatch[3],
      };
    }
    // alias kolom: "alias:col"
    const aliasCol = part.match(/^([\w]+)\s*:\s*([\w.]+)$/);
    if (aliasCol) return { type: "column", raw: part, alias: aliasCol[1], table: aliasCol[2] };
    return { type: "column", raw: part };
  });
}

export class QueryBuilder<T = ShimRow> implements PromiseLike<PgResult<T>> {
  private pool: Pool;
  private schema: string;
  private table: string;
  private action: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private selectStr = "*";
  private returningSelect: string | null = null;
  private filters: Filter[] = [];
  private orFilters: string[] = [];
  private orderBy: { col: string; asc: boolean; nullsFirst?: boolean }[] = [];
  private limitN: number | null = null;
  private rangeFromTo: [number, number] | null = null;
  private payload: Payload | null = null;
  private upsertConflict: string | null = null;
  private singleMode: "single" | "maybe" | null = null;
  private wantCount: "exact" | null = null;
  private headOnly = false;

  constructor(table: string, schema = "public", pool?: Pool) {
    this.pool = pool ?? getPool();
    this.table = table;
    this.schema = schema;
  }

  select(sel = "*", opts?: { count?: "exact"; head?: boolean }) {
    if (this.action === "select") this.selectStr = sel || "*";
    else this.returningSelect = sel || "*";
    if (opts?.count) this.wantCount = opts.count;
    if (opts?.head) this.headOnly = true;
    return this;
  }

  insert(values: Payload) {
    this.action = "insert";
    this.payload = values;
    return this;
  }
  update(values: object) {
    this.action = "update";
    this.payload = values;
    return this;
  }
  upsert(values: Payload, opts?: { onConflict?: string }) {
    this.action = "upsert";
    this.payload = values;
    this.upsertConflict = opts?.onConflict ?? null;
    return this;
  }
  delete() {
    this.action = "delete";
    return this;
  }

  private addFilter(col: string, op: string, value: unknown) {
    this.filters.push({ col, op, value });
    return this;
  }
  eq(col: string, value: unknown) { return this.addFilter(col, "=", value); }
  neq(col: string, value: unknown) { return this.addFilter(col, "<>", value); }
  gt(col: string, value: unknown) { return this.addFilter(col, ">", value); }
  gte(col: string, value: unknown) { return this.addFilter(col, ">=", value); }
  lt(col: string, value: unknown) { return this.addFilter(col, "<", value); }
  lte(col: string, value: unknown) { return this.addFilter(col, "<=", value); }
  like(col: string, value: unknown) { return this.addFilter(col, "LIKE", value); }
  ilike(col: string, value: unknown) { return this.addFilter(col, "ILIKE", value); }
  is(col: string, value: unknown) { return this.addFilter(col, "IS", value); }
  in(col: string, value: readonly unknown[]) { return this.addFilter(col, "IN", value); }
  contains(col: string, value: unknown) { return this.addFilter(col, "@>", value); }
  /**
   * .not(col, op, value) — PostgREST-style: op boleh simbolik ('eq', 'neq',
   * 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in') atau operator SQL
   * mentah ('=', '<>', 'IN', dst). Simbolik diterjemahkan ke operator SQL
   * sebelum di-uppercase supaya `.not('status', 'eq', 'x')` menghasilkan
   * `NOT (status = $1)`, bukan `NOT (status EQ $1)` yang bukan SQL valid.
   */
  not(col: string, op: string, value: unknown) {
    const sqlOp = NOT_OP_TRANSLATE[op.toLowerCase()] ?? op.toUpperCase();
    return this.addFilter(col, `NOT ${sqlOp}`, value);
  }
  or(expr: string) { this.orFilters.push(expr); return this; }

  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orderBy.push({ col, asc: opts?.ascending !== false, nullsFirst: opts?.nullsFirst });
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  range(from: number, to: number) { this.rangeFromTo = [from, to]; return this; }

  single() { this.singleMode = "single"; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }

  /** Rekonstruksi builder dari spec JSON (browser proxy). */
  static fromSpec(spec: {
    schema?: string;
    table: string;
    action?: "select" | "insert" | "update" | "upsert" | "delete";
    select?: string;
    returningSelect?: string | null;
    filters?: Filter[];
    orFilters?: string[];
    orderBy?: { col: string; asc: boolean; nullsFirst?: boolean }[];
    limit?: number | null;
    range?: [number, number] | null;
    payload?: Payload | null;
    upsertConflict?: string | null;
    singleMode?: "single" | "maybe" | null;
    wantCount?: "exact" | null;
    headOnly?: boolean;
  }) {
    const b = new QueryBuilder(spec.table, spec.schema ?? "public");
    b.action = spec.action ?? "select";
    b.selectStr = spec.select ?? "*";
    b.returningSelect = spec.returningSelect ?? null;
    b.filters = spec.filters ?? [];
    b.orFilters = spec.orFilters ?? [];
    b.orderBy = spec.orderBy ?? [];
    b.limitN = spec.limit ?? null;
    b.rangeFromTo = spec.range ?? null;
    b.payload = spec.payload ?? null;
    b.upsertConflict = spec.upsertConflict ?? null;
    b.singleMode = spec.singleMode ?? null;
    b.wantCount = spec.wantCount ?? null;
    b.headOnly = spec.headOnly ?? false;
    return b;
  }

  // --- SQL building ---------------------------------------------------------
  // Schema default ("public") dibiarkan "bare" agar search_path me-resolve ke
  // schema domain yang benar (mis. hris.employees). Schema eksplisit non-public
  // (mis. "iam") tetap di-qualify.
  /** Kolom json/jsonb tabel ini; diisi sebelum membangun INSERT/UPDATE. */
  private jsonCols: Set<string> = new Set();

  private async primeJsonCols() {
    // Hanya nilai objek/array yang bisa salah serialisasi. Bila payload hanya
    // berisi skalar, katalog tidak perlu dibaca sama sekali — menghemat satu
    // round-trip untuk mayoritas insert/update.
    const hasObjectValue = this.payloadRows().some((r) =>
      Object.values(r).some((v) => v !== null && typeof v === "object")
    );
    if (!hasObjectValue) {
      this.jsonCols = new Set();
      return;
    }
    const map = await loadJsonColumns(this.pool);
    const explicit = this.schema && this.schema !== "public" ? this.schema : null;
    const schema = explicit ?? (await resolveTableSchema(this.pool, this.table)) ?? "public";
    this.jsonCols = map.get(`${schema}.${this.table}`) ?? new Set();
  }

  /** Payload sebagai daftar baris kolom → nilai (insert tunggal jadi satu baris). */
  private payloadRows(): Record<string, unknown>[] {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
    return rows.filter((r): r is Record<string, unknown> => r !== null && typeof r === "object");
  }

  private qt() {
    return this.schema && this.schema !== "public"
      ? `${qid(this.schema)}.${qid(this.table)}`
      : qid(this.table);
  }

  private buildWhere(params: Params, alias?: string): string {
    const prefix = alias ? `${alias}.` : "";
    const clauses: string[] = [];
    for (const f of this.filters) {
      const col = `${prefix}${qid(f.col)}`;
      if (f.op === "IN") {
        clauses.push(buildInClause(col, parseInValues(f.value), params, false));
      } else if (f.op === "NOT IN") {
        clauses.push(buildInClause(col, parseInValues(f.value), params, true));
      } else if (f.op === "IS") {
        if (f.value === null) clauses.push(`${col} IS NULL`);
        else { params.push(f.value); clauses.push(`${col} IS $${params.length}`); }
      } else if (f.op.startsWith("NOT ")) {
        const base = f.op.slice(4);
        if (base === "IS" && f.value === null) clauses.push(`${col} IS NOT NULL`);
        else { params.push(f.value); clauses.push(`NOT (${col} ${base} $${params.length})`); }
      } else {
        params.push(f.value);
        clauses.push(`${col} ${f.op} $${params.length}`);
      }
    }
    // or("a.eq.1,b.eq.2") -> (a = 1 OR b = 2)
    // Mendukung juga: a.is.null / a.is.not.null
    for (const orExpr of this.orFilters) {
      const parts = splitTopLevel(orExpr).map((p) => {
        const [c, op, ...rest] = p.split(".");
        const val = rest.join(".");
        if (op === "is") {
          return val === "not.null"
            ? `${prefix}${qid(c)} IS NOT NULL`
            : `${prefix}${qid(c)} IS NULL`;
        }
        const opMap: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "LIKE", ilike: "ILIKE" };
        const sqlOp = opMap[op] || "=";
        params.push(val.replace(/\*/g, "%"));
        return `${prefix}${qid(c)} ${sqlOp} $${params.length}`;
      });
      if (parts.length) clauses.push(`(${parts.join(" OR ")})`);
    }
    return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  }

  private buildOrderLimit(params: Params): string {
    let sql = "";
    if (this.orderBy.length) {
      sql += " ORDER BY " + this.orderBy
        .map((o) => `${qid(o.col)} ${o.asc ? "ASC" : "DESC"}${o.nullsFirst === true ? " NULLS FIRST" : o.nullsFirst === false ? " NULLS LAST" : ""}`)
        .join(", ");
    }
    if (this.rangeFromTo) {
      const [from, to] = this.rangeFromTo;
      const limit = to - from + 1;
      params.push(limit); sql += ` LIMIT $${params.length}`;
      params.push(from); sql += ` OFFSET $${params.length}`;
    } else if (this.limitN != null) {
      params.push(this.limitN); sql += ` LIMIT $${params.length}`;
    }
    return sql;
  }

  private async buildSelectList(sel: string, params: Params, ctxTable?: string): Promise<string> {
    const parts = parseSelect(sel);
    if (parts.length === 1 && parts[0].raw === "*") return "*";
    const fks = await loadForeignKeys(this.pool);
    const cols: string[] = [];
    const table = ctxTable ?? this.table;
    for (const p of parts) {
      if (p.type === "column") {
        if (p.raw === "*") cols.push("*");
        else if (p.alias && p.table) cols.push(`${qid(p.table)} AS ${qid(p.alias)}`);
        else cols.push(qid(p.raw));
      } else {
        const embedTable = p.table!;
        const alias = p.alias || embedTable;
        const innerCols = (p.inner || "*").trim();
        const fkHint = p.fkHint;
        const m2oCandidates = fks.filter(
          (f) => f.srcTable === table && f.tgtTable === embedTable
        );
        const m2o = fkHint
          ? m2oCandidates.find((f) => f.srcCol === fkHint) ?? m2oCandidates[0]
          : m2oCandidates[0];
        const o2mCandidates = fks.filter(
          (f) => f.srcTable === embedTable && f.tgtTable === table
        );
        const o2m = fkHint
          ? o2mCandidates.find((f) => f.srcCol === fkHint) ?? o2mCandidates[0]
          : o2mCandidates[0];
        const innerSelect =
          innerCols === "*" ? "*" : await this.buildSelectList(innerCols, params, embedTable);
        if (m2o) {
          cols.push(
            `(SELECT row_to_json(e) FROM (SELECT ${innerSelect} FROM ${qid(m2o.tgtSchema)}.${qid(embedTable)} WHERE ${qid(m2o.tgtCol)} = ${qid(table)}.${qid(m2o.srcCol)}) e) AS ${qid(alias)}`
          );
        } else if (o2m) {
          cols.push(
            `COALESCE((SELECT json_agg(e) FROM (SELECT ${innerSelect} FROM ${qid(o2m.srcSchema)}.${qid(embedTable)} WHERE ${qid(o2m.srcCol)} = ${qid(table)}.${qid(o2m.tgtCol)}) e), '[]'::json) AS ${qid(alias)}`
          );
        } else {
          throw new Error(`Tidak ada relasi FK antara ${table} dan ${embedTable} untuk embed`);
        }
      }
    }
    return cols.join(", ");
  }

  private async exec(): Promise<PgResult<T>> {
    const params: Params = [];
    let totalCount: number | null = null;
    try {
      let sql = "";
      if (this.action === "select") {
        if (this.wantCount && this.headOnly) {
          sql = `SELECT count(*)::int AS count FROM ${this.qt()} ${this.buildWhere(params)}`;
          const { rows } = await this.pool.query<{ count: number }>(sql, params);
          return { data: null, error: null, count: rows[0]?.count ?? 0, status: 200 };
        }
        if (this.wantCount) {
          const countParams: Params = [];
          const countSql = `SELECT count(*)::int AS count FROM ${this.qt()} ${this.buildWhere(countParams)}`;
          const countResult = await this.pool.query<{ count: number }>(countSql, countParams);
          totalCount = countResult.rows[0]?.count ?? 0;
        }

        const selectList = await this.buildSelectList(this.selectStr, params);
        sql = `SELECT ${selectList} FROM ${this.qt()} ${this.buildWhere(params)}${this.buildOrderLimit(params)}`;
      } else if (this.action === "insert") {
        await this.primeJsonCols();
        sql = this.buildInsert(this.payloadRows(), params);
      } else if (this.action === "upsert") {
        await this.primeJsonCols();
        sql = this.buildInsert(this.payloadRows(), params, true);
      } else if (this.action === "update") {
        await this.primeJsonCols();
        sql = this.buildUpdate(params);
      } else if (this.action === "delete") {
        sql = `DELETE FROM ${this.qt()} ${this.buildWhere(params)}`;
        if (this.returningSelect) sql += ` RETURNING ${this.buildReturning(this.returningSelect)}`;
      }

      const { rows } = await this.pool.query(sql, params);
      let data: unknown = rows;
      const count =
        this.action === "select" && this.wantCount
          ? (typeof totalCount === "number" ? totalCount : rows.length)
          : this.wantCount
            ? rows.length
            : null;
      if (this.singleMode) {
        if (rows.length === 0) {
          if (this.singleMode === "maybe") return { data: null, error: null, count, status: 200 };
          return { data: null, error: { message: "No rows found", code: "PGRST116" }, count, status: 406 };
        }
        data = rows[0];
      }
      // insert/update/delete tanpa returning -> data null
      if ((this.action !== "select") && !this.returningSelect && !this.singleMode) {
        data = null;
      }
      return { data: data as T, error: null, count, status: 200 };
    } catch (err) {
      const { message, code } = err as { message?: string; code?: string };
      return { data: null, error: { message: message ?? String(err), code }, count: null, status: 400 };
    }
  }

  // RETURNING hanya menerima kolom polos — segmen embed ("brands(name)",
  // "brand:brands(name)") dibuang; kalau tidak tersisa kolom, pakai "*".
  private buildReturning(sel: string): string {
    if (sel === "*") return "*";
    const plain = splitTopLevel(sel)
      .map((c) => c.trim())
      .filter((c) => !c.includes("("));
    if (plain.length === 0 || plain.includes("*")) return "*";
    return plain.map(qid).join(", ");
  }

  private buildInsert(rows: readonly Record<string, unknown>[], params: Params, upsert = false): string {
    const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    const colSql = cols.map(qid).join(", ");
    const valuesSql = rows
      .map((r) => `(${cols.map((c) => { params.push(pgValue(r[c], this.jsonCols.has(c))); return `$${params.length}`; }).join(", ")})`)
      .join(", ");
    let sql = `INSERT INTO ${this.qt()} (${colSql}) VALUES ${valuesSql}`;
    if (upsert) {
      const conflict = this.upsertConflict ? this.upsertConflict.split(",").map((c) => qid(c.trim())).join(", ") : null;
      if (conflict) {
        const updates = cols.filter((c) => !this.upsertConflict!.split(",").map((s) => s.trim()).includes(c));
        sql += ` ON CONFLICT (${conflict}) DO UPDATE SET ${updates.map((c) => `${qid(c)} = EXCLUDED.${qid(c)}`).join(", ")}`;
      } else {
        sql += ` ON CONFLICT DO NOTHING`;
      }
    }
    if (this.returningSelect || this.singleMode) {
      sql += ` RETURNING ${this.buildReturning(this.returningSelect ?? "*")}`;
    }
    return sql;
  }

  private buildUpdate(params: Params): string {
    const entries = Object.entries(this.payload ?? {});
    const setSql = entries.map(([k, v]) => { params.push(pgValue(v, this.jsonCols.has(k))); return `${qid(k)} = $${params.length}`; }).join(", ");
    let sql = `UPDATE ${this.qt()} SET ${setSql} ${this.buildWhere(params)}`;
    if (this.returningSelect || this.singleMode) {
      sql += ` RETURNING ${this.buildReturning(this.returningSelect ?? "*")}`;
    }
    return sql;
  }

  // PromiseLike: await builder
  then<TResult1 = PgResult<T>, TResult2 = never>(
    onfulfilled?: ((value: PgResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

export function resetFkCache() {
  fkCache = null;
  jsonColsCache = null;
  tableSchemaCache = null;
}
