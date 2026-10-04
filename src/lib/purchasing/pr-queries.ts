import { ApiError } from "@/lib/api/auth";
import {
  branchScopeOr,
  companyScopeOr,
  isRowInBusinessScope,
  type UserScope,
} from "@/lib/api/scope";
import type { DbClient } from "@/lib/pg/types";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import {
  loadActiveUnits,
  loadMaterialsWithPacks,
  loadScopedProducts,
  loadScopedSupplies,
} from "@/lib/purchasing/po-form-data";
import { buildPrPermissions, seesOnlyOwnPrs } from "@/lib/purchasing/pr-roles";

type PrRow = {
  id: string;
  requester_id: string;
  department_id?: string | null;
  company_id?: string | null;
  branch_id?: string | null;
  [column: string]: unknown;
};

type IdName = { id: string; name: string };
type UserRow = { id: string; full_name: string; company_id?: string | null; branch_id?: string | null };

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter(Boolean) as string[])];
}

async function loadUsers(db: DbClient, ids: string[], columns = "id, full_name"): Promise<UserRow[]> {
  if (!ids.length) return [];
  const { data } = await db.from("users").select(columns).in("id", ids);
  return (data ?? []) as UserRow[];
}

async function loadDepartmentNames(db: DbClient, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await db.from("departments").select("id, name").in("id", ids);
  return new Map(((data ?? []) as IdName[]).map((department) => [department.id, department.name]));
}

export type PrListParams = {
  status: string | null;
  search: string | null;
  departmentId: string | null;
  moduleType: string;
  page: number;
  limit: number;
};

export async function listPurchaseRequests(
  db: DbClient,
  params: PrListParams,
  scope: UserScope | null,
  user: { id: string; role: string }
) {
  let query = db
    .from("purchase_requests")
    .select(
      `
      *,
      items:pr_items(*)
    `,
      { count: "exact" }
    )
    .order("created_at", { ascending: false });

  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);

  if (params.status && params.status !== "all") query = query.eq("status", params.status);
  if (params.search) query = query.ilike("pr_number", `%${params.search}%`);
  if (params.departmentId) query = query.eq("department_id", params.departmentId);
  if (["raw_material", "product", "general"].includes(params.moduleType)) {
    query = query.eq("module_type", params.moduleType);
  }
  if (seesOnlyOwnPrs(user.role)) query = query.eq("requester_id", user.id);

  const from = (params.page - 1) * params.limit;
  const { data, error, count } = await query.range(from, from + params.limit - 1);
  if (error) throw error;

  const prs = (data ?? []) as PrRow[];
  const requesters = await loadUsers(db, uniqueIds(prs.map((pr) => pr.requester_id)));
  const requesterName = new Map(requesters.map((requester) => [requester.id, requester.full_name]));
  const departmentName = await loadDepartmentNames(db, uniqueIds(prs.map((pr) => pr.department_id)));

  const total = count || 0;
  return {
    data: prs.map((pr) => ({
      ...pr,
      requester_name: requesterName.get(pr.requester_id),
      department_name: pr.department_id ? departmentName.get(pr.department_id) : undefined,
    })),
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.ceil(total / params.limit),
    },
  };
}

/** company/branch PR; PR lama tanpa scope memakai scope pemohon. */
export function resolvePrScope(pr: PrRow, requester: UserRow | undefined) {
  return {
    company_id: pr.company_id ?? requester?.company_id ?? null,
    branch_id: pr.branch_id ?? requester?.branch_id ?? null,
  };
}

/**
 * PR yang bisa dibuatkan PO: approved, belum dikonversi, belum terhubung ke PO
 * aktif lain, dan dalam scope bisnis user (fallback scope pemohon).
 */
