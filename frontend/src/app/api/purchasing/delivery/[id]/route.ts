import { NextRequest } from "next/server";
import { requireIamMenuPrefix, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { updateDeliverySchema } from "@/lib/purchasing/delivery-schemas";
import { deleteDelivery, getDeliveryDetail, updateDelivery } from "@/lib/purchasing/delivery-service";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/purchasing/delivery/:id
export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const delivery = await getDeliveryDetail(await createServerPgClient(), id);
  return successResponse(delivery, "Delivery retrieved");
}, "purchasing.delivery.detail");

// PUT /api/purchasing/delivery/:id
export const PUT = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const input = await validateBody(request, updateDeliverySchema);
  const updated = await updateDelivery(await createServerPgClient(), id, input, user.id);
  return successResponse(updated, "Delivery updated");
}, "purchasing.delivery.update");

// DELETE /api/purchasing/delivery/:id — soft delete
export const DELETE = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  await deleteDelivery(await createServerPgClient(), id, user.id);
  return successResponse(null, "Delivery berhasil dihapus");
}, "purchasing.delivery.delete");
