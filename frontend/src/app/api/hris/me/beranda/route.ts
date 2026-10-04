import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { loadBeranda } from "@/lib/hris/me-profile";
import { requireWorkforceActor } from "@/lib/hris/workforce-route";

/** GET /api/hris/me/beranda: ringkasan beranda ESS dalam satu round trip. */
export const GET = apiHandler(async () => {
  const actor = await requireWorkforceActor();
  // Akun tak tertaut karyawan (mis. super admin murni) tak punya beranda personal
  if (!actor.employeeId) return NextResponse.json({ data: { employee: null } });
  return NextResponse.json({ data: await loadBeranda(actor.employeeId) });
}, "hris/me/beranda.GET");
