import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import {
  authorizeShiftManager,
  listEmployeeShifts,
  saveShiftPattern,
  shiftPatternSchema,
} from "@/lib/hris/employees-shifts";
import { readJson, requireUuid } from "@/lib/hris/workforce-route";

/**
 * GET /api/hris/employees/[id]/shifts — pola jadwal shift karyawan + riwayat.
 * PUT /api/hris/employees/[id]/shifts — set pola mingguan baru sejak
 *     effective_from (transaksional). HRD atau atasan langsung.
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const GET = apiHandler(async (_req: NextRequest, { params }: RouteParams) => {
  const id = requireUuid((await params).id, "ID karyawan tidak valid");
  await authorizeShiftManager(id);
  return NextResponse.json({ data: await listEmployeeShifts(id) });
}, "hris/employees/shifts GET");

export const PUT = apiHandler(async (req: NextRequest, { params }: RouteParams) => {
  const id = requireUuid((await params).id, "ID karyawan tidak valid");
  const { actorName } = await authorizeShiftManager(id);
  const pattern = await readJson(req, shiftPatternSchema);
  await saveShiftPattern(id, pattern, actorName);
  return NextResponse.json({
    message: `Jadwal shift disimpan — berlaku mulai ${pattern.effective_from}`,
  });
}, "hris/employees/shifts PUT");
