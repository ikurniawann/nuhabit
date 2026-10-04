// /api/purchasing/returns; scope dari sesi user.
import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parsePurchasingModuleType } from "@/lib/purchasing/module-scope";
import { createPurchaseReturn } from "@/lib/purchasing/purchase-return-service";
import { listPurchaseReturns } from "@/lib/purchasing/purchase-returns";
import { returnCreateSchema } from "@/lib/purchasing/return-schemas";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const sp = new URL(request.url).searchParams;
  const result = await listPurchaseReturns(
    db,
    {
      page: parseInt(sp.get("page") || "1"),
      limit: parseInt(sp.get("limit") || "20"),
      status: sp.get("status") || "all",
      supplierId: sp.get("supplier_id"),
      vendorId: sp.get("vendor_id"),
      reasonType: sp.get("reason_type"),
      dateFrom: sp.get("date_from"),
      dateTo: sp.get("date_to"),
      search: sp.get("search"),
      sortBy: sp.get("sort_by") || "return_date",
      sortOrder: sp.get("sort_order") || "DESC",
      moduleType: parsePurchasingModuleType(sp.get("module_type")),
    },
    scope
  );
  return NextResponse.json({ success: true, ...result });
}, "purchasing.returns.list");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const input = await validateBody(request, returnCreateSchema);
  const data = await createPurchaseReturn(db, input, scope);
  return NextResponse.json({
    success: true,
    data,
    message: "Purchase return created and pending approval",
  });
}, "purchasing.returns.create");
