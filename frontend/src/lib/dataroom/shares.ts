import crypto from "crypto";
import bcrypt from "bcryptjs";
import { query, queryOne } from "@/lib/db";

/**
 * Link berbagi Dataroom: publik atau email tertentu (verifikasi kode 6 digit
 * via email), PIN opsional, masa aktif, watermark. Penerima memegang cookie
 * sesi acak (dataroom.share_sessions) — tanpa JWT/secret tambahan.
 */

export type ShareAccessType = "public" | "email";

export interface DataroomShare {
  id: string;
  token: string;
  node_id: string;
  access_type: ShareAccessType;
  allowed_emails: string[];
  pin_hash: string | null;
  watermark: boolean;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
  last_accessed_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface ShareSession {
  id: string;
  share_id: string;
  session_token: string;
  email: string | null;
  email_ok: boolean;
  pin_ok: boolean;
  expires_at: string;
}

const SHARE_COLS = `id, token, node_id, access_type, allowed_emails, pin_hash, watermark, expires_at,
  revoked_at, view_count, last_accessed_at, created_by, created_by_name, created_at`;

export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
export const EMAIL_CODE_TTL_MS = 10 * 60_000;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
export const SESSION_TTL_MS = 24 * 3_600_000;
/** PIN link: 5 salah dalam 15 menit → link terkunci 30 menit (auth.attempt_limits). */
export const SHARE_PIN_SCOPE = "dataroom_share_pin";
export const SHARE_PIN_POLICY = { maxFailures: 5, windowMs: 15 * 60_000, lockoutMs: 30 * 60_000 };

export function generateShareToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function sessionCookieName(token: string): string {
  return `drs_${token}`;
}

/** Pure: email termasuk daftar penerima (case-insensitive). */
export function isEmailAllowed(allowed: readonly string[], email: string): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  return Boolean(e) && allowed.some((a) => a.trim().toLowerCase() === e);
}

/** Pure: link masih bisa dipakai (belum dicabut & belum kedaluwarsa). */
export function isShareActive(share: Pick<DataroomShare, "revoked_at" | "expires_at">, now: Date = new Date()): boolean {
  return !share.revoked_at && new Date(share.expires_at).getTime() > now.getTime();
}

/** Pure: langkah verifikasi yang masih kurang untuk sesi ini. */
export function pendingSteps(
  share: Pick<DataroomShare, "access_type" | "pin_hash">,
  session: Pick<ShareSession, "email_ok" | "pin_ok"> | null
): { needEmail: boolean; needPin: boolean } {
  return {
    needEmail: share.access_type === "email" && !session?.email_ok,
    needPin: Boolean(share.pin_hash) && !session?.pin_ok,
  };
}

export function hashEmailCode(shareId: string, email: string, code: string): string {
  return crypto.createHash("sha256").update(`${shareId}:${email.toLowerCase()}:${code}`).digest("hex");
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash).catch(() => false);
}

export async function createShare(input: {
  nodeId: string; accessType: ShareAccessType; allowedEmails: string[]; pin: string | null;
  watermark: boolean; expiresAt: Date; userId: string | null; userName: string | null;
}): Promise<DataroomShare> {
  const token = generateShareToken();
  const pinHash = input.pin ? await hashPin(input.pin) : null;
  const row = await queryOne(
    `INSERT INTO dataroom.shares (token, node_id, access_type, allowed_emails, pin_hash, watermark, expires_at, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${SHARE_COLS}`,
    [token, input.nodeId, input.accessType, input.allowedEmails, pinHash, input.watermark, input.expiresAt.toISOString(), input.userId, input.userName]
  );
  return row as unknown as DataroomShare;
}

export async function getShareById(id: string): Promise<DataroomShare | null> {
  return (await queryOne(`SELECT ${SHARE_COLS} FROM dataroom.shares WHERE id = $1`, [id])) as DataroomShare | null;
}

export async function findShareByToken(token: string): Promise<DataroomShare | null> {
  if (!SHARE_TOKEN_RE.test(token)) return null;
  return (await queryOne(`SELECT ${SHARE_COLS} FROM dataroom.shares WHERE token = $1`, [token])) as DataroomShare | null;
}

export async function revokeShare(id: string): Promise<boolean> {
  const rows = await query(`UPDATE dataroom.shares SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id`, [id]);
  return rows.length > 0;
}

export interface ShareListRow extends DataroomShare {
  node_name: string; node_kind: "folder" | "file"; node_parent_id: string | null; access_count: number;
}

/** Daftar link (untuk satu node, atau semua) + nama node & jumlah akses. */
export async function listShares(nodeId?: string | null): Promise<ShareListRow[]> {
  const where = nodeId ? `WHERE s.node_id = $1` : ``;
  const rows = await query(
    `SELECT s.id, s.token, s.node_id, s.access_type, s.allowed_emails, s.pin_hash, s.watermark, s.expires_at,
            s.revoked_at, s.view_count, s.last_accessed_at, s.created_by, s.created_by_name, s.created_at,
            n.name AS node_name, n.kind AS node_kind, n.parent_id AS node_parent_id,
            (SELECT COUNT(*) FROM dataroom.share_access_logs l WHERE l.share_id = s.id AND l.action IN ('view','download'))::int AS access_count
     FROM dataroom.shares s JOIN dataroom.nodes n ON n.id = s.node_id
     ${where}
     ORDER BY s.created_at DESC LIMIT 300`,
    nodeId ? [nodeId] : []
  );
  return rows as unknown as ShareListRow[];
}

