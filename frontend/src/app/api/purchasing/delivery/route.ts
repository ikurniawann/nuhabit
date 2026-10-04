import { NextRequest } from "next/server";
import { createdResponse, paginatedResponse, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { createDeliverySchema, deliveryListQuerySchema } from "@/lib/purchasing/delivery-schemas";
import { createDelivery, listDeliveries } from "@/lib/purchasing/delivery-service";
import { parseSearchParams } from "@/lib/purchasing/receiving-query";

// GET /api/purchasing/delivery — daftar delivery ber-scope
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);
  const params = parseSearchParams(request, deliveryListQuerySchema);
  const { data, total } = await listDeliveries(await createServerPgClient(), params);
  return paginatedResponse(data, {
    page: params.page,
    limit: params.limit,
    total,
    totalPages: Math.ceil(total / params.limit),
  });
}, "purchasing.delivery.list");

// POST /api/purchasing/delivery — buat delivery dari PO
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const input = await validateBody(request, createDeliverySchema);
  const delivery = await createDelivery(await createServerPgClient(), input, user.id);
  return createdResponse(delivery, "Delivery created successfully");
}, "purchasing.delivery.create");
