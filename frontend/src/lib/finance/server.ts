import { NextResponse } from "next/server";
import { ApiError, getApiUser } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { userHasIamPrefix } from "@/lib/iam/has-menu";
import type { UserRole } from "@/types";

/** @deprecated Gate memakai menu IAM accounting / sales-funnel. */
export const FINANCE_ROLES: UserRole[] = ["super_admin", "finance_staff"];

/** @deprecated Dipakai call site lama; viewer = accounting.receivable ATAU sales-funnel. */
export const INVOICE_VIEWER_ROLES: UserRole[] = [
  "super_admin",
  "sales",
  "finance_staff",
];

export type FinanceUser = { id: string; role: UserRole };

function financeMenus(allowed: readonly string[]): readonly string[] {
  if (allowed.includes("sales")) {
    return [...IAM.accounting, ...IAM.salesFunnel];
  }
  return IAM.accounting;
}

/** Guard finance: sesi + grant menu accounting (atau sales-funnel untuk viewer), lempar 401/403. */
export async function requireFinanceUser(
  allowed: readonly UserRole[] = FINANCE_ROLES
): Promise<FinanceUser> {
  const user = await getApiUser();
  if (!user) throw ApiError.unauthorized();
  if (!(await userHasIamPrefix(user.id, user.role, financeMenus(allowed)))) {
    throw ApiError.forbidden();
  }
  return { id: user.id, role: user.role };
}

/** Varian non-throw untuk route lama (sales-funnel) yang memeriksa `error`. */
export async function requireFinanceRole(
  allowed: UserRole[] = FINANCE_ROLES
): Promise<
  { error: NextResponse; user: null } | { error: null; user: FinanceUser }
> {
  try {
    return { error: null, user: await requireFinanceUser(allowed) };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.toResponse(), user: null };
    throw error;
  }
}
