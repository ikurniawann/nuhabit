import crypto from "crypto";
import { query, queryOne } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { API_TOKEN_PREFIX } from "@/lib/auth/api-token-format";

/**
 * EPIC-042: Open API token — autentikasi machine-to-machine untuk SEMUA
 * endpoint /api/* (integrasi agent eksternal, mis. OpenClaw).
 *
 * Model:
 * - Token `nh_<64 hex>` (token lama `arkiv_` tetap diterima, lihat
 *   api-token-format.ts) — DB hanya menyimpan hash SHA-256-nya.
 * - Token menempel ke satu akun user (service account): request Bearer
 *   berjalan SEBAGAI user itu, jadi seluruh IAM/menu grant tetap berlaku.
 * - Di atas IAM, token dibatasi lagi oleh SCOPES: '*' = semua, atau
 *   '<modul>:read' / '<modul>:write' (GET/HEAD/OPTIONS = read, sisanya write).
 * - Setiap request token diaudit ke api_token_request_logs (fire-and-forget).
 *
 * Guardrail bisnis TIDAK dilewati token — mis. void tetap butuh PIN
 * supervisor; token hanya menggantikan cookie login, bukan aturan bisnis.
 */

/** Modul scope; path /api/<segmen> dipetakan ke salah satu kunci ini. */
export const API_SCOPE_MODULES = [
  "pos",
  "member",
  "hris",
  "inventory",
  "crm",
  "config",
  "reports",
  "other",
] as const;
export type ApiScopeModule = (typeof API_SCOPE_MODULES)[number];

/** Pemetaan segmen pertama path /api/* ke modul scope. Fallback: "other". */
const PATH_MODULE_MAP: Record<string, ApiScopeModule> = {
  pos: "pos",
  "member-portal": "member",
  hris: "hris",
  hr: "hris",
  payroll: "hris",
  inventory: "inventory",
  products: "inventory",
  warehouses: "inventory",
  crm: "crm",
  wa: "crm",
  settings: "config",
  admin: "config",
  iam: "config",
  analytics: "reports",
  dashboard: "reports",
  reports: "reports",
};

export function moduleForApiPath(pathname: string): ApiScopeModule {
  const seg = pathname.replace(/^\/api\/+/, "").split("/")[0]?.toLowerCase() ?? "";
  return PATH_MODULE_MAP[seg] ?? "other";
}

export function accessForMethod(method: string): "read" | "write" {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) ? "read" : "write";
}

/** '*' lolos semua; '<modul>:write' mengizinkan read+write modul itu. */
export function scopeAllows(
  scopes: string[],
  pathname: string,
  method: string
): boolean {
  if (scopes.includes("*")) return true;
  // Spec OpenAPI boleh dibaca token valid mana pun — kebutuhan discovery agent.
  if (pathname === "/api/openapi.json" && accessForMethod(method) === "read") return true;
  const moduleKey = moduleForApiPath(pathname);
  const access = accessForMethod(method);
  if (scopes.includes(`${moduleKey}:write`)) return true;
  return access === "read" && scopes.includes(`${moduleKey}:read`);
}

export function hashApiToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function mintApiToken(): { token: string; hash: string; prefix: string } {
  const token = `${API_TOKEN_PREFIX}${crypto.randomBytes(32).toString("hex")}`;
  return {
    token,
    hash: hashApiToken(token),
    prefix: token.slice(0, API_TOKEN_PREFIX.length + 12),
  };
}

export interface ApiTokenRow {
  id: string;
  name: string;
  user_id: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
}

/**
 * Resolve Bearer token → SessionUser (akun yang diperankan token).
 * null bila token tidak dikenal/kedaluwarsa/dicabut ATAU scope tidak
 * mengizinkan path+method ini. Tabel belum ada (42P01) = fitur belum
 * di-migrate → token auth diam-diam nonaktif, cookie auth tak terganggu.
 */
export async function loadUserByApiToken(
  token: string,
  request: { pathname: string; method: string },
  options?: {
    /**
     * Audit request ke api_token_request_logs. Default false: audit kanonik
     * terjadi SEKALI di middleware (verifyApiTokenRequest); resolusi ulang di
     * route handler tidak boleh menggandakan baris log.
     */
    audit?: boolean;
  }
): Promise<SessionUser | null> {
  let row: (ApiTokenRow & {
    email: string;
    raw_user_meta_data: Record<string, unknown>;
    raw_app_meta_data: Record<string, unknown>;
  }) | null = null;
  try {
    row = await queryOne(
      `SELECT t.id, t.name, t.user_id, t.scopes, t.expires_at, t.revoked_at,
              au.email, au.raw_user_meta_data, au.raw_app_meta_data
       FROM configuration.api_tokens t
       JOIN auth.users au ON au.id = t.user_id
       WHERE t.token_hash = $1
         AND (au.banned_until IS NULL OR au.banned_until < NOW())`,
      [hashApiToken(token)]
    );
  } catch (error) {
    if ((error as { code?: string })?.code === "42P01") return null;
    throw error;
  }
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at) <= new Date()) return null;

  const allowed = scopeAllows(row.scopes ?? [], request.pathname, request.method);
  if (options?.audit) logTokenRequest(row.id, request, allowed);
  if (!allowed) return null;

  return {
    id: row.user_id,
    email: row.email,
    user_metadata: row.raw_user_meta_data ?? {},
    app_metadata: {
      ...(row.raw_app_meta_data ?? {}),
      // Penanda utk endpoint yang HARUS manusia (mis. kelola token sendiri).
      auth_via: "api_token",
      api_token_id: row.id,
      api_token_scopes: row.scopes ?? [],
    },
  };
}

/** Audit + last_used, fire-and-forget: kegagalan log tidak menggagalkan request. */
function logTokenRequest(
  tokenId: string,
  request: { pathname: string; method: string },
  allowed: boolean
) {
  void query(
    `INSERT INTO configuration.api_token_request_logs (token_id, method, path, allowed)
     VALUES ($1, $2, $3, $4)`,
    [tokenId, request.method.slice(0, 10), request.pathname.slice(0, 500), allowed]
  ).catch(() => {});
  void query(
    `UPDATE configuration.api_tokens SET last_used_at = now() WHERE id = $1`,
    [tokenId]
  ).catch(() => {});
}

/**
 * Gerbang middleware (proxy Node runtime): validasi token + scope SEBELUM
 * request menyentuh route — penting karena sebagian route lama mengandalkan
 * gerbang cookie middleware dan tidak punya cek sesi sendiri. Sekalian jadi
 * titik audit kanonik (sekali per request).
 */
export async function verifyApiTokenRequest(
  token: string,
  request: { pathname: string; method: string }
): Promise<boolean> {
  const user = await loadUserByApiToken(token, request, { audit: true });
  return user !== null;
}

/** true bila SessionUser ini hasil autentikasi Bearer token (bukan manusia). */
export function isApiTokenSession(user: Pick<SessionUser, "app_metadata"> | null): boolean {
  return user?.app_metadata?.auth_via === "api_token";
}
