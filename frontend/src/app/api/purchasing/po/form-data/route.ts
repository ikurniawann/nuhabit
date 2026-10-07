import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parsePurchasingModuleType } from "@/lib/purchasing/module-scope";
import { loadPoFormData } from "@/lib/purchasing/po-form-data";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const moduleType = parsePurchasingModuleType(new URL(request.url).searchParams.get("module_type"));
  const db = await createServerPgClient();
  const data = await loadPoFormData(db, moduleType, await getApiUserScope());
  return NextResponse.json({ success: true, data });
}, "purchasing.po.form-data");
