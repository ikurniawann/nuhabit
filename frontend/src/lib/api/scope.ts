import { queryOne } from "@/lib/db";
import { createServerPgClient } from "@/lib/pg/create-client";
import type { BusinessScopeLevel } from "@/lib/configuration/business-scope";

export interface UserScope {
  userId: string;
  role: string | null;
  businessScope: BusinessScopeLevel | null;
  holdingId: string | null;
  companyId: string | null;
  branchId: string | null;
  /** true bila user tidak dibatasi scope (super_admin atau tanpa scope). */
  isUnscoped: boolean;
}

/**
 * Resolusi scope bisnis (holding/company/branch) untuk user yang sedang login.
 * Dipakai di API route untuk memfilter & mengisi data master/operasional.
 */
export async function getApiUserScope(): Promise<UserScope | null> {
  const db = await createServerPgClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;

  const profile = await queryOne<{
    role: string | null;
    business_scope: BusinessScopeLevel | null;
    holding_id: string | null;
    company_id: string | null;
    branch_id: string | null;
  }>(
    `SELECT role, business_scope, holding_id, company_id, branch_id
     FROM configuration.users
     WHERE id = $1`,
    [user.id]
  );

  const role = profile?.role ?? null;
  const businessScope = profile?.business_scope ?? null;
  const companyId = profile?.company_id ?? null;
  const branchId = profile?.branch_id ?? null;

  const isUnscoped = role === "super_admin" || !businessScope;

  return {
    userId: user.id,
    role,
    businessScope,
    holdingId: profile?.holding_id ?? null,
    companyId,
    branchId,
    isUnscoped,
  };
}

/**
 * company_id efektif untuk menyimpan data master level company.
 * - User bercope company/branch → company miliknya.
 * - User unscoped → null (template global).
 */
export function effectiveCompanyId(scope: UserScope | null): string | null {
  if (!scope || scope.isUnscoped) return null;
  return scope.companyId;
}

/**
 * branch_id efektif untuk data master/operasional level branch.
 * - User branch → branch miliknya.
 * - selain itu → null.
 */
export function effectiveBranchId(scope: UserScope | null): string | null {
  if (!scope || scope.isUnscoped) return null;
  if (scope.businessScope === "branch") return scope.branchId;
  return null;
}

/**
 * Scope bisnis untuk operasi import CSV.
 * Menggunakan company/branch dari profil user meskipun role super_admin,
 * agar master company-scoped (kategori, satuan) tetap bisa di-resolve.
 */
export function importBusinessIds(scope: UserScope | null): {
  companyId: string | null;
  branchId: string | null;
} {
  if (!scope) return { companyId: null, branchId: null };

  const branchId = scope.businessScope === "branch" ? scope.branchId : null;
  return {
    companyId: scope.companyId,
    branchId,
  };
}

/**
 * Ekspresi `.or()` untuk membaca data master level company (ketat).
 * Hanya baris milik company user — tanpa template global (company_id IS NULL).
 */
export function companyScopeOr(scope: UserScope | null): string | null {
  if (!scope || scope.isUnscoped) return null;
  if (scope.businessScope === "holding") return null;
  const companyId = scope.companyId;
  if (!companyId) return null;
  return `company_id.eq.${companyId}`;
}

/**
 * Ekspresi `.or()` untuk membaca data master level branch (ketat).
 * Hanya baris milik branch user — tanpa template global (branch_id IS NULL).
 */
export function branchScopeOr(scope: UserScope | null): string | null {
  const branchId = effectiveBranchId(scope);
  if (!branchId) return null;
  return `branch_id.eq.${branchId}`;
}

/** Cek apakah baris master/operasional boleh diakses user scoped. */
export function isRowInBusinessScope(
  scope: UserScope | null,
  row: { company_id?: string | null; branch_id?: string | null }
): boolean {
  if (!scope || scope.isUnscoped) return true;

  if (scope.businessScope === "branch") {
    if (!scope.branchId || row.branch_id !== scope.branchId) return false;
    if (!scope.companyId || row.company_id !== scope.companyId) return false;
    return true;
  }

  if (scope.businessScope === "company") {
    if (!scope.companyId || row.company_id !== scope.companyId) return false;
    return true;
  }

  return true;
}

/**
 * Looser scope check for operational documents (PO, delivery, GRN) that may have
 * null company_id/branch_id on legacy rows. Null scope columns inherit visibility
 * from the user's company/branch instead of being excluded outright.
 */
export function isOperationalRowInBusinessScope(
  scope: UserScope | null,
  row: { company_id?: string | null; branch_id?: string | null }
): boolean {
  if (!scope || scope.isUnscoped) return true;

  const companyId = row.company_id ?? null;
  const branchId = row.branch_id ?? null;

  if (scope.businessScope === "branch") {
    if (scope.companyId && companyId && companyId !== scope.companyId) return false;
    if (branchId && scope.branchId && branchId !== scope.branchId) return false;
    return true;
  }

  if (scope.businessScope === "company") {
    if (scope.companyId && companyId && companyId !== scope.companyId) return false;
    return true;
  }

  return true;
}

