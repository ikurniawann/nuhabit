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
  deactivatePriceList,
  getPriceList,
  priceListUpdateSchema,
  updatePriceList,
} from "@/lib/purchasing/vendor-price-list";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const data = await getPriceList(await createServerPgClient(), id, await getApiUserScope());
  return successResponse(data);
}, "purchasing.vendor-price-list.detail");

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  const input = await validateBody(request, priceListUpdateSchema);
  const data = await updatePriceList(await createServerPgClient(), id, input, await getApiUserScope());
  return successResponse(data, "Price list updated successfully");
}, "purchasing.vendor-price-list.update");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.items);
  const { id } = await params;
  await deactivatePriceList(await createServerPgClient(), id, await getApiUserScope());
  return noContentResponse();
}, "purchasing.vendor-price-list.deactivate");
