import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { ticketingContext } from "@/lib/ticketing/server";
import {
  createTimeSlot,
  createTimeSlotSchema,
  listTimeSlots,
} from "@/lib/ticketing/venue-config-server";

// EPIC-031 Fase D — CRUD template slot waktu (timed-entry) level venue.
// Admin — selaras Pengaturan Tiket.

export const GET = apiHandler(async () => {
  const ctx = await ticketingContext();
  return successResponse(await listTimeSlots(ctx));
}, "ticketing.time-slots.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext();
  const body = await validateBody(request, createTimeSlotSchema);
  return successResponse(await createTimeSlot(ctx, body), "Slot waktu ditambahkan");
}, "ticketing.time-slots.POST");
