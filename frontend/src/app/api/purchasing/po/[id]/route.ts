import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { updateDraftPurchaseOrder, voidPurchaseOrder } from "@/lib/purchasing/po-lifecycle";
import { getPurchaseOrderDetail } from "@/lib/purchasing/po-queries";
import { poUpdateSchema } from "@/lib/purchasing/po-schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const data = await getPurchaseOrderDetail(createPgClient(), id);
  return NextResponse.json({ success: true, data });
}, "purchasing.po.detail");

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const input = await validateBody(request, poUpdateSchema);
  const data = await updateDraftPurchaseOrder(createPgClient(), id, input);
  return NextResponse.json({ success: true, data, message: "PO berhasil diupdate" });
}, "purchasing.po.update");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  await voidPurchaseOrder(createPgClient(), id);
  return NextResponse.json({ success: true, message: "PO berhasil dibatalkan" });
}, "purchasing.po.void");
