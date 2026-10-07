import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { listTeamWithSchedule } from "@/lib/hris/team";
import { requireWorkforceActor } from "@/lib/hris/workforce-route";

/**
 * GET /api/hris/me/team: bawahan langsung (employees.reporting_to) karyawan
 * yang login + ringkasan pola shift hari ini, untuk Area Karyawan → Shift Tim.
 * Karyawan tanpa bawahan menerima daftar kosong.
 */
export const GET = apiHandler(async () => {
  const actor = await requireWorkforceActor();
  const members = actor.employeeId ? await listTeamWithSchedule(actor.employeeId) : [];
  return NextResponse.json({ data: { members } });
}, "hris/me/team.GET");
