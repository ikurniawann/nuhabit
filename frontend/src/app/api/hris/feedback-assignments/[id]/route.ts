import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { feedbackAssignmentUpdateSchema } from "@/lib/hris/feedback-schemas";
import { deleteAssignment, getAssignment, updateAssignment } from "@/lib/hris/feedback-repo";
import { readJson } from "@/lib/hris/workforce-route";

// Modul 360 feedback belum punya UI; semua handler khusus pengelola kinerja.

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
  return NextResponse.json({ data: await getAssignment((await params).id) });
}, "hris/feedback-assignments/[id] GET");

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
  const { id } = await params;
  const body = await readJson(request, feedbackAssignmentUpdateSchema, "Data tidak valid");
  return NextResponse.json({ data: await updateAssignment(id, body) });
}, "hris/feedback-assignments/[id] PUT");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
  await deleteAssignment((await params).id);
  return NextResponse.json({ message: "Assignment deleted successfully" });
}, "hris/feedback-assignments/[id] DELETE");
