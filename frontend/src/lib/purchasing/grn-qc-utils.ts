import { toQty } from "@/lib/purchasing/utils";

export type QcOverallStatus = "approved" | "rejected" | "partial";

export type QcInspectionItemInput = {
  qty_accepted: number;
  qty_rejected: number;
};

export function resolveOverallQcStatus(
  items: QcInspectionItemInput[]
): QcOverallStatus {
  const acceptedTotal = items.reduce((sum, item) => sum + toQty(item.qty_accepted), 0);
  const rejectedTotal = items.reduce((sum, item) => sum + toQty(item.qty_rejected), 0);

  if (acceptedTotal <= 0 && rejectedTotal > 0) return "rejected";
  if (rejectedTotal > 0) return "partial";
  return "approved";
}

export function resolveItemStatus(qtyAccepted: number, qtyRejected: number) {
  if (qtyAccepted <= 0 && qtyRejected > 0) return "rejected" as const;
  if (qtyRejected > 0) return "partially_rejected" as const;
  return "accepted" as const;
}