export async function listPrsEligibleForPo(db: DbClient, moduleType: string, scope: UserScope | null) {
  const { data, error } = await db
    .from("purchase_requests")
    .select(
      `
      *,
      items:pr_items(*)
    `
    )
    .eq("status", "approved")
    .eq("module_type", moduleType)
    .is("converted_po_id", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const prs = (data ?? []) as PrRow[];
  const requesters = await loadUsers(
    db,
    uniqueIds(prs.map((pr) => pr.requester_id)),
    "id, full_name, company_id, branch_id"
  );
  const requesterById = new Map(requesters.map((requester) => [requester.id, requester]));

  const scopedPrs = prs.filter(
    (pr) =>
      !scope ||
      scope.isUnscoped ||
      isRowInBusinessScope(scope, resolvePrScope(pr, requesterById.get(pr.requester_id)))
  );

  const { data: linkedPos, error: poError } = await db
    .from("purchase_orders")
    .select("pr_id")
    .not("pr_id", "is", null)
    .eq("is_active", true);
  if (poError) throw poError;

  const linkedPrIds = new Set(
    uniqueIds(((linkedPos ?? []) as Array<{ pr_id: string | null }>).map((po) => po.pr_id))
  );
  const eligible = scopedPrs.filter((pr) => !linkedPrIds.has(pr.id));
  const departmentName = await loadDepartmentNames(db, uniqueIds(eligible.map((pr) => pr.department_id)));

  return eligible.map((pr) => ({
    ...pr,
    department_name: (pr.department_id && departmentName.get(pr.department_id)) || null,
    requester_name: requesterById.get(pr.requester_id)?.full_name || null,
  }));
}

type PrItemRow = { product_id?: string | null; supply_item_id?: string | null; [column: string]: unknown };
type CodeName = { id: string; kode: string; nama: string };

async function loadCodeNames(db: DbClient, table: string, ids: string[]): Promise<Map<string, CodeName>> {
  if (!ids.length) return new Map();
  const { data } = await db.from(table).select("id, kode, nama").in("id", ids);
  return new Map(((data ?? []) as CodeName[]).map((row) => [row.id, row]));
}

/** Detail PR + item (produk/barang operasional di-resolve manual), nama approver, dan izin user. */
export async function getPurchaseRequestDetail(
  db: DbClient,
  id: string,
  user: { id: string; role: string },
  hasApprovalGrant: boolean
) {
  const { data: pr, error } = await db.from("purchase_requests").select("*").eq("id", id).single();
  if (error || !pr) {
    if (error?.message) console.error("Error fetching PR header:", error.message);
    throw ApiError.notFound("PR tidak ditemukan");
  }

  // Query builder hanya mendukung embed satu level; relasi lain di-fetch terpisah.
  const { data: itemRows, error: itemsError } = await db
    .from("pr_items")
    .select(`
      *,
      raw_material:raw_materials!raw_material_id(id, kode, nama),
      satuan:units!satuan_id(id, nama)
    `)
    .eq("pr_id", id);
  if (itemsError) throw itemsError;

  const items = (itemRows ?? []) as PrItemRow[];
  const [productById, supplyById] = await Promise.all([
    loadCodeNames(db, "products", uniqueIds(items.map((item) => item.product_id))),
    // EPIC-026 B2 — barang operasional (scope 'general').
    loadCodeNames(db, "supply_items", uniqueIds(items.map((item) => item.supply_item_id))),
  ]);

  const relatedUserIds = uniqueIds([
    pr.requester_id,
    pr.approved_by_head,
    pr.approved_by_finance,
    pr.approved_by_direksi,
    pr.rejected_by,
  ]);
  const [relatedUsers, { data: department }] = await Promise.all([
    loadUsers(db, relatedUserIds),
    pr.department_id
      ? db.from("departments").select("name, code").eq("id", pr.department_id).single()
      : Promise.resolve({ data: null }),
  ]);
  const userName = new Map(relatedUsers.map((relatedUser) => [relatedUser.id, relatedUser.full_name]));
  const nameOf = (userId: string | null | undefined) => (userId ? userName.get(userId) : null);

  return {
    ...pr,
    items: items.map((item) => ({
      ...item,
      product: item.product_id ? productById.get(item.product_id) ?? null : null,
      supply_item: item.supply_item_id ? supplyById.get(item.supply_item_id) ?? null : null,
    })),
    department,
    requester_name: userName.get(pr.requester_id) || "-",
    approved_head_name: nameOf(pr.approved_by_head),
    approved_finance_name: nameOf(pr.approved_by_finance),
    approved_direksi_name: nameOf(pr.approved_by_direksi),
    rejected_by_name: nameOf(pr.rejected_by),
    permissions: buildPrPermissions(pr, user, hasApprovalGrant),
  };
}

const PR_UNIT_COLUMNS = "id, nama";

/** Pilihan form PR: departemen + item sesuai module_type + satuan. */
export async function loadPrFormData(
  db: DbClient,
  moduleType: PurchasingModuleType,
  scope: UserScope | null
) {
  const { data: departmentRows } = await db
    .from("departments")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  const departments = departmentRows ?? [];

  if (moduleType === "product") {
    const [products, units] = await Promise.all([
      loadScopedProducts(db, scope),
      loadActiveUnits(db, PR_UNIT_COLUMNS),
    ]);
    return { departments, products, units };
  }

  if (moduleType === "general") {
    // EPIC-026 B2 — sumber item PR barang operasional = item.supply_items.
    const [supplies, units] = await Promise.all([
      loadScopedSupplies(db, scope),
      loadActiveUnits(db, PR_UNIT_COLUMNS),
    ]);
    return { departments, supplies, units };
  }

  const [materials, units] = await Promise.all([
    loadMaterialsWithPacks(db),
    loadActiveUnits(db, PR_UNIT_COLUMNS),
  ]);
  return { departments, materials, units };
}
