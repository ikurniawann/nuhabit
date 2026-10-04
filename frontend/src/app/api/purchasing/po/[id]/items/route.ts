import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { addPurchaseOrderItem, listPurchaseOrderItems } from "@/lib/purchasing/po-lifecycle";
import { poItemCreateSchema } from "@/lib/purchasing/po-schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const data = await listPurchaseOrderItems(await createServerPgClient(), id, { withSku: true });
  return NextResponse.json({ success: true, data });
}, "purchasing.po.items.list");

export const POST = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const input = await validateBody(request, poItemCreateSchema);
  const data = await addPurchaseOrderItem(await createServerPgClient(), id, input);
  return NextResponse.json(
    { success: true, data, message: "Item berhasil ditambahkan ke PO" },
    { status: 201 }
  );
}, "purchasing.po.items.add");
