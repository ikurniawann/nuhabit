import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  attendanceUpdateSchema,
  deleteAttendance,
  getAttendance,
  updateAttendance,
} from "@/lib/hris/attendance-repo";
import { readJson, requireWorkforceActor } from "@/lib/hris/workforce-route";

/**
 * GET    /api/hris/attendance/:id — detail (HR, atau pemilik record)
 * PUT    /api/hris/attendance/:id — koreksi/validasi (HR)
 * DELETE /api/hris/attendance/:id — hapus (super_admin/admin/hrd)
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

const DELETE_ROLES = ["super_admin", "admin", "hrd"];

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteParams) => {
  const actor = await requireWorkforceActor();
  const { id } = await params;
  return NextResponse.json({ data: await getAttendance(id, actor) });
}, "hris/attendance/[id] GET");

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteParams) => {
  const actor = await requireWorkforceActor();
  if (!actor.isHr) {
    throw ApiError.forbidden("Forbidden: Only HRD or managers can update attendance");
  }
  const { id } = await params;
  const body = await readJson(request, attendanceUpdateSchema, "Validation failed");
  const data = await updateAttendance(id, body, actor);
  return NextResponse.json({ message: "Attendance updated successfully", data });
}, "hris/attendance/[id] PUT");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteParams) => {
  const actor = await requireWorkforceActor();
  if (!DELETE_ROLES.includes(actor.role)) {
    throw ApiError.forbidden("Forbidden: Only HRD can delete attendance records");
  }
  const { id } = await params;
  await deleteAttendance(id);
  return NextResponse.json({ message: "Attendance deleted successfully" });
}, "hris/attendance/[id] DELETE");
