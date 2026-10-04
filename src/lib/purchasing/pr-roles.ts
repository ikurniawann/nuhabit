/**
 * Aturan akses PR. Buat/approve PR digate grant IAM di route (IAM.itemsPr,
 * IAM.itemsPrApproval); di sini tinggal aturan status, kepemilikan, dan
 * filter daftar. Murni: dipakai route PR dan detail PR (`permissions`).
 */

/** Boleh mengubah/merevisi PR milik orang lain. */
const PR_EDITOR_ROLES = ["purchasing_manager", "purchasing_admin", "super_admin", "admin"];

/** Role yang hanya melihat PR miliknya sendiri di daftar PR. */
const OWN_PR_ONLY_ROLES = ["hiring_manager"];

type PrActor = { id: string; role: string };
type PrAccessRow = { status: string; requester_id: string; converted_po_id?: string | null };

/** Pemohon sendiri atau role editor (status dicek terpisah). */
export function canEditPrOf(requesterId: string, user: PrActor): boolean {
  return requesterId === user.id || PR_EDITOR_ROLES.includes(user.role);
}

/** Approval satu tingkat: hanya PR `pending_head` yang bisa diputuskan. */
export function isAwaitingPrApproval(status: string): boolean {
  return status === "pending_head";
}

export function seesOnlyOwnPrs(role: string): boolean {
  return OWN_PR_ONLY_ROLES.includes(role);
}

/** `hasApprovalGrant`: user punya action update di menu approval PR (IAM.itemsPrApproval). */
export function buildPrPermissions(pr: PrAccessRow, user: PrActor, hasApprovalGrant: boolean) {
  return {
    canEdit: pr.status === "draft" && canEditPrOf(pr.requester_id, user),
    canApprove: hasApprovalGrant && isAwaitingPrApproval(pr.status),
    // Gate konversi = gate route convert-to-po (IAM.items), sama dengan gate detail PR.
    canCreatePO: pr.status === "approved" && !pr.converted_po_id,
  };
}
