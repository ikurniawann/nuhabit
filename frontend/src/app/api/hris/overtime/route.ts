import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import {
  createOvertime,
  listOvertime,
  overtimeCreateSchema,
  overtimeListQuerySchema,
} from "@/lib/hris/overtime-repo";
import { readJson, requireWorkforceActor } from "@/lib/hris/workforce-route";
import { parseInput, searchParamsOf } from "@/lib/payroll/request-input";

/**
 * GET: HR semua; karyawan miliknya; atasan langsung scope=approvals
 * (pengajuan anak buah).
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const actor = await requireWorkforceActor();
  const query = parseInput(overtimeListQuerySchema, searchParamsOf(request));
  return NextResponse.json({ data: await listOvertime(actor, query) });
}, "hris/overtime.GET");

/** POST: pengajuan untuk diri sendiri, atau penugasan HRD untuk karyawan lain. */
export const POST = apiHandler(async (request: NextRequest) => {
  const actor = await requireWorkforceActor();
  const input = await readJson(request, overtimeCreateSchema, "Validation failed");
  return NextResponse.json(await createOvertime(actor, input));
}, "hris/overtime.POST");
