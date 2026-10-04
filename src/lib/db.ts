import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { databaseUrl } from "@/lib/env";

/**
 * Koneksi Postgres native untuk data-access layer, auth, dan modul lain.
 * Dipakai oleh data-access layer, auth, dan modul lain.
 */

let pool: Pool | null = null;

/**
 * search_path global. `public` dulu, lalu schema domain, `auth` PALING AKHIR.
 * Sumber kebenaran urutan: database/schema-map.js (searchPathSchemas()).
 * Tabel diakses "bare" (mis. from("employees")) dan diresolve ke schema yang
 * benar (hris.employees) lewat search_path ini. `auth` di belakang agar bare
 * `users` resolve ke `configuration.users` (bukan `auth.users`).
 */
export const SEARCH_PATH = [
  "public",
  "iam",
  "configuration",
  "hris",
  "performance",
  "recruitment",
  "item",
  "purchasing",
  "inventory",
  "manufacturing",
  "pos",
  "crm",
  "accounting",
  "auth",
].join(",");

// SSL hanya untuk koneksi remote/managed. Postgres lokal umumnya tanpa SSL.
function sslFor(url: string) {
  if (/sslmode=require/i.test(url)) return { rejectUnauthorized: false };
  if (/db\.(co|com)|\.pooler\./i.test(url)) return { rejectUnauthorized: false };
  return undefined;
}

export function getPool(): Pool {
  if (!pool) {
    const cs = databaseUrl();
    if (!cs) throw new Error("DATABASE_URL belum diset");
    pool = new Pool({
      connectionString: cs,
      ssl: sslFor(cs),
      max: 10,
      // Set saat startup koneksi (server-side, sebelum query apa pun).
      // Timezone dipaksa Asia/Jakarta agar cast `::date`/perbandingan
      // timestamptz di kolektor KPI & laporan TIDAK bergantung setting
      // server/role (kalau infra pindah, perilaku tetap sama).
      options: `-c search_path=${SEARCH_PATH} -c timezone=Asia/Jakarta`,
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Efek samping yang menunggu COMMIT, per client yang sedang di dalam withTransaction. */
const pendingAfterCommit = new WeakMap<PoolClient, Array<() => void>>();

/**
 * Jalankan `effect` setelah transaksi `db` COMMIT (dibuang bila ROLLBACK).
 * Di luar withTransaction (pool, atau client tanpa transaksi) langsung jalan.
 * Untuk efek di luar database seperti push notification.
 */
export function afterCommit(db: Pool | PoolClient, effect: () => void) {
  const queue = pendingAfterCommit.get(db as PoolClient);
  if (queue) queue.push(effect);
  else effect();
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  const effects: Array<() => void> = [];
  pendingAfterCommit.set(client, effects);
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    pendingAfterCommit.delete(client);
    for (const effect of effects) effect();
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    pendingAfterCommit.delete(client);
    client.release();
  }
}
