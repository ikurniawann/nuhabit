import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { ticketingContext } from "@/lib/ticketing/server";
import {
  deleteCapacityDate,
  updateCapacityDate,
  updateCapacityDateSchema,
} from "@/lib/ticketing/venue-config-server";

type Params = { params: Promise<{ id: string }> };

export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const ctx = await ticketingContext();
  const { id } = await params;
  const body = await validateBody(request, updateCapacityDateSchema);
  return successResponse(await updateCapacityDate(ctx, id, body), "Override kapasitas diperbarui");
}, "ticketing.capacity-dates.PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const ctx = await ticketingContext();
  const { id } = await params;
  await deleteCapacityDate(ctx, id);
  return successResponse({ id }, "Override kapasitas dihapus");
}, "ticketing.capacity-dates.DELETE");
