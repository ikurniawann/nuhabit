import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import {
  getLeaveBalance,
  leaveBalanceQuerySchema,
  leaveBalanceUpdateSchema,
  updateLeaveBalance,
} from "@/lib/hris/leave-balances-repo";
import { readJson, requireWorkforceActor } from "@/lib/hris/workforce-route";
import { parseInput, searchParamsOf } from "@/lib/payroll/request-input";

type Ctx = { params: Promise<{ employee_id: string }> };

const yearOf = (request: NextRequest) =>
  parseInput(leaveBalanceQuerySchema, searchParamsOf(request), "Tahun tidak valid").year ??
  new Date().getFullYear();

/** GET /api/hris/leave-balances/:employee_id?year: pemilik, HRD, atau manajer. */
export const GET = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const actor = await requireWorkforceActor();
  const { employee_id } = await params;
  return NextResponse.json({ data: await getLeaveBalance(actor, employee_id, yearOf(request)) });
}, "hris/leave-balances.GET");

/** PUT /api/hris/leave-balances/:employee_id?year: HRD saja. */
export const PUT = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const actor = await requireWorkforceActor();
  const { employee_id } = await params;
  const input = await readJson(request, leaveBalanceUpdateSchema);
  const data = await updateLeaveBalance(actor, employee_id, yearOf(request), input);
  return NextResponse.json({ message: "Leave balance updated successfully", data });
}, "hris/leave-balances.PUT");
