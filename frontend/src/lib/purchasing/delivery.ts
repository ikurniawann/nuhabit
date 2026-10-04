import { ApiError } from "@/lib/api/auth";
import type { DbClient } from "@/lib/pg/types";

// ============================================================
// Delivery State Machine
// pending → shipped → in_transit → delivered; selain delivered bisa cancelled
// ============================================================

export type DeliveryStatus = "pending" | "shipped" | "in_transit" | "delivered" | "cancelled";

/** Delivery still in progress — blocks creating another shipment for the same PO. */
export const OPEN_DELIVERY_STATUSES: DeliveryStatus[] = [
  "pending",
  "shipped",
  "in_transit",
];

export const PO_DELIVERY_ELIGIBLE_STATUSES = [
  "approved",
  "sent",
  "partially_received",
] as const;

type DeliverySummary = {
  id?: string;
  status?: string | null;
  purchase_order_id?: string | null;
  nomor_resi?: string | null;
  no_surat_jalan?: string | null;
};

export function isOpenDeliveryStatus(status?: string | null) {
  return OPEN_DELIVERY_STATUSES.includes(
    (status?.toLowerCase() || "") as DeliveryStatus
  );
}

export function findOpenDelivery(deliveries: DeliverySummary[]) {
  return deliveries.find((delivery) => isOpenDeliveryStatus(delivery.status)) ?? null;
}

export function isPoStatusEligibleForDelivery(status?: string | null) {
  return PO_DELIVERY_ELIGIBLE_STATUSES.includes(
    (status?.toLowerCase() || "") as (typeof PO_DELIVERY_ELIGIBLE_STATUSES)[number]
  );
}

export function isPoEligibleForNewDelivery(
  poStatus: string | null | undefined,
  deliveries: DeliverySummary[]
) {
  if (!isPoStatusEligibleForDelivery(poStatus)) return false;
  return !findOpenDelivery(deliveries);
}

type DeliveryPO = {
  id: string;
  nomor_po?: string | null;
  status?: string | null;
  supplier_id?: string | null;
  is_active?: boolean | null;
};

export const DELIVERY_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  pending: ["shipped", "in_transit", "cancelled"],
  shipped: ["in_transit", "cancelled"],
  in_transit: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export function validateDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): void {
  const allowed = DELIVERY_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw ApiError.badRequest(
      `Invalid delivery transition: ${from} → ${to}. Allowed: ${allowed?.join(", ") || "none"}`
    );
  }
}

// ============================================================
// Validate PO can receive delivery
// ============================================================

export async function validatePOCanDelivery(
  db: DbClient,
  poId: string
): Promise<{ valid: boolean; errors: string[]; po?: DeliveryPO }> {
  const errors: string[] = [];

  const { data: po, error } = await db
    .from("purchase_orders")
    .select("id, nomor_po, status, supplier_id, is_active")
    .eq("id", poId)
    .single();

  if (error) {
    errors.push(`Database error: ${error.message}`);
    return { valid: false, errors };
  }

  if (!po) {
    errors.push("Purchase order not found");
    return { valid: false, errors };
  }

  if (!po.is_active) {
    errors.push("Purchase order is no longer active");
  }

  const statusLower = po.status?.toLowerCase();
  if (!isPoStatusEligibleForDelivery(statusLower)) {
    errors.push(
      `Purchase order status is "${po.status}". It must be approved, sent, or partially received before creating a delivery.`
    );
  }

  const { data: existingDeliveries, error: deliveryError } = await db
    .from("deliveries")
    .select("id, status")
    .eq("purchase_order_id", poId)
    .eq("is_active", true)
    .neq("status", "cancelled");

  if (deliveryError) {
    errors.push(`Database error: ${deliveryError.message}`);
    return { valid: false, errors, po };
  }

  const openDelivery = findOpenDelivery(existingDeliveries || []);
  if (openDelivery) {
    errors.push("This purchase order already has an open delivery in progress.");
  }

  return { valid: errors.length === 0, errors, po };
}
