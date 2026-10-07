export const FNB_STATIONS = ["kitchen", "bar", "bakery", "dessert"] as const;
export type FnbStation = (typeof FNB_STATIONS)[number];

export const ACTIVE_KITCHEN_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
] as const;

export const TERMINAL_KITCHEN_STATUSES = ["served", "cancelled"] as const;

/** Order bump → item kitchen_status. `confirmed` is a real kitchen step. */
export const KITCHEN_STATUS_BY_ORDER_STATUS: Record<string, string> = {
  pending: "pending",
  confirmed: "confirmed",
  preparing: "preparing",
  ready: "ready",
  served: "served",
  completed: "served",
  cancelled: "cancelled",
};

export function mapOrderStatusToKitchenStatus(status?: string | null): string {
  const key = String(status || "pending").toLowerCase();
  return KITCHEN_STATUS_BY_ORDER_STATUS[key] || "pending";
}

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  confirmed: 1,
  preparing: 2,
  ready: 3,
  served: 4,
  completed: 4,
  cancelled: 5,
};

export type KitchenItemRef = {
  station?: string | null;
  kitchen_status?: string | null;
};

export function isFnbStation(station?: string | null): station is FnbStation {
  return FNB_STATIONS.includes(String(station || "").toLowerCase() as FnbStation);
}

export function isTerminalKitchenStatus(status?: string | null): boolean {
  return TERMINAL_KITCHEN_STATUSES.includes(
    String(status || "").toLowerCase() as (typeof TERMINAL_KITCHEN_STATUSES)[number]
  );
}

export function isActiveKitchenStatus(status?: string | null): boolean {
  return ACTIVE_KITCHEN_STATUSES.includes(
    String(status || "pending").toLowerCase() as (typeof ACTIVE_KITCHEN_STATUSES)[number]
  );
}

export function deriveStationStatus(
  items: KitchenItemRef[],
  station?: string | null
): string {
  const wanted = station ? String(station).toLowerCase() : null;
  const active = items.filter((item) => {
    const itemStation = String(item.station || "").toLowerCase();
    if (!isFnbStation(itemStation)) return false;
    if (wanted && itemStation !== wanted) return false;
    return !isTerminalKitchenStatus(item.kitchen_status);
  });
  if (active.length === 0) return "served";

  let minRank = Number.POSITIVE_INFINITY;
  let status = "pending";
  for (const item of active) {
    const value = String(item.kitchen_status || "pending").toLowerCase();
    const rank = STATUS_RANK[value] ?? 0;
    if (rank < minRank) {
      minRank = rank;
      status = value === "completed" ? "served" : value;
    }
  }
  return status;
}

export function deriveOrderKitchenStatus(
  items: KitchenItemRef[],
  paymentStatus?: string | null
): { kitchenStatus: string; orderStatus: string } {
  const fnbItems = items.filter((item) => isFnbStation(item.station));
  const paid = String(paymentStatus || "").toLowerCase() === "paid";

  if (fnbItems.length === 0) {
    return {
      kitchenStatus: "served",
      orderStatus: paid ? "completed" : "pending",
    };
  }

  const allTerminal = fnbItems.every((item) =>
    isTerminalKitchenStatus(item.kitchen_status)
  );
  if (allTerminal) {
    return {
      kitchenStatus: "served",
      orderStatus: paid ? "completed" : "served",
    };
  }

  const kitchenStatus = deriveStationStatus(fnbItems);
  return { kitchenStatus, orderStatus: kitchenStatus };
}
