import type { ApprovalPR } from "./types";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";

export type { ApprovalPR } from "./types";

export async function listPendingPRApprovals(
  moduleType: PurchasingModuleType = "raw_material"
): Promise<ApprovalPR[]> {
  const sp = new URLSearchParams({
    status: "pending_head",
    limit: "50",
    module_type: moduleType,
  });
  const res = await fetch(`/api/purchasing/pr?${sp.toString()}`);
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || "Failed to load purchase request approvals");
  return payload.data || [];
}

export async function approvePRApproval(id: string): Promise<void> {
  const res = await fetch(`/api/purchasing/pr/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "approve" }),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || "Failed to approve purchase request");
}

export async function rejectPRApproval(id: string, reason: string): Promise<void> {
  const res = await fetch(`/api/purchasing/pr/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reject", reason }),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || "Failed to reject purchase request");
}
