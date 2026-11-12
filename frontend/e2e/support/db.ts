import { Pool } from "pg";

/**
 * Read access to the stack's database, for specs that need a real record id
 * (detail pages) or want to check what a flow wrote. Specs skip when
 * DATABASE_URL is not set.
 */
let pool: Pool | null = null;

export const DB_MISSING = "DATABASE_URL is not set";
export const hasDatabase = () => Boolean(process.env.DATABASE_URL);

function db(): Pool {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  return pool;
}

/** First row of a query, or null. */
export async function firstRow<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const { rows } = await db().query(sql, params);
  return (rows[0] as T | undefined) ?? null;
}

export async function closeDatabase() {
  await pool?.end();
  pool = null;
}
