import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireEmployeeAccess } from "@/lib/hris/employee-access";
import { loadEmployeeLifecycle } from "@/lib/hris/employees-profile";
import { requireUuid } from "@/lib/hris/workforce-route";

/**
 * GET /api/hris/employees/[id]/lifecycle — perjalanan hidup karyawan utk
 * tab Lifecycle (pengelola atau karyawan itu sendiri).
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const GET = apiHandler(async (_req: NextRequest, { params }: RouteParams) => {
  const id = requireUuid((await params).id, "ID karyawan tidak valid");
  await requireEmployeeAccess(id);
  return NextResponse.json({ data: await loadEmployeeLifecycle(id) });
}, "hris/employees/lifecycle GET");
