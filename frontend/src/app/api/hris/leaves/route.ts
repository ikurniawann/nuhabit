import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import {
  createLeave,
  leaveListQuerySchema,
  leaveRequestSchema,
  listLeaves,
} from "@/lib/hris/leaves-repo";
import { readJson, requireWorkforceActor } from "@/lib/hris/workforce-route";
import { parseInput, searchParamsOf } from "@/lib/payroll/request-input";

/** GET /api/hris/leaves: HR: semua (filter); karyawan: pengajuannya sendiri. */
export const GET = apiHandler(async (request: NextRequest) => {
  const actor = await requireWorkforceActor();
  const query = parseInput(leaveListQuerySchema, searchParamsOf(request));
  return NextResponse.json(await listLeaves(actor, query));
}, "hris/leaves.GET");

/** POST /api/hris/leaves: ajukan cuti (HR boleh atas nama karyawan lain). */
export const POST = apiHandler(async (request: NextRequest) => {
  const actor = await requireWorkforceActor();
  const input = await readJson(request, leaveRequestSchema, "Validation failed");
  return NextResponse.json(await createLeave(actor, input));
}, "hris/leaves.POST");
