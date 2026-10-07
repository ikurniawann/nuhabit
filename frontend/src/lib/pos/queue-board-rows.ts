export function uniqueQueueRows<
  T extends { checkout_id?: string | null; id: string; queue_number?: string | null },
>(orders: T[]): T[] {
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const order of orders) {
    const key = order.checkout_id || order.id;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(order);
  }
  return rows;
}
