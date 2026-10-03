import { getPool } from "@/lib/db";
import { gymAdminRoute, ok } from "@/lib/gym/credits-admin-route";
import { IAM } from "@/lib/iam/prefixes";

/**
 * GET ?q= — cari member (nama/telepon) beserta saldo kredit. Tanpa q:
 * 20 member dengan aktivitas kredit terbaru.
 */
export const GET = gymAdminRoute(IAM.gymCredits, "Gagal mencari member", async (_user, request: Request) => {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  const balance = `(SELECT COALESCE(sum(l.amount), 0)::int FROM gym.credit_ledger l WHERE l.customer_id = c.id)`;
  const { rows } =
    q.length >= 2
      ? await getPool().query(
          `SELECT c.id, c.name, c.phone, c.email, COALESCE(c.is_active, true) AS is_active, ${balance} AS balance
             FROM pos.pos_customers c
            WHERE c.name ILIKE $1 OR c.phone ILIKE $1 OR c.email ILIKE $1
            ORDER BY c.name NULLS LAST LIMIT 20`,
          [`%${q}%`]
        )
      : await getPool().query(
          `SELECT c.id, c.name, c.phone, c.email, COALESCE(c.is_active, true) AS is_active, ${balance} AS balance
             FROM pos.pos_customers c
             JOIN (SELECT customer_id, max(created_at) AS last_at FROM gym.credit_ledger GROUP BY customer_id) a
               ON a.customer_id = c.id
            ORDER BY a.last_at DESC LIMIT 20`
        );
  return ok(rows);
});
