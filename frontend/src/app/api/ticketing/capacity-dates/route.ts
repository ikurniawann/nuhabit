import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { ticketingContext } from "@/lib/ticketing/server";
import {
  createCapacityDate,
  createCapacityDateSchema,
  listCapacityDates,
} from "@/lib/ticketing/venue-config-server";

// EPIC-031 A3 — override kapasitas harian per rentang tanggal (level VENUE).

export const GET = apiHandler(async () => {
  const ctx = await ticketingContext();
  return successResponse(await listCapacityDates(ctx));
}, "ticketing.capacity-dates.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext();
  const body = await validateBody(request, createCapacityDateSchema);
  return successResponse(await createCapacityDate(ctx, body), "Override kapasitas ditambahkan");
}, "ticketing.capacity-dates.POST");
