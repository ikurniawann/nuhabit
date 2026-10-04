import { query } from "@/lib/db";
import type { RushHourPoint } from "@/lib/pos/rush-hour";

/**
 * Agregat rush hour per (jam, hari ISO) WIB dari transaksi lunas —
 * dipakai bersama oleh route report dan route export Excel supaya
 * definisi datanya identik. Quantity = Σ pos_order_items.quantity,
 * di-join teragregasi agar COUNT transaksi tidak menggandakan diri.
 */

type HourRow = {
  hour: number | string;
  dow: number | string;
  transactions: number | string;
  revenue: number | string;
  quantity: number | string;
};

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchRushHourPoints(input: {
  startIso: string;
  endIso: string;
  warehouseIds: string[] | null;
}): Promise<RushHourPoint[]> {
  const rows = await query<HourRow>(
    `SELECT
       EXTRACT(HOUR FROM o.ordered_at AT TIME ZONE 'Asia/Jakarta')::int AS hour,
       EXTRACT(ISODOW FROM o.ordered_at AT TIME ZONE 'Asia/Jakarta')::int AS dow,
       COUNT(*)::int AS transactions,
       COALESCE(SUM(o.total_amount), 0)::float8 AS revenue,
       COALESCE(SUM(oi.qty), 0)::float8 AS quantity
     FROM pos.pos_orders o
     LEFT JOIN (
       SELECT order_id, SUM(quantity) AS qty
       FROM pos.pos_order_items
       GROUP BY order_id
     ) oi ON oi.order_id = o.id
     WHERE o.ordered_at >= $1::timestamptz
       AND o.ordered_at <= $2::timestamptz
       AND o.status NOT IN ('cancelled', 'voided', 'merged')
       AND (o.payment_status = 'paid' OR o.status = 'completed')
       AND ($3::uuid[] IS NULL OR o.warehouse_id = ANY($3::uuid[]))
     GROUP BY 1, 2`,
    [input.startIso, input.endIso, input.warehouseIds]
  );

  return rows.map((row) => ({
    hour: toNumber(row.hour),
    dow: toNumber(row.dow),
    transactions: toNumber(row.transactions),
    revenue: toNumber(row.revenue),
    quantity: toNumber(row.quantity),
  }));
}
