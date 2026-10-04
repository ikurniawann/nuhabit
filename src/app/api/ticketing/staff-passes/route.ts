import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  listStaffPasses,
  pairStaffPass,
  pairStaffPassSchema,
} from "@/lib/ticketing/bands-server";
import { ticketingContext } from "@/lib/ticketing/server";

// Fase E (ops) — Gelang Karyawan: pengaturan hidup di modul Ticketing
// (gelang aset venue, wewenang di ops).

export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext();
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  return successResponse(await listStaffPasses(ctx, q));
}, "ticketing.staff-passes.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext();
  const body = await validateBody(request, pairStaffPassSchema);
  const result = await pairStaffPass(ctx, body);
  return successResponse({ id: result.id }, `Gelang dipasangkan ke ${result.employee}`);
}, "ticketing.staff-passes.POST");
