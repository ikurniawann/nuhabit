import { NextRequest } from "next/server";
import {
  noContentResponse,
  requireIamMenuPrefix,
  successResponse,
  validateBody,
} from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  deleteSupplier,
  getSupplierDetail,
  supplierUpdateSchema,
  updateSupplier,
} from "@/lib/purchasing/supplier-service";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  return successResponse(await getSupplierDetail(await createServerPgClient(), id));
}, "purchasing.suppliers.detail");

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const input = await validateBody(request, supplierUpdateSchema);
  const data = await updateSupplier(await createServerPgClient(), id, input, user.id);
  return successResponse(data, "Supplier berhasil diperbarui");
}, "purchasing.suppliers.update");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  await deleteSupplier(await createServerPgClient(), id, user.id);
  return noContentResponse();
}, "purchasing.suppliers.delete");
