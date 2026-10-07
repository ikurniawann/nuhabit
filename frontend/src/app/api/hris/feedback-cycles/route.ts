import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { feedbackCycleSchema } from "@/lib/hris/feedback-schemas";
import { createCycle, listCycles, paginationMeta, parsePagination } from "@/lib/hris/feedback-repo";
import { readJson } from "@/lib/hris/workforce-route";

// Modul 360 feedback belum punya UI; semua handler khusus pengelola kinerja.

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
  const params = request.nextUrl.searchParams;
  const pagination = parsePagination(params, 20);
  const { rows, total } = await listCycles(params, pagination);
  return NextResponse.json({ data: rows, pagination: paginationMeta(pagination, total) });
}, "hris/feedback-cycles GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisPerformanceAdmin);
  const input = await readJson(request, feedbackCycleSchema, "Data tidak valid");
  return NextResponse.json({ data: await createCycle(input) }, { status: 201 });
}, "hris/feedback-cycles POST");
