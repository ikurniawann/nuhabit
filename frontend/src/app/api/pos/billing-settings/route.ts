import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamAction } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { parseJsonBody, requirePosSession } from "@/lib/pos/route-guards";
import { getApiUserScope } from "@/lib/api/scope";
import { resolveActiveStallFromCookies } from "@/lib/auth/active-stall";
import { loadUserWarehouses } from "@/lib/users/user-warehouses";
import { calculateBillCharges } from "@/lib/pos/billing-settings";
import {
  listBillingProfiles,
  listBranchesForBilling,
  listWarehousesForBilling,
  resolveBillingProfile,
  upsertBillingProfile,
} from "@/lib/pos/billing-settings-server";

async function resolveSessionScope(userId: string) {
  const [scope, warehouses, activeStall] = await Promise.all([
    getApiUserScope(),
    loadUserWarehouses(userId),
    resolveActiveStallFromCookies(),
  ]);

  const branchId = scope?.branchId ?? warehouses[0]?.branch_id ?? null;
  let warehouseId: string | null = null;
  if (activeStall.mode === "stall") {
    warehouseId = activeStall.stall.id;
  } else if (activeStall.mode === "unset") {
    warehouseId = warehouses[0]?.warehouse_id ?? null;
  }

  return { branchId, warehouseId };
}

const chargeSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  charge_kind: z.enum(["tax", "service", "fee", "rounding"]),
  calc_method: z.enum(["percent", "fixed", "round_nearest", "round_up"]),
  rate: z.number().nonnegative(),
  amount: z.number().nonnegative(),
  apply_order: z.number().int(),
  is_enabled: z.boolean(),
  is_optional: z.boolean(),
  base: z.enum(["subtotal_after_discount", "subtotal_plus_fees"]),
});

const upsertSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  branch_id: z.string().uuid().nullable(),
  warehouse_id: z.string().uuid().nullable(),
  name: z.string().min(1).max(120),
  charges: z.array(chargeSchema).min(1),
});

/**
 * GET ?mode=resolve (default) | options | list — profil billing untuk kasir.
 * resolve: branch/warehouse eksplisit, atau scope sesi (cabang + stall aktif).
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const sessionUserId = await requirePosSession();
  const { searchParams } = request.nextUrl;
  const mode = searchParams.get("mode") || "resolve";
  const branchId = searchParams.get("branch_id");
  const warehouseId = searchParams.get("warehouse_id");

  if (mode === "options") {
    const [branches, warehouses, profiles] = await Promise.all([
      listBranchesForBilling(),
      listWarehousesForBilling(branchId),
      listBillingProfiles(),
    ]);
    return NextResponse.json({ success: true, data: { branches, warehouses, profiles } });
  }
  if (mode === "list") {
    return NextResponse.json({ success: true, data: await listBillingProfiles() });
  }

  // Parameter eksplisit diutamakan; selain itu scope sesi (cabang + stall aktif).
  const useSession = !branchId && !warehouseId;
  const sessionScope = useSession ? await resolveSessionScope(sessionUserId) : null;
  const profile = await resolveBillingProfile({
    branchId: branchId || sessionScope?.branchId,
    warehouseId: warehouseId || (useSession ? sessionScope?.warehouseId : null),
  });

  const subtotal = Number(searchParams.get("subtotal") || 0);
  const enabledCodes = (searchParams.get("enabled_codes") || "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
  const preview =
    subtotal > 0
      ? calculateBillCharges({ subtotalAfterDiscount: subtotal, charges: profile.charges, enabledOptionalCodes: enabledCodes })
      : null;
  return NextResponse.json({ success: true, data: { profile, preview } });
}, "pos/billing-settings");

/** PUT: ubah profil Tax & Service → izin update menu settings.billing (bukan sekadar sesi kasir). */
export const PUT = apiHandler(async (request: NextRequest) => {
  const user = await requireIamAction(IAM.settingsBilling, "update");
  const body = await parseJsonBody(request, upsertSchema, "Invalid payload");
  const codes = body.charges.map((c) => c.code.trim().toUpperCase());
  if (new Set(codes).size !== codes.length) {
    throw ApiError.badRequest("Charge codes must be unique within a profile");
  }
  const profile = await upsertBillingProfile({
    id: body.id,
    branchId: body.branch_id,
    warehouseId: body.warehouse_id,
    name: body.name,
    updatedBy: user.id,
    charges: body.charges.map((charge) => ({ ...charge, code: charge.code.trim().toUpperCase() })),
  });
  return NextResponse.json({ success: true, data: profile, message: "Billing settings saved" });
}, "pos/billing-settings");
