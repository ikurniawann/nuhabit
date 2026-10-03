/**
 * Kebijakan akses untuk proxy browser `/api/db/query` dan `/api/db/rpc`.
 *
 * Deny-by-default: hanya pasangan schema.table di DB_QUERY_POLICY yang boleh
 * dipanggil dari browser, dengan aksi dan prefix IAM yang tercantum. Inventaris
 * pemakaian klien ada di docs/security/db-query-allowlist.md. Fitur baru
 * sebaiknya memakai API route khusus, bukan menambah entri di sini.
 *
 * Modul ini murni (tanpa akses DB) supaya bisa diuji langsung.
 */
import { hasAnyIamMenuPrefix } from "@/lib/iam/match";
import { IAM } from "@/lib/iam/prefixes";

export type DbAction = "select" | "insert" | "update" | "upsert" | "delete";

export interface DbFilter {
  col: string;
  op: string;
  value: unknown;
}

interface TablePolicy {
  actions: readonly DbAction[];
  /** User wajib punya minimal satu menu IAM di bawah salah satu prefix ini. */
  iamPrefixes: readonly string[];
  /** Embed PostgREST yang boleh dipakai dari tabel ini: nama embed -> schema.table. */
  embeds?: Readonly<Record<string, string>>;
}

interface SelfRowPolicy {
  /** Kolom id yang dipaksa sama dengan id user sesi. */
  idColumn: string;
  /** Kolom yang boleh dibaca. "*" dan embed ditolak. */
  columns: readonly string[];
}

export const DB_QUERY_POLICY: Readonly<Record<string, TablePolicy>> = {
  "recruitment.candidates": {
    actions: ["select", "insert", "update", "delete"],
    iamPrefixes: IAM.hrisRecruitment,
    embeds: { brands: "item.brands", positions: "hris.positions" },
  },
  "recruitment.candidate_activities": { actions: ["select"], iamPrefixes: IAM.hrisRecruitment },
  "recruitment.candidate_notes": { actions: ["select"], iamPrefixes: IAM.hrisRecruitment },
  "item.brands": { actions: ["select"], iamPrefixes: IAM.hrisRecruitment },
  "hris.positions": {
    actions: ["select"],
    iamPrefixes: IAM.hrisRecruitment,
    embeds: { brands: "item.brands" },
  },
  "hris.departments": {
    actions: ["select"],
    iamPrefixes: ["hris.organization", "hris.master"],
  },
};

/** Baris milik user sendiri: hanya select, filter id disuntik di server. */
export const DB_SELF_ROW_POLICY: Readonly<Record<string, SelfRowPolicy>> = {
  "configuration.users": {
    idColumn: "id",
    // pos_pin sengaja tidak ada di daftar.
    columns: ["id", "full_name", "role", "email", "brand_id", "status", "company_id", "branch_id"],
  },
};

/** Fungsi Postgres yang boleh dipanggil lewat /api/db/rpc. Kosong: tidak ada pemakai klien. */
export const DB_RPC_ALLOWLIST: readonly string[] = [];

/**
 * super_admin melewati cek prefix IAM HANYA untuk select pada tabel yang ada di
 * allowlist. Tabel di luar allowlist, auth.*, dan aksi tulis tetap ditolak.
 */
export const SUPER_ADMIN_READ_BYPASS = true;

export const DB_QUERY_FORBIDDEN_MESSAGE = "Query not permitted";
export const DB_QUERY_FORBIDDEN_CODE = "DB_QUERY_FORBIDDEN";

const ACTIONS: readonly DbAction[] = ["select", "insert", "update", "upsert", "delete"];
const NEVER_SCHEMAS = new Set(["auth", "pg_catalog", "information_schema"]);
const NO_WRITE_SCHEMAS = new Set(["iam"]);
const NO_WRITE_TABLES = new Set(["configuration.users"]);

/**
 * Operator filter mentah dari spec masuk ke SQL apa adanya di QueryBuilder,
 * jadi wajib dibatasi ke daftar ini.
 */
const BASE_OPS = ["=", "<>", ">", ">=", "<", "<=", "LIKE", "ILIKE", "IS", "IN", "@>"];
const FILTER_OPS = new Set([...BASE_OPS, ...BASE_OPS.map((op) => `NOT ${op}`)]);

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENT.test(value);
}

