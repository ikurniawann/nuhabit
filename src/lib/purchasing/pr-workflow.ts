import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { effectiveBranchId, effectiveCompanyId, type UserScope } from "@/lib/api/scope";
import type { DbClient } from "@/lib/pg/types";
import {
  parsePurchasingModuleType,
  type PurchasingModuleType,
} from "@/lib/purchasing/module-scope";
import { canEditPrOf, isAwaitingPrApproval } from "@/lib/purchasing/pr-roles";
import {
  extractPrErrorMessage,
  normalizePrWriteItems,
  parsePrWriteBody,
  sumPrTotalAmount,
  type PrWriteItem,
} from "@/lib/purchasing/pr-schemas";
import { notifyPrMendesak } from "@/lib/purchasing/pr-urgent-notify";
import { generatePRNumber } from "@/lib/purchasing/utils";

export type PrActor = { id: string; role: string; full_name: string };

const nowIso = () => new Date().toISOString();

type NormalizedPrItem = ReturnType<typeof normalizePrWriteItems<PrWriteItem>>[number];

/** Baris `pr_items`; tepat satu diskriminan item (produk/bahan/barang operasional) terisi. */
export function buildPrItemRows(prId: string, items: NormalizedPrItem[]) {
  return items.map((item) => ({
    pr_id: prId,
    product_id: "product_id" in item ? item.product_id : null,
    raw_material_id: "raw_material_id" in item ? item.raw_material_id : null,
    supply_item_id: "supply_item_id" in item ? item.supply_item_id : null,
    satuan_id: item.satuan_id || null,
    description: item.description,
    qty: item.qty,
    unit: item.unit,
    estimated_price: item.estimated_price,
    total: item.total,
  }));
}

/** Draft atau langsung diajukan ke kepala departemen. */
function nextPrStatus(action: "draft" | "submit") {
  return action === "submit" ? ("pending_head" as const) : ("draft" as const);
}

function parsePrWrite(body: unknown, moduleType: PurchasingModuleType) {
  const validated = parsePrWriteBody(body, moduleType);
  const items = normalizePrWriteItems(validated.items as PrWriteItem[]);
  return {
    validated,
    items,
    totalAmount: sumPrTotalAmount(items),
    status: nextPrStatus(validated.action),
  };
}

type PrWrite = ReturnType<typeof parsePrWrite>;

/** Prioritas Mendesak → WA penerima (fire-and-forget; dedup per PR per status). */
function notifyIfUrgent(prId: string, prNumber: string, write: PrWrite, requesterName: string) {
  void notifyPrMendesak({
    prId,
    prNumber,
    priority: write.validated.priority,
    status: write.status,
    requesterName,
    departmentId: write.validated.department_id,
    totalAmount: write.totalAmount,
    requiredDate: write.validated.required_date || null,
    notes: write.validated.notes || null,
    items: write.items.map((item) => ({ description: item.description, qty: item.qty, unit: item.unit })),
  });
}

export async function createPurchaseRequest(
  db: DbClient,
  body: unknown,
  user: PrActor,
  scope: UserScope | null
) {
  const moduleType = parsePurchasingModuleType((body as { module_type?: string } | null)?.module_type);
  const write = parsePrWrite(body, moduleType);
  const prNumber = await generatePRNumber(db);

  const { data: pr, error: prError } = await db
    .from("purchase_requests")
    .insert({
      pr_number: prNumber,
      requester_id: user.id,
      company_id: effectiveCompanyId(scope),
      branch_id: effectiveBranchId(scope),
      department_id: write.validated.department_id,
      status: write.status,
      total_amount: write.totalAmount,
      priority: write.validated.priority,
      notes: write.validated.notes || null,
      required_date: write.validated.required_date || null,
      module_type: moduleType,
      current_approval_level: write.status === "pending_head" ? "head_dept" : null,
    })
    .select()
    .single();
  if (prError) {
    throw ApiError.badRequest(extractPrErrorMessage(prError, "Gagal menyimpan header PR"));
  }
  if (!pr) throw ApiError.server("Gagal menyimpan header PR");

  const { error: itemsError } = await db.from("pr_items").insert(buildPrItemRows(pr.id, write.items));
  if (itemsError) {
    await db.from("purchase_requests").delete().eq("id", pr.id);
    throw ApiError.badRequest(extractPrErrorMessage(itemsError, "Gagal menyimpan item PR"));
  }

  notifyIfUrgent(pr.id, prNumber, write, user.full_name);
  return pr;
}

/** Ganti header + seluruh item PR draft (pemohon atau role editor). */
export async function updatePurchaseRequest(db: DbClient, id: string, body: unknown, user: PrActor) {
  const { data: existing, error: findError } = await db
    .from("purchase_requests")
    .select("id, pr_number, requester_id, status, module_type")
    .eq("id", id)
    .single();
  if (findError || !existing) throw ApiError.notFound("PR tidak ditemukan");

  const write = parsePrWrite(body, parsePurchasingModuleType(existing.module_type));
  if (!canEditPrOf(existing.requester_id, user)) {
    throw ApiError.forbidden("Anda tidak memiliki akses mengubah PR ini");
  }
  if (existing.status !== "draft") throw ApiError.badRequest("Hanya PR draft yang bisa diedit");

  const { error: deleteItemsError } = await db.from("pr_items").delete().eq("pr_id", id);
  if (deleteItemsError) throw deleteItemsError;

  const { error: insertItemsError } = await db.from("pr_items").insert(buildPrItemRows(id, write.items));
  if (insertItemsError) {
    throw ApiError.badRequest(extractPrErrorMessage(insertItemsError, "Gagal mengubah PR"));
  }

  const { error: updateError } = await db
    .from("purchase_requests")
    .update({
      department_id: write.validated.department_id,
      priority: write.validated.priority,
      required_date: write.validated.required_date || null,
      notes: write.validated.notes || null,
      total_amount: write.totalAmount,
      status: write.status,
      current_approval_level: write.status === "pending_head" ? "head_dept" : null,
      updated_at: nowIso(),
    })
    .eq("id", id);
  if (updateError) throw updateError;

  notifyIfUrgent(id, existing.pr_number ?? id, write, user.full_name);
  return { id, status: write.status };
}

