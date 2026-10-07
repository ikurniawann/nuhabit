import { randomBytes } from "crypto";
import { cookies, headers } from "next/headers";
import { getPool } from "@/lib/db";
import { hashSecret } from "./otp";
import { isSecureRequest } from "@/lib/auth/secure-cookie";

/**
 * Sesi portal member — cookie `member_session` TERPISAH total dari
 * `arkiv_session` (portal publik utk member, bukan user internal).
 * Token acak 32 byte; DB hanya menyimpan hash-nya.
 *
 * EPIC-044 (mobile app): selain cookie, sesi boleh datang dari header
 * `Authorization: Bearer <token>` — token yang sama persis dengan isi cookie,
 * dibuat oleh endpoint verify yang sama. Bearer diprioritaskan agar klien app
 * yang mengirim eksplisit tidak tersandung cookie sisa browser. Portal web
 * tidak berubah perilaku (cookie tetap jalurnya).
 */

export const MEMBER_SESSION_COOKIE = "member_session";
export const MEMBER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

export interface MemberSession {
  customerId: string;
  sessionId: string;
}

/** Ambil token dari nilai header Authorization ("Bearer <token>") — pure, mudah dites. */
export function bearerTokenFromAuthHeader(
  header: string | null | undefined
): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** Token sesi dari permintaan berjalan: Bearer header lebih dulu, lalu cookie. */
async function resolveSessionToken(): Promise<string | null> {
  const headerStore = await headers();
  const bearer = bearerTokenFromAuthHeader(headerStore.get("authorization"));
  if (bearer) return bearer;

  const cookieStore = await cookies();
  return cookieStore.get(MEMBER_SESSION_COOKIE)?.value ?? null;
}

export async function createMemberSession(customerId: string): Promise<string> {
  const pool = getPool();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + MEMBER_SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO crm.member_portal_sessions (token_hash, customer_id, expires_at)
     VALUES ($1, $2, $3)`,
    [hashSecret(token), customerId, expiresAt]
  );
  return token;
}

export async function getMemberSession(): Promise<MemberSession | null> {
  const token = await resolveSessionToken();
  if (!token) return null;

  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE crm.member_portal_sessions
     SET last_seen_at = now()
     WHERE token_hash = $1 AND expires_at > now()
     RETURNING id, customer_id`,
    [hashSecret(token)]
  );
  if (rows.length === 0) return null;
  return { customerId: rows[0].customer_id, sessionId: rows[0].id };
}

export async function destroyMemberSession(): Promise<void> {
  const token = await resolveSessionToken();
  if (!token) return;
  const pool = getPool();
  await pool.query(
    `DELETE FROM crm.member_portal_sessions WHERE token_hash = $1`,
    [hashSecret(token)]
  );
}

/** Opsi cookie sesi member (dipakai route saat set/clear). */
export function memberSessionCookieOptions(request: Request) {
  return {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "lax" as const,
    path: "/",
    maxAge: MEMBER_SESSION_TTL_MS / 1000,
  };
}
