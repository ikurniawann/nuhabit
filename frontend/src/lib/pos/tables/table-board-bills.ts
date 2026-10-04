export type TableBoardBillKind = "checkout" | "order";

export type TableBoardBillOrder = {
  id: string;
  table_id?: string | null;
  payment_status?: string | null;
  status?: string | null;
  checkout_id?: string | null;
  sold_from?: string | null;
  order_number?: string | null;
  pre_settled_at?: string | null;
  total_amount?: number | string | null;
};

export type TableBoardBillCheckout = {
  id: string;
  table_id?: string | null;
  payment_status?: string | null;
  checkout_number?: string | null;
  total_amount?: number | string | null;
  notes?: string | null;
};

export type TableBoardBill = {
  id: string;
  kind: TableBoardBillKind;
  label: string;
  table_id: string | null;
  payment_status: string;
  pre_settled_at: string | null;
  total_amount: number;
  /** Cashier handoff: child order id for a checkout, or the stall order id. */
  orderId: string | null;
  checkoutId: string | null;
  soldFrom: "central" | "stall";
};

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isOpenOrder(order: TableBoardBillOrder) {
  const status = String(order.status || "").toLowerCase();
  // Kitchen `completed` is not closed — unpaid open bills stay on the floor.
  if (status === "cancelled" || status === "voided" || status === "merged") {
    return false;
  }
  return String(order.payment_status || "unpaid").toLowerCase() !== "paid";
}

function isOpenCheckout(checkout: TableBoardBillCheckout) {
  if (String(checkout.notes || "").trim().toLowerCase().startsWith("cancelled")) {
    return false;
  }
  return String(checkout.payment_status || "unpaid").toLowerCase() !== "paid";
}

/**
 * Floor / bills rail: one row per unpaid central checkout (children collapsed)
 * plus each unpaid stall order. Never drops a second bill on the same table.
 */
export function listTableBoardBills(input: {
  tableId?: string | null;
  orders?: TableBoardBillOrder[];
  checkouts?: TableBoardBillCheckout[];
}): TableBoardBill[] {
  const tableId = input.tableId ?? null;
  const cancelledCheckoutIds = new Set(
    (input.checkouts ?? [])
      .filter((checkout) =>
        String(checkout.notes || "").trim().toLowerCase().startsWith("cancelled")
      )
      .map((checkout) => checkout.id)
  );
  const orders = (input.orders ?? []).filter((order) => {
    if (tableId && order.table_id !== tableId) return false;
    if (order.checkout_id && cancelledCheckoutIds.has(order.checkout_id)) return false;
    return isOpenOrder(order);
  });
  const checkouts = (input.checkouts ?? []).filter((checkout) => {
    if (tableId && checkout.table_id !== tableId) return false;
    return isOpenCheckout(checkout);
  });

  const bills: TableBoardBill[] = [];
  const seenCheckoutIds = new Set<string>();

  for (const checkout of checkouts) {
    const children = orders.filter((order) => order.checkout_id === checkout.id);
    if (children.length === 0) continue;
    seenCheckoutIds.add(checkout.id);
    const preSettled =
      children.find((order) => order.pre_settled_at)?.pre_settled_at ?? null;
    const childTotal = children.reduce(
      (sum, order) => sum + toNumber(order.total_amount),
      0
    );
    bills.push({
      id: checkout.id,
      kind: "checkout",
      label: checkout.checkout_number || checkout.id.slice(0, 8),
      table_id: checkout.table_id ?? null,
      payment_status: String(checkout.payment_status || "unpaid"),
      pre_settled_at: preSettled,
      total_amount: childTotal || toNumber(checkout.total_amount),
      orderId: children[0]?.id ?? null,
      checkoutId: checkout.id,
      soldFrom: "central",
    });
  }

  for (const order of orders) {
    if (order.checkout_id) {
      if (seenCheckoutIds.has(order.checkout_id)) continue;
      seenCheckoutIds.add(order.checkout_id);
      const siblings = orders.filter(
        (row) => row.checkout_id === order.checkout_id
      );
      const preSettled =
        siblings.find((row) => row.pre_settled_at)?.pre_settled_at ?? null;
      bills.push({
        id: order.checkout_id,
        kind: "checkout",
        label: order.order_number || order.checkout_id.slice(0, 8),
        table_id: order.table_id ?? null,
        payment_status: String(order.payment_status || "unpaid"),
        pre_settled_at: preSettled,
        total_amount: siblings.reduce(
          (sum, row) => sum + toNumber(row.total_amount),
          0
        ),
        orderId: order.id,
        checkoutId: order.checkout_id,
        soldFrom: "central",
      });
      continue;
    }

    bills.push({
      id: order.id,
      kind: "order",
      label: order.order_number || order.id.slice(0, 8),
      table_id: order.table_id ?? null,
      payment_status: String(order.payment_status || "unpaid"),
      pre_settled_at: order.pre_settled_at ?? null,
      total_amount: toNumber(order.total_amount),
      orderId: order.id,
      checkoutId: null,
      soldFrom: order.sold_from === "central" ? "central" : "stall",
    });
  }

  return bills;
}

export function tableBillSourceLabel(
  soldFrom: "central" | "stall"
): "Kasir pusat" | "Stall" {
  return soldFrom === "central" ? "Kasir pusat" : "Stall";
}

/** Cashier must load a checkout as one bill — never a single child order. */
export function cashierHandoffFromBill(bill: TableBoardBill): {
  checkoutId?: string;
  orderId?: string;
  tableId: string | null;
} {
  if (bill.kind === "checkout" && bill.checkoutId) {
    return { checkoutId: bill.checkoutId, tableId: bill.table_id };
  }
  return {
    ...(bill.orderId ? { orderId: bill.orderId } : {}),
    tableId: bill.table_id,
  };
}
