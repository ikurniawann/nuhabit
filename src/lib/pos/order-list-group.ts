export type OrderListGroupInput = {
  id: string;
  checkout_id?: string | null;
  checkout_number?: string | null;
  order_number?: string | null;
  ordered_at?: string | null;
  total_amount?: number | string | null;
  payment_status?: string | null;
  status?: string | null;
};

export type OrderListGroup<T extends OrderListGroupInput> =
  | { kind: "single"; order: T }
  | {
      kind: "checkout";
      checkoutId: string;
      checkoutNumber: string;
      orders: T[];
      total: number;
      paid: boolean;
    };

function toAmount(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isClosedOrderStatus(status?: string | null) {
  const value = String(status || "").toLowerCase();
  return value === "voided" || value === "cancelled" || value === "merged";
}

function isPaid(order: OrderListGroupInput) {
  const status = String(order.status || "").toLowerCase();
  const payment = String(order.payment_status || "").toLowerCase();
  if (isClosedOrderStatus(status)) return false;
  return payment === "paid" || status === "completed";
}

/** Void/cancel/merged tidak boleh dibuka lagi di kasir. */
export function canOpenOrderInCashier(orders: OrderListGroupInput[]): boolean {
  return orders.some((order) => !isClosedOrderStatus(order.status) && !isPaid(order));
}

function latestAt(orders: OrderListGroupInput[]) {
  return orders.reduce((latest, order) => {
    const at = order.ordered_at || "";
    return at > latest ? at : latest;
  }, "");
}

/** Satu tagihan kasir pusat = satu baris, bukan N order per stall. */
export function groupOrdersByCheckout<T extends OrderListGroupInput>(
  orders: T[]
): Array<OrderListGroup<T>> {
  const grouped = new Map<string, T[]>();
  const singles: T[] = [];

  for (const order of orders) {
    const checkoutId = String(order.checkout_id || "").trim();
    if (!checkoutId) {
      singles.push(order);
      continue;
    }
    const list = grouped.get(checkoutId) ?? [];
    list.push(order);
    grouped.set(checkoutId, list);
  }

  const rows: Array<OrderListGroup<T> & { sortAt: string }> = [
    ...singles.map((order) => ({
      kind: "single" as const,
      order,
      sortAt: order.ordered_at || "",
    })),
    ...Array.from(grouped.entries()).map(([checkoutId, children]) => ({
      kind: "checkout" as const,
      checkoutId,
      checkoutNumber:
        children.find((row) => row.checkout_number)?.checkout_number ||
        children[0]?.order_number ||
        checkoutId,
      orders: children,
      total: children.reduce((sum, row) => sum + toAmount(row.total_amount), 0),
      paid: children.every(isPaid),
      sortAt: latestAt(children),
    })),
  ];

  rows.sort((a, b) => (a.sortAt < b.sortAt ? 1 : a.sortAt > b.sortAt ? -1 : 0));
  return rows.map((row) => {
    const { sortAt, ...group } = row;
    void sortAt;
    return group as OrderListGroup<T>;
  });
}

/** Mixed unpaid bill must open as one checkout — never the first child order. */
export function cashierHandoffFromOrderListRow(
  row: OrderListGroup<OrderListGroupInput>
): { checkoutId?: string; orderId?: string } {
  if (row.kind === "checkout") {
    return { checkoutId: row.checkoutId };
  }
  return { orderId: row.order.id };
}
