export type TableBoardActiveOrder = {
  payment_status?: string | null;
  pre_settled_at?: string | null;
} | null;

export type TableBoardStatusInput = {
  /** Master / DB status when no unpaid/active order drives the board */
  tableStatus?: string | null;
  activeOrders?: TableBoardActiveOrder[];
};

function isPaid(order: NonNullable<TableBoardActiveOrder>) {
  return String(order.payment_status || "unpaid").toLowerCase() === "paid";
}

/**
 * Restaurant denah display status.
 * - available (green): no unpaid order
 * - occupied (orange): any unpaid/active order, none pre-settled
 * - billing (red): any unpaid order with pre_settled_at
 * - reserved / maintenance: pass-through when idle
 */
export function resolveTableBoardStatus(input: TableBoardStatusInput): string {
  const unpaid = (input.activeOrders ?? []).filter(
    (order): order is NonNullable<TableBoardActiveOrder> =>
      order !== null && !isPaid(order)
  );

  if (unpaid.some((order) => Boolean(order.pre_settled_at))) return "billing";
  if (unpaid.length > 0) return "occupied";

  const raw = String(input.tableStatus || "available").toLowerCase();
  if (raw === "reserved" || raw === "maintenance") return raw;
  return "available";
}
