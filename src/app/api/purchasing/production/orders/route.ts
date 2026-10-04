import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import {
  createProductProductionOrder,
  createRawMaterialProductionOrder,
  listProductionOrders,
} from "@/lib/purchasing/production-orders";
import { createProductionSchema } from "@/lib/purchasing/production-schemas";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const { searchParams } = new URL(request.url);
  const data = await listProductionOrders(createPgClient(), {
    status: searchParams.get("status"),
    search: searchParams.get("search"),
    productionContext: searchParams.get("production_context") || "all",
    limit: Math.min(Number(searchParams.get("limit") || 25), 100),
  });
  return NextResponse.json({ success: true, data });
}, "purchasing.production.orders.list");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const input = await validateBody(request, createProductionSchema);
  const db = createPgClient();
  const { order, nomorProduksi } =
    input.production_context === "raw_material"
      ? await createRawMaterialProductionOrder(db, user.id, input)
      : await createProductProductionOrder(db, user.id, input);

  return NextResponse.json(
    {
      success: true,
      data: order,
      message: `Production order ${nomorProduksi} created successfully`,
    },
    { status: 201 }
  );
}, "purchasing.production.orders.create");
