import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { feedbackAssignmentSchema, oneOrMany } from "@/lib/hris/feedback-schemas";
import {
  createAssignments,
  listAssignments,
  paginationMeta,
  parsePagination,
} from "@/lib/hris/feedback-repo";
import { readJson } from "@/lib/hris/workforce-route";

// Modul 360 feedback belum punya UI; semua handler khusus pengelola kinerja.

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
  const params = request.nextUrl.searchParams;
  const pagination = parsePagination(params, 50);
  const { rows, total } = await listAssignments(params, pagination);
  return NextResponse.json({ data: rows, pagination: paginationMeta(pagination, total) });
}, "hris/feedback-assignments GET");

/** POST — satu atau banyak penugasan reviewer sekaligus. */
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
  const input = await readJson(request, oneOrMany(feedbackAssignmentSchema), "Data tidak valid");
  return NextResponse.json({ data: await createAssignments(input) }, { status: 201 });
}, "hris/feedback-assignments POST");