export async function touchShare(id: string): Promise<void> {
  await query(`UPDATE dataroom.shares SET view_count = view_count + 1, last_accessed_at = now() WHERE id = $1`, [id]);
}

export type ShareAccessAction = "open" | "code_sent" | "verified" | "pin_failed" | "code_failed" | "view" | "download";

export async function logShareAccess(input: {
  shareId: string; nodeId?: string | null; action: ShareAccessAction; fileName?: string | null;
  email?: string | null; ip?: string | null; userAgent?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO dataroom.share_access_logs (share_id, node_id, action, file_name, email, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.shareId, input.nodeId ?? null, input.action, input.fileName?.slice(0, 255) ?? null,
     input.email?.toLowerCase().slice(0, 255) ?? null, input.ip?.slice(0, 64) ?? null, input.userAgent?.slice(0, 255) ?? null]
  ).catch((err) => console.warn("[dataroom] gagal tulis log akses:", err instanceof Error ? err.message : err));
}

export async function listShareLogs(shareId: string, limit = 200) {
  return query(
    `SELECT id, node_id, action, file_name, email, ip, user_agent, created_at
     FROM dataroom.share_access_logs WHERE share_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [shareId, limit]
  );
}

// ── Sesi penerima ──────────────────────────────────────────────────────────

export async function getSession(shareId: string, sessionToken: string | undefined | null): Promise<ShareSession | null> {
  if (!sessionToken || !SHARE_TOKEN_RE.test(sessionToken)) return null;
  return (await queryOne(
    `SELECT id, share_id, session_token, email, email_ok, pin_ok, expires_at
     FROM dataroom.share_sessions WHERE share_id = $1 AND session_token = $2 AND expires_at > now()`,
    [shareId, sessionToken]
  )) as ShareSession | null;
}

export async function upsertSession(input: {
  existing: ShareSession | null; shareId: string; shareExpiresAt: string;
  email?: string | null; emailOk?: boolean; pinOk?: boolean; ip?: string | null; userAgent?: string | null;
}): Promise<ShareSession> {
  const expires = new Date(Math.min(Date.now() + SESSION_TTL_MS, new Date(input.shareExpiresAt).getTime()));
  if (input.existing) {
    const row = await queryOne(
      `UPDATE dataroom.share_sessions
       SET email = COALESCE($2, email), email_ok = email_ok OR $3, pin_ok = pin_ok OR $4, expires_at = $5
       WHERE id = $1 RETURNING id, share_id, session_token, email, email_ok, pin_ok, expires_at`,
      [input.existing.id, input.email ?? null, Boolean(input.emailOk), Boolean(input.pinOk), expires.toISOString()]
    );
    return row as unknown as ShareSession;
  }
  const row = await queryOne(
    `INSERT INTO dataroom.share_sessions (share_id, session_token, email, email_ok, pin_ok, ip, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, share_id, session_token, email, email_ok, pin_ok, expires_at`,
    [input.shareId, generateShareToken(), input.email ?? null, Boolean(input.emailOk), Boolean(input.pinOk),
     input.ip?.slice(0, 64) ?? null, input.userAgent?.slice(0, 255) ?? null, expires.toISOString()]
  );
  return row as unknown as ShareSession;
}

// ── Kode verifikasi email ──────────────────────────────────────────────────

export async function issueEmailCode(shareId: string, email: string): Promise<string> {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const e = email.trim().toLowerCase();
  await query(`DELETE FROM dataroom.share_email_codes WHERE share_id = $1 AND lower(email) = $2`, [shareId, e]);
  await query(
    `INSERT INTO dataroom.share_email_codes (share_id, email, code_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [shareId, e, hashEmailCode(shareId, e, code), new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString()]
  );
  return code;
}

export type EmailCodeResult = "ok" | "invalid" | "expired" | "too_many" | "missing";

export async function verifyEmailCode(shareId: string, email: string, code: string): Promise<EmailCodeResult> {
  const e = email.trim().toLowerCase();
  const row = await queryOne<{ id: string; code_hash: string; attempts: number; expires_at: string }>(
    `SELECT id, code_hash, attempts, expires_at FROM dataroom.share_email_codes
     WHERE share_id = $1 AND lower(email) = $2 ORDER BY created_at DESC LIMIT 1`,
    [shareId, e]
  );
  if (!row) return "missing";
  if (new Date(row.expires_at).getTime() < Date.now()) return "expired";
  if (row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) return "too_many";
  const ok = crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(hashEmailCode(shareId, e, String(code).trim())));
  if (!ok) {
    await query(`UPDATE dataroom.share_email_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    return "invalid";
  }
  await query(`DELETE FROM dataroom.share_email_codes WHERE id = $1`, [row.id]);
  return "ok";
}
