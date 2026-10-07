import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  createProduct,
  createProductSchema,
  listProducts,
} from "@/lib/ticketing/products-server";
import { ticketingContext } from "@/lib/ticketing/server";

export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext();
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  return successResponse(await listProducts(ctx, q));
}, "ticketing.products.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext();
  const body = await validateBody(request, createProductSchema);
  const result = await createProduct(ctx, body);
  return successResponse(result, `Ticket ${result.code} dibuat`);
}, "ticketing.products.POST");
