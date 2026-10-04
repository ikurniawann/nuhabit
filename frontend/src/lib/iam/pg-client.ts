import "server-only";
import { Pool, type QueryResultRow } from "pg";
import { SEARCH_PATH } from "@/lib/db";
import { databaseUrl } from "@/lib/env";

let pool: Pool | null = null;

// SSL hanya untuk koneksi remote/managed. Postgres lokal umumnya
// tidak mendukung SSL, jadi jangan dipaksa.
function getSslOption(url: string) {
  if (/sslmode=require/i.test(url)) return { rejectUnauthorized: false };
  if (/db\.(co|com)|\.pooler\./i.test(url)) return { rejectUnauthorized: false };
  return false as const;
}

export function isIamDbConfigured() {
  return Boolean(databaseUrl());
}

export function getIamPool() {
  const connectionString = databaseUrl();
  if (!connectionString) {
    throw new Error("DATABASE_URL belum diset di .env");
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: getSslOption(connectionString),
      max: 5,
      // Konsisten dgn getPool(): tabel non-iam (mis. configuration.users) tetap
      // resolve bila suatu saat di-join dari query iam.
      options: `-c search_path=${SEARCH_PATH}`,
    });
  }

  return pool;
}

export async function iamDbQuery<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await getIamPool().query<T>(text, params);
  return result.rows;
}

export async function iamDbQueryOne<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await iamDbQuery<T>(text, params);
  return rows[0] ?? null;
}

export async function testIamDbConnection() {
  const row = await iamDbQueryOne<{ ok: number; menu_count: number }>(
    `SELECT 1 AS ok, (
      SELECT COUNT(*)::int FROM iam.menus WHERE deleted_at IS NULL
    ) AS menu_count`
  );
  return row;
}
