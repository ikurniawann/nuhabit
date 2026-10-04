import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { EMPLOYEE_RECORD_MANAGERS, requireEmployeeAccess } from "@/lib/hris/employee-access";
import {
  initiateOffboarding,
  listOffboarding,
  offboardingUpdateSchema,
  resignationSchema,
  updateOffboarding,
} from "@/lib/hris/offboarding-repo";
import { readJson, requireWorkforceActor } from "@/lib/hris/workforce-route";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ employee_id: string }> };

/** GET: checklist offboarding: pengelola karyawan/rekrutmen, atau karyawan itu sendiri. */
export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const { employee_id } = await params;
  await requireEmployeeAccess(employee_id, [...EMPLOYEE_RECORD_MANAGERS, ...IAM.hrisRecruitment]);
  return NextResponse.json({ data: await listOffboarding(employee_id) });
}, "hris/offboarding.GET");

/** POST: mulai proses resign/offboarding. */
export const POST = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const actor = await requireWorkforceActor();
  const { employee_id } = await params;
  const input = await readJson(request, resignationSchema, "Validation failed");
  const data = await initiateOffboarding(actor, employee_id, input);
  return NextResponse.json({ message: "Offboarding process initiated successfully", data });
}, "hris/offboarding.POST");

/** PUT: perbarui clearance, aset, exit interview, gaji terakhir, status. */
export const PUT = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const actor = await requireWorkforceActor();
  const { employee_id } = await params;
  const input = await readJson(request, offboardingUpdateSchema);
  const data = await updateOffboarding(actor, employee_id, input);
  return NextResponse.json({ message: "Offboarding updated successfully", data });
}, "hris/offboarding.PUT");
