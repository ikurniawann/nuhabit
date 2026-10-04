import { NextRequest } from "next/server";
import {
  noContentResponse,
  requireIamMenuPrefix,
  successResponse,
  validateBody,
} from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  deactivateVendor,
  getScopedVendor,
  updateVendor,
  vendorUpdateSchema,
} from "@/lib/purchasing/vendor-directory";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const vendor = await getScopedVendor(await createServerPgClient(), id, await getApiUserScope());
  return successResponse(vendor);
}, "purchasing.vendors.detail");

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const input = await validateBody(request, vendorUpdateSchema);
  const data = await updateVendor(await createServerPgClient(), id, input, await getApiUserScope());
  return successResponse(data, "Vendor updated successfully");
}, "purchasing.vendors.update");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  await deactivateVendor(await createServerPgClient(), id, await getApiUserScope());
  return noContentResponse();
}, "purchasing.vendors.deactivate");
