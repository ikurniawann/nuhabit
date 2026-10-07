import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { ticketingContext } from "@/lib/ticketing/server";
import {
  deleteTimeSlot,
  updateTimeSlot,
  updateTimeSlotSchema,
} from "@/lib/ticketing/venue-config-server";

type Params = { params: Promise<{ id: string }> };

export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const ctx = await ticketingContext();
  const { id } = await params;
  const body = await validateBody(request, updateTimeSlotSchema);
  return successResponse(await updateTimeSlot(ctx, id, body), "Slot waktu diperbarui");
}, "ticketing.time-slots.PATCH");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const ctx = await ticketingContext();
  const { id } = await params;
  await deleteTimeSlot(ctx, id);
  return successResponse({ id }, "Slot waktu dihapus");
}, "ticketing.time-slots.DELETE");
