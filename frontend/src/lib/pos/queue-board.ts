import type { KDSOrder, KDSOrderItem } from "@/lib/pos/kds-types";
import { isTerminalKitchenStatus } from "@/lib/pos/kds-status";
import { uniqueQueueRows } from "@/lib/pos/queue-board-rows";

const PREPARING_STATUSES = new Set(["pending", "confirmed", "preparing"]);

function queueKey(order: KDSOrder) {
  return String(order.queue_number || order.order_number || "");
}

function byQueueNumber(a: KDSOrder, b: KDSOrder) {
  return queueKey(a).localeCompare(queueKey(b), undefined, { numeric: true });
}

export function orderBoardStatus(order: Pick<KDSOrder, "station_status" | "status">) {
  return String(order.station_status || order.status || "pending").toLowerCase();
}

/** Active F&B lines still on the ticket (served/cancelled already dropped by KDS API). */
export function activeQueueItems(order: Pick<KDSOrder, "pos_order_items">): KDSOrderItem[] {
  return (order.pos_order_items || []).filter(
    (item) => !isTerminalKitchenStatus(item.kitchen_status)
  );
}

export function itemIsReady(item: Pick<KDSOrderItem, "kitchen_status">) {
  return String(item.kitchen_status || "").toLowerCase() === "ready";
}

export function queueItemProgress(order: Pick<KDSOrder, "pos_order_items">) {
  const items = activeQueueItems(order);
  const readyCount = items.filter(itemIsReady).length;
  return {
    total: items.length,
    readyCount,
    pendingCount: Math.max(0, items.length - readyCount),
    hasPartialReady: readyCount > 0 && readyCount < items.length,
    allReady: items.length > 0 && readyCount === items.length,
  };
}

/** One TV row per checkout (merged children) or per stall order. */
export function sourceQueueBoardOrders(orders: KDSOrder[]): KDSOrder[] {
  const grouped = new Map<string, KDSOrder[]>();
  for (const order of orders) {
    const key = order.checkout_id || order.id;
    const list = grouped.get(key) ?? [];
    list.push(order);
    grouped.set(key, list);
  }

  const merged: KDSOrder[] = [];
  for (const group of grouped.values()) {
    const first = group[0];
    if (!first) continue;
    merged.push({
      ...first,
      pos_order_items: group.flatMap((row) => row.pos_order_items || []),
    });
  }

  return uniqueQueueRows(merged);
}

export function splitQueueBoardOrders(orders: KDSOrder[]) {
  const preparing: KDSOrder[] = [];
  const ready: KDSOrder[] = [];
  const seenPreparing = new Set<string>();
  const seenReady = new Set<string>();

  for (const order of sourceQueueBoardOrders(orders)) {
    const status = orderBoardStatus(order);
    // Skip fully finished tickets (no active F&B left / served header)
    if (status === "served" || status === "completed" || status === "cancelled") {
      continue;
    }

    const progress = queueItemProgress(order);
    // Siap diambil: cukup ada ≥1 item kitchen_status=ready (tidak harus semua)
    if (progress.readyCount > 0 || status === "ready") {
      if (!seenReady.has(order.id)) {
        ready.push(order);
        seenReady.add(order.id);
      }
    }
    // Sedang disiapkan: masih ada item yang belum ready
    if (
      progress.pendingCount > 0 ||
      (PREPARING_STATUSES.has(status) && progress.readyCount === 0)
    ) {
      if (!seenPreparing.has(order.id)) {
        preparing.push(order);
        seenPreparing.add(order.id);
      }
    }
  }

  preparing.sort((a, b) => {
    const pa = queueItemProgress(a);
    const pb = queueItemProgress(b);
    if (pa.hasPartialReady !== pb.hasPartialReady) {
      return pa.hasPartialReady ? -1 : 1;
    }
    if (pa.readyCount !== pb.readyCount) return pb.readyCount - pa.readyCount;
    return byQueueNumber(a, b);
  });

  // Full-ready first, then partial (lebih banyak item siap di atas)
  ready.sort((a, b) => {
    const pa = queueItemProgress(a);
    const pb = queueItemProgress(b);
    if (pa.allReady !== pb.allReady) return pa.allReady ? -1 : 1;
    if (pa.readyCount !== pb.readyCount) return pb.readyCount - pa.readyCount;
    return byQueueNumber(a, b);
  });

  return { preparing, ready };
}

export function readyOrderIds(orders: KDSOrder[]) {
  return new Set(
    splitQueueBoardOrders(orders).ready.map((order) => order.id)
  );
}

/** Keys `orderId:itemId` for items currently kitchen_status=ready (chime on new). */
export function readyItemKeys(orders: KDSOrder[]) {
  const keys = new Set<string>();
  for (const order of orders) {
    for (const item of activeQueueItems(order)) {
      if (itemIsReady(item)) keys.add(`${order.id}:${item.id}`);
    }
  }
  return keys;
}
