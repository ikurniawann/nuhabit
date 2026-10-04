import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getPurchaseReturn, updatePurchaseReturn } from "@/lib/purchasing/purchase-return-service";
import { returnUpdateSchema } from "@/lib/purchasing/return-schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const { id } = await params;
  const data = await getPurchaseReturn(db, id, scope);
  return NextResponse.json({ success: true, data });
}, "purchasing.returns.detail");

export const PATCH = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const { id } = await params;
  const input = await validateBody(request, returnUpdateSchema);
  const data = await updatePurchaseReturn(db, id, input, scope);
  return NextResponse.json({
    success: true,
    data,
    message: "Purchase return updated successfully",
  });
}, "purchasing.returns.update");