export async function resolveBusinessScopeFromWarehouse(
  warehouseId: string
): Promise<{ company_id: string; branch_id: string } | null> {
  return queryOne<{ company_id: string; branch_id: string }>(
    `SELECT c.id AS company_id, b.id AS branch_id
     FROM configuration.warehouses w
     JOIN configuration.branches b ON b.id = w.branch_id
     JOIN configuration.companies c ON c.id = b.company_id
     WHERE w.id = $1
       AND w.is_active = true
       AND b.is_active = true
       AND c.is_active = true`,
    [warehouseId]
  );
}

export async function resolveBusinessScopeByCodes(
  companyCode: string,
  branchCode: string
): Promise<{ company_id: string; branch_id: string } | null> {
  return queryOne<{ company_id: string; branch_id: string }>(
    `SELECT c.id AS company_id, b.id AS branch_id
     FROM configuration.companies c
     JOIN configuration.branches b ON b.company_id = c.id
     WHERE c.code = $1
       AND b.code = $2
       AND c.is_active = true
       AND b.is_active = true`,
    [companyCode, branchCode]
  );
}

/**
 * Branch filter untuk daftar/validasi gudang penerimaan:
 * - User bercope branch → selalu branch milik user (abaikan context transaksi).
 * - User unscoped (super_admin, dll.) → branch dari delivery/PO bila ada; null = semua gudang aktif.
 */
export function resolveWarehouseBranchFilter(
  scope: UserScope | null,
  contextBranchId?: string | null
): string | null {
  if (scope && !scope.isUnscoped && scope.businessScope === "branch" && scope.branchId) {
    return scope.branchId;
  }
  return contextBranchId ?? null;
}

/**
 * Company filter untuk daftar/validasi gudang:
 * - User bercope company → hanya gudang milik cabang company itu.
 * - User branch sudah dibatasi lewat `resolveWarehouseBranchFilter`;
 *   user unscoped/holding → null (semua).
 */
export function resolveWarehouseCompanyFilter(scope: UserScope | null): string | null {
  if (scope && !scope.isUnscoped && scope.businessScope === "company" && scope.companyId) {
    return scope.companyId;
  }
  return null;
}

export type WarehouseReceivingScopeError =
  | "not_found"
  | "inactive"
  | "branch_mismatch";

export async function validateWarehouseForReceivingScope(
  warehouseId: string,
  scope: UserScope | null,
  contextBranchId?: string | null
): Promise<{ branch_id: string } | { error: WarehouseReceivingScopeError }> {
  const expectedBranchId = resolveWarehouseBranchFilter(scope, contextBranchId);

  const expectedCompanyId = resolveWarehouseCompanyFilter(scope);

  const warehouse = await queryOne<{
    id: string;
    branch_id: string;
    is_active: boolean;
    company_id: string | null;
  }>(
    `SELECT w.id, w.branch_id, w.is_active, b.company_id
     FROM configuration.warehouses w
     LEFT JOIN configuration.branches b ON b.id = w.branch_id
     WHERE w.id = $1`,
    [warehouseId]
  );

  if (!warehouse) return { error: "not_found" };
  if (!warehouse.is_active) return { error: "inactive" };
  if (expectedBranchId && warehouse.branch_id !== expectedBranchId) {
    return { error: "branch_mismatch" };
  }
  if (expectedCompanyId && warehouse.company_id !== expectedCompanyId) {
    return { error: "branch_mismatch" };
  }

  return { branch_id: warehouse.branch_id };
}

/**
 * Cari warehouse default untuk sebuah branch (is_default, fallback yang aktif).
 */
export async function resolveDefaultWarehouseId(
  branchId: string | null
): Promise<string | null> {
  if (!branchId) return null;
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM configuration.warehouses
     WHERE branch_id = $1 AND is_active = true
     ORDER BY is_default DESC, created_at ASC
     LIMIT 1`,
    [branchId]
  );
  return row?.id ?? null;
}

const WAREHOUSE_SCOPE_ERRORS: Record<WarehouseReceivingScopeError, string> = {
  not_found: "Stall not found",
  inactive: "Stall is inactive",
  branch_mismatch: "Stall is outside your branch scope",
};

/** Validate stall for product master (mandatory warehouse_id). */
export async function validateProductWarehouseScope(
  warehouseId: string,
  scope: UserScope | null
): Promise<
  { company_id: string; branch_id: string; warehouse_id: string } | { error: string }
> {
  const business = await resolveBusinessScopeFromWarehouse(warehouseId);
  if (!business) return { error: "Stall not found or inactive" };

  const warehouseCheck = await validateWarehouseForReceivingScope(
    warehouseId,
    scope,
    business.branch_id
  );
  if ("error" in warehouseCheck) {
    return { error: WAREHOUSE_SCOPE_ERRORS[warehouseCheck.error] };
  }

  if (scope && !scope.isUnscoped && scope.businessScope === "company") {
    if (scope.companyId && business.company_id !== scope.companyId) {
      return { error: "Stall is outside your company scope" };
    }
  }

  return {
    company_id: business.company_id,
    branch_id: business.branch_id,
    warehouse_id: warehouseId,
  };
}