/** Pemohon mengajukan PR draft ke kepala departemen. */
export async function submitPurchaseRequest(db: DbClient, id: string, user: PrActor) {
  const { data: pr, error } = await db.from("purchase_requests").select("*").eq("id", id).single();
  if (error || !pr) throw ApiError.notFound("PR tidak ditemukan");
  if (pr.requester_id !== user.id) throw ApiError.forbidden("Anda tidak memiliki akses");
  if (pr.status !== "draft") {
    throw ApiError.badRequest("Hanya PR dengan status draft yang bisa disubmit");
  }

  const { data, error: updateError } = await db
    .from("purchase_requests")
    .update({ status: "pending_head", current_approval_level: "head_dept", updated_at: nowIso() })
    .eq("id", id)
    .select()
    .single();
  if (updateError) throw updateError;
  return data;
}

export const prDecisionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().optional(),
});

const FINAL_PR_STATUSES = ["approved", "rejected", "converted"];

/**
 * Approve/reject PR `pending_head`. Approve melengkapi company/branch PR lama
 * dari pemohon lalu scope approver.
 */
export async function decidePurchaseRequest(
  db: DbClient,
  id: string,
  decision: z.infer<typeof prDecisionSchema>,
  user: PrActor,
  loadScope: () => Promise<UserScope | null>
) {
  const { data: pr, error } = await db.from("purchase_requests").select("*").eq("id", id).single();
  if (error || !pr) throw ApiError.notFound("PR tidak ditemukan");
  if (FINAL_PR_STATUSES.includes(pr.status)) throw ApiError.badRequest("PR sudah final");
  // Grant approval sudah dicek route (IAM.itemsPrApproval).
  if (!isAwaitingPrApproval(pr.status)) {
    throw ApiError.forbidden("Anda tidak memiliki akses untuk melakukan approval");
  }

  const updates: Record<string, unknown> = { updated_at: nowIso() };
  if (decision.action === "approve") {
    Object.assign(updates, {
      approved_by_head: user.id,
      approved_at_head: nowIso(),
      status: "approved",
      current_approval_level: null,
    });
    if (!pr.company_id || !pr.branch_id) {
      const { data: requester } = await db
        .from("users")
        .select("company_id, branch_id")
        .eq("id", pr.requester_id)
        .maybeSingle();
      const scope = await loadScope();
      updates.company_id = pr.company_id ?? requester?.company_id ?? effectiveCompanyId(scope);
      updates.branch_id = pr.branch_id ?? requester?.branch_id ?? effectiveBranchId(scope);
    }
  } else {
    Object.assign(updates, {
      status: "rejected",
      rejected_by: user.id,
      rejected_at: nowIso(),
      rejection_reason: decision.reason || null,
    });
  }

  const { data, error: updateError } = await db
    .from("purchase_requests")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (updateError) throw updateError;
  return data;
}

type RevisablePrItem = {
  product_id?: string | null;
  raw_material_id?: string | null;
  supply_item_id?: string | null;
  satuan_id?: string | null;
  description: string;
  qty: number;
  unit: string;
  estimated_price: number;
  total?: number | null;
};

/** PR rejected disalin menjadi PR draft baru (nomor baru, pemohon = user). */
export async function revisePurchaseRequest(db: DbClient, id: string, user: PrActor) {
  const { data: pr, error } = await db
    .from("purchase_requests")
    .select(`
      *,
      items:pr_items(*)
    `)
    .eq("id", id)
    .single();
  if (error || !pr) throw ApiError.notFound("PR tidak ditemukan");
  if (pr.status !== "rejected") throw ApiError.badRequest("Hanya PR rejected yang bisa direvisi");
  if (!canEditPrOf(pr.requester_id, user)) {
    throw ApiError.forbidden("Anda tidak memiliki akses membuat revisi PR ini");
  }

  const { data: revised, error: insertError } = await db
    .from("purchase_requests")
    .insert({
      pr_number: await generatePRNumber(db),
      requester_id: user.id,
      department_id: pr.department_id,
      status: "draft",
      total_amount: pr.total_amount || 0,
      priority: pr.priority,
      notes: pr.notes || null,
      required_date: pr.required_date || null,
      module_type: pr.module_type ?? "raw_material",
      company_id: pr.company_id ?? null,
      branch_id: pr.branch_id ?? null,
      current_approval_level: null,
    })
    .select("id")
    .single();
  if (insertError) throw insertError;

  const items = ((pr.items ?? []) as RevisablePrItem[]).map((item) => ({
    pr_id: revised.id,
    product_id: item.product_id ?? null,
    raw_material_id: item.raw_material_id ?? null,
    supply_item_id: item.supply_item_id ?? null,
    satuan_id: item.satuan_id || null,
    description: item.description,
    qty: item.qty,
    unit: item.unit,
    estimated_price: item.estimated_price,
    total: item.total,
  }));
  if (items.length > 0) {
    const { error: itemsError } = await db.from("pr_items").insert(items);
    if (itemsError) throw itemsError;
  }

  return { id: revised.id as string };
}
