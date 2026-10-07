import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { removePurchaseOrderItem, updatePurchaseOrderItem } from "@/lib/purchasing/po-lifecycle";
import { poItemUpdateSchema } from "@/lib/purchasing/po-schemas";

type RouteContext = { params: Promise<{ item_id: string }> };

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { item_id } = await params;
  const input = await validateBody(request, poItemUpdateSchema);
  const data = await updatePurchaseOrderItem(await createServerPgClient(), item_id, input);
  return NextResponse.json({ success: true, data, message: "Item berhasil diupdate" });
}, "purchasing.po.items.update");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { item_id } = await params;
  await removePurchaseOrderItem(await createServerPgClient(), item_id);
  return NextResponse.json({ success: true, message: "Item berhasil dihapus dari PO" });
}, "purchasing.po.items.remove");
