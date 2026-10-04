import { query, withTransaction } from "@/lib/db";

/**
 * Batas percobaan gagal yang durable (tabel auth.attempt_limits) untuk
 * rahasia pendek yang bisa ditebak: PIN supervisor POS dan PIN link berbagi
 * Dataroom. Hitungan disimpan di DB supaya restart tidak mengosongkannya.
 *
 * Aturan: `maxFailures` kegagalan dalam `windowMs` mengunci subject selama
 * `lockoutMs`. Jendela yang lewat atau kunci yang habis memulai hitungan
 * dari nol. Sukses menghapus hitungan (salah ketik tidak menumpuk).
 *
 * Gagal membaca/menulis DB sengaja dilempar (fail closed): untuk PIN 4-6
 * digit, pembatas inilah penjaga utamanya.
 */

export interface AttemptPolicy {
  maxFailures: number;
  windowMs: number;
  lockoutMs: number;
}

export interface AttemptState {
  failures: number;
  windowStartedAt: Date;
  lockedUntil: Date | null;
}

/** Murni: akhir kunci yang masih berlaku, atau null. */
export function activeLock(state: AttemptState | null, now: Date): Date | null {
  if (!state?.lockedUntil) return null;
  return state.lockedUntil.getTime() > now.getTime() ? state.lockedUntil : null;
}

/** Murni: state setelah satu kegagalan lagi. */
export function applyFailure(state: AttemptState | null, now: Date, policy: AttemptPolicy): AttemptState {
  const lockExpired = Boolean(state?.lockedUntil) && !activeLock(state, now);
  const windowExpired = !state || now.getTime() - state.windowStartedAt.getTime() > policy.windowMs;
  const fresh = !state || windowExpired || lockExpired;
  const failures = fresh ? 1 : state.failures + 1;
  const windowStartedAt = fresh ? now : state.windowStartedAt;
  const lockedUntil =
    failures >= policy.maxFailures
      ? new Date(now.getTime() + policy.lockoutMs)
      : fresh
        ? null
        : state.lockedUntil;
  return { failures, windowStartedAt, lockedUntil };
}

/** Murni: sisa menit kunci (dibulatkan ke atas, minimal 1) untuk pesan ke user. */
export function minutesUntil(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
}

type Row = { failures: number; window_started_at: Date; locked_until: Date | null };

function toState(row: Row | undefined): AttemptState | null {
  if (!row) return null;
  return {
    failures: Number(row.failures),
    windowStartedAt: new Date(row.window_started_at),
    lockedUntil: row.locked_until ? new Date(row.locked_until) : null,
  };
}

/** Kunci aktif paling lama di antara subject, atau null bila semua bebas. */
export async function findActiveLock(scope: string, subjects: string[]): Promise<Date | null> {
  const rows = await query<Row>(
    `SELECT failures, window_started_at, locked_until
       FROM auth.attempt_limits
      WHERE scope = $1 AND subject = ANY($2::text[])`,
    [scope, subjects]
  );
  const now = new Date();
  let latest: Date | null = null;
  for (const row of rows) {
    const lock = activeLock(toState(row), now);
    if (lock && (!latest || lock > latest)) latest = lock;
  }
  return latest;
}

const PRUNE_CHANCE = 0.05;

/**
 * Catat satu kegagalan untuk setiap subject (atomik: baris dikunci FOR UPDATE).
 * Mengembalikan kunci aktif terlama setelah pencatatan, atau null.
 */
export async function recordFailure(
  scope: string,
  subjects: string[],
  policy: AttemptPolicy
): Promise<Date | null> {
  const ordered = [...new Set(subjects)].sort(); // urutan tetap → bebas deadlock
  const lock = await withTransaction(async (client) => {
    let latest: Date | null = null;
    for (const subject of ordered) {
      await client.query(
        `INSERT INTO auth.attempt_limits (scope, subject) VALUES ($1, $2)
         ON CONFLICT (scope, subject) DO NOTHING`,
        [scope, subject]
      );
      // Baris baru (failures = 0) otomatis dihitung sebagai kegagalan pertama.
      const { rows } = await client.query<Row>(
        `SELECT failures, window_started_at, locked_until
           FROM auth.attempt_limits
          WHERE scope = $1 AND subject = $2
          FOR UPDATE`,
        [scope, subject]
      );
      const now = new Date();
      const next = applyFailure(toState(rows[0]), now, policy);
      await client.query(
        `UPDATE auth.attempt_limits
            SET failures = $3, window_started_at = $4, locked_until = $5, updated_at = now()
          WHERE scope = $1 AND subject = $2`,
        [scope, subject, next.failures, next.windowStartedAt, next.lockedUntil]
      );
      const active = activeLock(next, now);
      if (active && (!latest || active > latest)) latest = active;
    }
    return latest;
  });

  if (Math.random() < PRUNE_CHANCE) {
    await query(
      `DELETE FROM auth.attempt_limits
        WHERE updated_at < now() - interval '1 day'
          AND (locked_until IS NULL OR locked_until < now())`
    ).catch((error) => console.error("[attempt-limit] gagal memangkas:", error));
  }
  return lock;
}

/** Sukses → hapus hitungan subject itu. */
export async function clearFailures(scope: string, subjects: string[]): Promise<void> {
  await query(`DELETE FROM auth.attempt_limits WHERE scope = $1 AND subject = ANY($2::text[])`, [
    scope,
    subjects,
  ]);
}
