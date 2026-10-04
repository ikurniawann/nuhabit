import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  getProductDetail,
  updateProduct,
  updateProductSchema,
} from "@/lib/ticketing/products-server";
import { ticketingContext } from "@/lib/ticketing/server";

type Params = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const ctx = await ticketingContext();
  const { id } = await params;
  return successResponse(await getProductDetail(ctx, id));
}, "ticketing.products.detail.GET");

export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const ctx = await ticketingContext();
  const { id } = await params;
  const body = await validateBody(request, updateProductSchema);
  await updateProduct(ctx, id, body);
  return successResponse({ id }, "Ticket tersimpan");
}, "ticketing.products.PATCH");
