/** Konsol pembayaran online: top-up QRIS Xendit dari kasir & portal member. */
import { z } from "zod";
import { getPool } from "@/lib/db";
import { WalletError, WALLET_COLUMNS, type WalletRow } from "./server";

export const paymentFiltersSchema = z.object({
  status: z.enum(["pending", "completed", "expired", "failed", "cancelled"]).optional(),
  source: z.enum(["cashier", "member"]).optional(),
  q: z.string().trim().max(80).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type PaymentFilters = z.infer<typeof paymentFiltersSchema>;

const SOURCE_SQL = `COALESCE(w.metadata->>'source', 'cashier')`;

function buildWhere(f: PaymentFilters, withStatus: boolean) {
  const clauses = [`w.type = 'topup'`, `lower(COALESCE(w.payment_method, '')) = 'qris'`];
  const params: unknown[] = [];
  const p = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (withStatus && f.status) clauses.push(`w.status = ${p(f.status)}`);
  if (f.source) clauses.push(`${SOURCE_SQL} = ${p(f.source)}`);
  if (f.from) clauses.push(`w.created_at >= (${p(f.from)}::date)::timestamptz`);
  if (f.to) clauses.push(`w.created_at < (${p(f.to)}::date + 1)::timestamptz`);
  if (f.q) {
    const t = p(`%${f.q}%`);
    clauses.push(`(c.name ILIKE ${t} OR c.phone ILIKE ${t} OR w.xendit_transaction_id ILIKE ${t} OR w.reference_id ILIKE ${t})`);
  }
  return { sql: clauses.join(" AND "), params };
}

export async function listOnlinePayments(f: PaymentFilters) {
  const pool = getPool();
  const list = buildWhere(f, true);
  const summary = buildWhere(f, false);
  const [{ rows }, { rows: totals }] = await Promise.all([
    pool.query(
      `SELECT w.id, w.status, w.amount::float AS amount, w.xendit_transaction_id, w.reference_id, w.created_at,
              w.metadata->>'credited_at' AS paid_at, ${SOURCE_SQL} AS source,
              w.metadata->>'package_name' AS package_name, w.metadata->>'environment' AS environment,
              COALESCE((w.metadata->>'simulated')::boolean, false) AS simulated,
              w.metadata->>'refunded_at' AS refunded_at, w.customer_id, c.name AS member_name, c.phone AS member_phone
         FROM pos.pos_wallet_transactions w LEFT JOIN pos.pos_customers c ON c.id = w.customer_id
        WHERE ${list.sql}
        ORDER BY w.created_at DESC LIMIT ${f.limit}`,
      list.params
    ),
    pool.query(
      `SELECT w.status, count(*)::int AS count, COALESCE(sum(w.amount), 0)::float AS amount
         FROM pos.pos_wallet_transactions w LEFT JOIN pos.pos_customers c ON c.id = w.customer_id
        WHERE ${summary.sql} GROUP BY w.status`,
      summary.params
    ),
  ]);
  return { payments: rows, summary: totals as { status: string; count: number; amount: number }[] };
}

export async function loadOnlinePayment(id: string) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${WALLET_COLUMNS} FROM pos.pos_wallet_transactions WHERE id = $1 AND type = 'topup'`,
    [id]
  );
  const payment = rows[0] as WalletRow | undefined;
  if (!payment) throw new WalletError("Pembayaran tidak ditemukan", 404);
  const [{ rows: member }, { rows: related }] = await Promise.all([
    pool.query(`SELECT id, name, phone, COALESCE(ark_coin_balance, 0)::float AS balance FROM pos.pos_customers WHERE id = $1`, [
      payment.customer_id,
    ]),
    pool.query(
      `SELECT ${WALLET_COLUMNS} FROM pos.pos_wallet_transactions
        WHERE metadata->>'source_topup_id' = $1 OR metadata->>'refunds_topup_id' = $1 OR metadata->>'reverses_id' = $1
        ORDER BY created_at`,
      [id]
    ),
  ]);
  return { payment, member: member[0] ?? null, related };
}