export function isDbAction(value: unknown): value is DbAction {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

export interface DbQueryRequest {
  /** Schema hasil resolusi (bukan "public" bawaan klien). */
  schema: string;
  table: string;
  action: DbAction;
  select?: string | null;
  returningSelect?: string | null;
  filters?: readonly DbFilter[];
  orFilters?: readonly string[];
  userId: string;
  role: string | null;
  grantedMenuCodes: readonly string[];
}

export type DbQueryDecision =
  | { allowed: true; forcedFilters: DbFilter[] }
  | { allowed: false; reason: string };

const deny = (reason: string): DbQueryDecision => ({ allowed: false, reason });

// Sama dengan splitTopLevel/parseSelect di query-builder.ts. Bagian apa pun yang
// memuat kurung tapi tidak cocok pola embed ditolak, jadi parser ini selalu
// sama atau lebih ketat daripada builder.
const EMBED_ALIASED = /^([\w]+)\s*:\s*([\w]+)(?:![\w]+)?\s*\(([\s\S]*)\)$/;
const EMBED_PLAIN = /^([\w]+)(?:![\w]+)?\s*\(([\s\S]*)\)$/;

type SelectPart = { kind: "column"; name: string } | { kind: "embed"; table: string; inner: string };

function parseSelectParts(sel: string): SelectPart[] | null {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of sel) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth < 0) return null;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (depth !== 0) return null;
  if (cur.trim()) parts.push(cur.trim());

  const out: SelectPart[] = [];
  for (const part of parts) {
    if (part.includes("(") || part.includes(")")) {
      const aliased = part.match(EMBED_ALIASED);
      if (aliased) {
        out.push({ kind: "embed", table: aliased[2], inner: aliased[3] });
        continue;
      }
      const plain = part.match(EMBED_PLAIN);
      if (!plain) return null;
      out.push({ kind: "embed", table: plain[1], inner: plain[2] });
      continue;
    }
    // "alias:kolom" dibaca sebagai kolom setelah titik dua.
    const colon = part.indexOf(":");
    out.push({ kind: "column", name: (colon >= 0 ? part.slice(colon + 1) : part).trim() });
  }
  return out;
}

function canRead(key: string, req: DbQueryRequest): boolean {
  const policy = DB_QUERY_POLICY[key];
  if (!policy || !policy.actions.includes("select")) return false;
  if (SUPER_ADMIN_READ_BYPASS && req.role === "super_admin") return true;
  return hasAnyIamMenuPrefix(req.grantedMenuCodes, policy.iamPrefixes);
}

/** Null bila semua embed di select boleh dibaca; selain itu alasan penolakan. */
function checkEmbeds(sel: string, tableKey: string, req: DbQueryRequest): string | null {
  const parts = parseSelectParts(sel);
  if (!parts) return "malformed select";
  for (const part of parts) {
    if (part.kind !== "embed") continue;
    const target = DB_QUERY_POLICY[tableKey]?.embeds?.[part.table];
    if (!target) return `embed ${part.table} not allowed`;
    if (!canRead(target, req)) return `embed ${part.table} denied`;
    const nested = checkEmbeds(part.inner.trim() || "*", target, req);
    if (nested) return nested;
  }
  return null;
}

function checkSelfRow(policy: SelfRowPolicy, req: DbQueryRequest): DbQueryDecision {
  if (req.action !== "select") return deny("self-row table is read-only");
  const parts = parseSelectParts(req.select || "*");
  if (!parts) return deny("malformed select");
  for (const part of parts) {
    if (part.kind !== "column" || !policy.columns.includes(part.name)) {
      return deny(`column ${part.kind === "column" ? part.name : part.table} not allowed`);
    }
  }
  return {
    allowed: true,
    forcedFilters: [{ col: policy.idColumn, op: "=", value: req.userId }],
  };
}

export function evaluateDbQuery(req: DbQueryRequest): DbQueryDecision {
  if (!isSafeIdentifier(req.schema) || !isSafeIdentifier(req.table)) {
    return deny("invalid identifier");
  }
  if (!isDbAction(req.action)) return deny("unknown action");
  if ([req.select, req.returningSelect].some((s) => s != null && typeof s !== "string")) {
    return deny("malformed select");
  }
  const key = `${req.schema}.${req.table}`;
  const isWrite = req.action !== "select";

  if (NEVER_SCHEMAS.has(req.schema)) return deny("schema is never exposed");
  if (isWrite && (NO_WRITE_SCHEMAS.has(req.schema) || NO_WRITE_TABLES.has(key))) {
    return deny("writes to this table are never allowed");
  }

  for (const f of req.filters ?? []) {
    if (!f || !isSafeIdentifier(f.col) || typeof f.op !== "string" || !FILTER_OPS.has(f.op)) {
      return deny("invalid filter");
    }
  }
  // UPDATE/DELETE tanpa filter menyentuh seluruh tabel.
  if ((req.action === "update" || req.action === "delete") && !req.filters?.length && !req.orFilters?.length) {
    return deny("update/delete requires a filter");
  }

  const selfRow = DB_SELF_ROW_POLICY[key];
  if (selfRow) return checkSelfRow(selfRow, req);

  const policy = DB_QUERY_POLICY[key];
  if (!policy) return deny("table not allowlisted");
  if (!policy.actions.includes(req.action)) return deny("action not allowlisted");

  if (isWrite) {
    if (!hasAnyIamMenuPrefix(req.grantedMenuCodes, policy.iamPrefixes)) return deny("missing IAM grant");
  } else if (!canRead(key, req)) {
    return deny("missing IAM grant");
  }

  for (const sel of [req.select, req.returningSelect]) {
    if (!sel) continue;
    const embedError = checkEmbeds(sel, key, req);
    if (embedError) return deny(embedError);
  }

  return { allowed: true, forcedFilters: [] };
}

export function isRpcAllowed(fn: unknown): boolean {
  return isSafeIdentifier(fn) && DB_RPC_ALLOWLIST.includes(fn);
}
