import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { listScheduleRows } from "@/lib/hris/attendance-repo";
import { isUuid, requireLinkedEmployee, requireWorkforceActor } from "@/lib/hris/workforce-route";

/**
 * GET /api/hris/attendance/schedule?employee_id=me|<uuid> — pola jadwal shift
 * untuk kalender absensi. Karyawan hanya jadwalnya sendiri; HR siapa pun.
 * Resolusi pola → tanggal di client (lib/hris/shifts.resolveScheduleRowForDate).
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const actor = await requireWorkforceActor();
  const requested = req.nextUrl.searchParams.get("employee_id");
  const employeeId = !actor.isHr
    ? requireLinkedEmployee(actor)
    : !requested || requested === "me"
      ? actor.employeeId
      : requested;
  if (!isUuid(employeeId)) throw ApiError.badRequest("ID karyawan tidak valid");
  return NextResponse.json({ data: await listScheduleRows(employeeId) });
}, "hris/attendance/schedule GET");
