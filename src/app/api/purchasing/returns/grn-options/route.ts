import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parsePurchasingModuleType } from "@/lib/purchasing/module-scope";
import { listReturnableGrns } from "@/lib/purchasing/purchase-returns";

// GET /api/purchasing/returns/grn-options — GRN selesai QC yang bisa diretur.
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const moduleType = parsePurchasingModuleType(new URL(request.url).searchParams.get("module_type"));
  const data = await listReturnableGrns(db, scope, moduleType);
  return NextResponse.json({ success: true, data });
}, "purchasing.returns.grn-options");
