// /api/purchasing/pr — daftar & pembuatan PR. Daftar: grant IAM items; buat: grant create di menu PR.
import { NextRequest, NextResponse } from "next/server";
import { requireIamAction, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { listPurchaseRequests } from "@/lib/purchasing/pr-queries";
import { createPurchaseRequest } from "@/lib/purchasing/pr-workflow";

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const sp = new URL(request.url).searchParams;
  const result = await listPurchaseRequests(
    db,
    {
      status: sp.get("status"),
      search: sp.get("search"),
      departmentId: sp.get("department_id"),
      moduleType: sp.get("module_type") || "raw_material",
      page: parseInt(sp.get("page") || "1"),
      limit: parseInt(sp.get("limit") || "20"),
    },
    await getApiUserScope(),
    user
  );
  return NextResponse.json(result);
}, "purchasing.pr.list");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamAction(IAM.itemsPr, "create");
  const db = await createServerPgClient();
  const pr = await createPurchaseRequest(db, await request.json(), user, await getApiUserScope());
  return NextResponse.json({ data: pr }, { status: 201 });
}, "purchasing.pr.create");
