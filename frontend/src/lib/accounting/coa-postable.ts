import type { PoolClient, QueryResult } from "pg";
import { query } from "@/lib/db";

/**
 * Recompute is_postable for an account and its ancestor chain.
 * Leaf (no active children) → postable; parents → not postable.
 */
export async function recomputePostableChain(
  accountId: string | null | undefined,
  client?: PoolClient
) {
  if (!accountId) return;

  let currentId: string | null = accountId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const id = currentId;

    if (client) {
      await client.query(
        `UPDATE accounting.chart_of_accounts coa
         SET is_postable = NOT EXISTS (
               SELECT 1
               FROM accounting.chart_of_accounts child
               WHERE child.parent_id = coa.id
                 AND child.deleted_at IS NULL
             ),
             updated_at = now()
         WHERE coa.id = $1`,
        [id]
      );
      const result: QueryResult<{ parent_id: string | null }> = await client.query(
        `SELECT parent_id FROM accounting.chart_of_accounts WHERE id = $1`,
        [id]
      );
      currentId = result.rows[0]?.parent_id ?? null;
    } else {
      await query(
        `UPDATE accounting.chart_of_accounts coa
         SET is_postable = NOT EXISTS (
               SELECT 1
               FROM accounting.chart_of_accounts child
               WHERE child.parent_id = coa.id
                 AND child.deleted_at IS NULL
             ),
             updated_at = now()
         WHERE coa.id = $1`,
        [id]
      );
      const rows: Array<{ parent_id: string | null }> = await query(
        `SELECT parent_id FROM accounting.chart_of_accounts WHERE id = $1`,
        [id]
      );
      currentId = rows[0]?.parent_id ?? null;
    }
  }
}

/** After bulk insert, set postable for all accounts in a company scope. */
export async function recomputePostableForCompany(
  companyId: string,
  client?: PoolClient
) {
  const sql = `
    UPDATE accounting.chart_of_accounts coa
    SET is_postable = NOT EXISTS (
          SELECT 1
          FROM accounting.chart_of_accounts child
          WHERE child.parent_id = coa.id
            AND child.deleted_at IS NULL
        ),
        updated_at = now()
    WHERE coa.deleted_at IS NULL
      AND coa.company_id = $1`;

  if (client) {
    await client.query(sql, [companyId]);
    return;
  }
  await query(sql, [companyId]);
}
