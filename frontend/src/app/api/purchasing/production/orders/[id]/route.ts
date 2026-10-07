import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import { completeProductionOrder } from "@/lib/purchasing/production-complete";
import {
  cancelProductionOrder,
  loadProductionOrderForUpdate,
  recheckProductionStock,
  releaseProductionOrder,
  startProductionOrder,
} from "@/lib/purchasing/production-order-actions";
import { getProductionOrderDetail } from "@/lib/purchasing/production-orders";
import { updateProductionSchema } from "@/lib/purchasing/production-schemas";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const data = await getProductionOrderDetail(createPgClient(), id);
  return NextResponse.json({ success: true, data });
}, "purchasing.production.orders.detail");

export const PATCH = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const input = await validateBody(request, updateProductionSchema);
  const db = createPgClient();
  const order = await loadProductionOrderForUpdate(db, id);

  switch (input.action) {
    case "recheck_stock": {
      const { data, message } = await recheckProductionStock(db, order, user.id);
      return NextResponse.json({ success: true, data, message });
    }
    case "release": {
      const data = await releaseProductionOrder(db, order, user.id);
      return NextResponse.json({ success: true, data, message: "Produksi berhasil direlease" });
    }
    case "start": {
      const data = await startProductionOrder(db, order, user.id);
      return NextResponse.json({ success: true, data, message: "Produksi dimulai" });
    }
    case "cancel": {
      const data = await cancelProductionOrder(db, order, user.id);
      return NextResponse.json({ success: true, data, message: "Produksi dibatalkan" });
    }
    case "complete": {
      const { data, message } = await completeProductionOrder(db, order, user.id, input);
      return NextResponse.json({ success: true, data, message });
    }
  }
}, "purchasing.production.orders.update");
