import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { loadMe } from "@/lib/hris/me-profile";
import { requireWorkforceActor } from "@/lib/hris/workforce-route";

/**
 * GET /api/hris/me: identitas karyawan milik akun yang login + kuota cuti
 * tahun berjalan + shift hari ini (halaman ESS /dashboard/me/*). employee
 * null bila akun tidak tertaut record karyawan (mis. super admin).
 */
export const GET = apiHandler(async () => {
  const actor = await requireWorkforceActor();
  if (!actor.employeeId) {
    return NextResponse.json({ data: { employee: null, leave_balance: null } });
  }
  return NextResponse.json({ data: await loadMe(actor.employeeId) });
}, "hris/me.GET");
