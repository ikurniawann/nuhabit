import { NextRequest, NextResponse } from "next/server";
import { requireIamAction } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parsePurchasingModuleType } from "@/lib/purchasing/module-scope";
import { loadPrFormData } from "@/lib/purchasing/pr-queries";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamAction(IAM.itemsPr, "create");
  const moduleType = parsePurchasingModuleType(new URL(request.url).searchParams.get("module_type"));
  const db = await createServerPgClient();
  const data = await loadPrFormData(db, moduleType, await getApiUserScope());
  return NextResponse.json({ data });
}, "purchasing.pr.form-data");
