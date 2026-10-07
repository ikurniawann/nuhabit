import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { listPrsEligibleForPo } from "@/lib/purchasing/pr-queries";

/** PR approved yang belum punya PO, dalam scope bisnis user. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const moduleType = new URL(request.url).searchParams.get("module_type") || "raw_material";
  const data = await listPrsEligibleForPo(db, moduleType, await getApiUserScope());
  return NextResponse.json({ data });
}, "purchasing.pr.for-po");
