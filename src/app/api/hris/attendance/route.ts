import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  clockIn,
  clockInSchema,
  clockOut,
  clockOutSchema,
  listAttendance,
  resolveAttendanceListParams,
} from "@/lib/hris/attendance-repo";
import { parseInput, readJson, requireWorkforceActor } from "@/lib/hris/workforce-route";

/**
 * GET  /api/hris/attendance — daftar absensi (non-HR: miliknya sendiri;
 *      employee_id=me untuk pemulihan state clock-out).
 * POST /api/hris/attendance — action "clock-in" | "clock-out" dengan selfie wajib.
 */

export const GET = apiHandler(async (request: NextRequest) => {
  const actor = await requireWorkforceActor();
  const params = resolveAttendanceListParams(request.nextUrl.searchParams, actor);
  if (!params) {
    return NextResponse.json({ data: [], pagination: { page: 1, limit: 0, total: 0, totalPages: 0 } });
  }
  const { rows, total } = await listAttendance(params);
  return NextResponse.json({
    data: rows,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.ceil(total / params.limit),
    },
  });
}, "hris/attendance GET");

const VALIDATION_FAILED = "Validation failed";
const actionSchema = z.looseObject({ action: z.unknown() });

export const POST = apiHandler(async (request: NextRequest) => {
  const actor = await requireWorkforceActor();
  const body = await readJson(request, actionSchema, VALIDATION_FAILED);

  if (body.action === "clock-in") {
    const result = await clockIn(actor, parseInput(clockInSchema, body, VALIDATION_FAILED));
    if (result.status === "already") {
      return NextResponse.json(
        { success: false, error: "Already clocked in today", attendance_id: result.attendanceId },
        { status: 400 }
      );
    }
    return NextResponse.json({ message: "Clock-in successful", data: result.data });
  }

  if (body.action === "clock-out") {
    const data = await clockOut(actor, parseInput(clockOutSchema, body, VALIDATION_FAILED));
    return NextResponse.json({ message: "Clock-out successful", data });
  }

  throw ApiError.badRequest('Invalid action. Use "clock-in" or "clock-out"');
}, "hris/attendance POST");
