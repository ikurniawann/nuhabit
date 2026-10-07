/**
 * Pembatas laju login yang DURABLE (audit lanjutan 2026-09-17).
 *
 * Versi lama in-memory: hitungannya hilang saat restart dan tidak dibagi
 * antar-instance. Di sini hitungan disimpan di auth.login_attempts sehingga
 * bertahan melewati restart dan konsisten bila nanti multi-instance.
 *
 * Aturan: batas per-AKUN ketat (menahan penebakan password satu akun) dan
 * per-IP longgar — banyak kasir bisa berada di balik satu IP kantor (NAT),
 * jadi IP tidak boleh jadi satu-satunya kunci yang ketat.
 */

import { query, queryOne } from "@/lib/db";

export const LOGIN_WINDOW_MINUTES = 5;
export const LOGIN_MAX_PER_ACCOUNT = 8;
export const LOGIN_MAX_PER_IP = 60;
/** Catatan lebih tua dari ini tidak berguna lagi → dipangkas. */
const PRUNE_OLDER_THAN_MINUTES = 60;
/** Peluang pemangkasan dijalankan pada satu pencatatan (hemat, tanpa cron). */
const PRUNE_CHANCE = 0.05;

export function normalizeAccountKey(email: unknown): string {
  return String(email ?? "").trim().toLowerCase().slice(0, 254);
}

/** Murni: apakah jumlah percobaan sudah mencapai/melewati batas? */
export function exceedsLimit(count: number, limit: number): boolean {
  return count >= limit;
}

/** Murni: keputusan blokir dari dua hitungan. */
export function shouldBlockLogin(input: {
  accountCount: number;
  ipCount: number;
}): boolean {
  return (
    exceedsLimit(input.accountCount, LOGIN_MAX_PER_ACCOUNT) ||
    exceedsLimit(input.ipCount, LOGIN_MAX_PER_IP)
  );
}

export async function isLoginBlocked(accountKey: string, ip: string): Promise<boolean> {
  try {
    const row = await queryOne<{ account_count: number; ip_count: number }>(
      `SELECT
         count(*) FILTER (WHERE account_key = $1)::int AS account_count,
         count(*) FILTER (WHERE ip = $2)::int           AS ip_count
       FROM auth.login_attempts
       WHERE created_at > now() - ($3 || ' minutes')::interval`,
      [accountKey, ip, String(LOGIN_WINDOW_MINUTES)]
    );
    return shouldBlockLogin({
      accountCount: Number(row?.account_count ?? 0),
      ipCount: Number(row?.ip_count ?? 0),
    });
  } catch (error) {
    // Gagal membaca pembatas bukan alasan menolak login: kata sandi tetap
    // jadi penjaga, dan bila DB bermasalah autentikasi pun akan gagal sendiri.
    console.error("[login-throttle] gagal membaca percobaan:", error);
    return false;
  }
}

export async function recordLoginFailure(accountKey: string, ip: string): Promise<void> {
  try {
    await query(
      `INSERT INTO auth.login_attempts (account_key, ip) VALUES ($1, $2)`,
      [accountKey, ip]
    );
    if (Math.random() < PRUNE_CHANCE) {
      await query(
        `DELETE FROM auth.login_attempts
          WHERE created_at < now() - ($1 || ' minutes')::interval`,
        [String(PRUNE_OLDER_THAN_MINUTES)]
      );
    }
  } catch (error) {
    console.error("[login-throttle] gagal mencatat percobaan:", error);
  }
}

/** Login sukses → bersihkan catatan akun itu (salah ketik tidak menumpuk). */
export async function clearLoginFailures(accountKey: string): Promise<void> {
  try {
    await query(`DELETE FROM auth.login_attempts WHERE account_key = $1`, [accountKey]);
  } catch (error) {
    console.error("[login-throttle] gagal membersihkan percobaan:", error);
  }
}
