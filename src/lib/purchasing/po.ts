import { ApiError } from "@/lib/api/auth";
import type { DbClient } from "@/lib/pg/types";
import { cancelDraftRejectCreditsForPo } from "@/lib/purchasing/vendor-credit-service";

// ============================================================
// PO State Machine
// Valid transitions: DRAFT→APPROVED→SENT→PARTIALLY_RECEIVED→RECEIVED
//                  PARTIALLY_RECEIVED / RECEIVED → CLOSED
//                  DRAFT/APPROVED/SENT/PARTIALLY_RECEIVED→CANCELLED
// Legacy alias: "partial" ≡ "partially_received"
// ============================================================

export type POStatus =
  | "draft"
  | "approved"
  | "sent"
  | "partially_received"
  | "received"
  | "cancelled"
  | "closed";

export const PO_TRANSITIONS: Record<POStatus, POStatus[]> = {
  draft: ["approved", "cancelled"],
  approved: ["sent", "cancelled"],
  sent: ["partially_received", "received", "cancelled"],
  partially_received: ["received", "cancelled", "closed"],
  received: ["closed"],
  cancelled: [],
  closed: [],
};

/** Normalize legacy "partial" to canonical DB status. */
export function normalizePOStatus(status: string | null | undefined): POStatus | string {
  if (!status) return "";
  if (status === "partial") return "partially_received";
  return status;
}

export function canTransition(from: string | POStatus, to: POStatus): boolean {
  const normalized = normalizePOStatus(from) as POStatus;
  return PO_TRANSITIONS[normalized]?.includes(to) ?? false;
}

export function validateTransition(from: string | POStatus, to: POStatus): void {
  const normalized = normalizePOStatus(from) as POStatus;
  if (!canTransition(normalized, to)) {
    throw ApiError.badRequest(
      `Invalid state transition: ${normalized} → ${to}. Allowed: ${PO_TRANSITIONS[normalized]?.join(", ") || "none"}`
    );
  }
}

/**
 * Close a PO that still has open quantity (supplier will not replace shortage).
 * After close, the PO is no longer eligible for new deliveries.
 */
export async function closePurchaseOrder(
  db: DbClient,
  poId: string,
  reason: string,
  userId: string
): Promise<{ id: string; status: POStatus }> {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw ApiError.badRequest("Alasan penutupan wajib diisi");
  }

  const { data: po, error } = await db
    .from("purchase_orders")
    .select("id, status")
    .eq("id", poId)
    .single();

  if (error || !po) {
    throw ApiError.notFound("Purchase order tidak ditemukan");
  }

  const current = normalizePOStatus(po.status) as POStatus;
  validateTransition(current, "closed");

  try {
    await cancelDraftRejectCreditsForPo(db, poId);
  } catch (creditErr) {
    console.error("[closePurchaseOrder] cancel draft credits (non-fatal):", creditErr);
  }

  const { data: updated, error: updateError } = await db
    .from("purchase_orders")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by: userId,
      close_reason: trimmed,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq("id", poId)
    .select("id, status")
    .single();

  if (updateError || !updated) {
    throw new Error(updateError?.message || "Gagal menutup purchase order");
  }

  return { id: updated.id as string, status: updated.status as POStatus };
}
