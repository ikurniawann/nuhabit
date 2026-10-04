import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { EMPLOYEE_RECORD_MANAGERS, requireEmployeeAccess } from "@/lib/hris/employee-access";
import {
  actOnOnboarding,
  listOnboarding,
  onboardingListQuerySchema,
  onboardingPostSchema,
  onboardingPutSchema,
  updateOnboardingTask,
} from "@/lib/hris/onboarding-repo";
import { readJson, requireWorkforceActor } from "@/lib/hris/workforce-route";
import { IAM } from "@/lib/iam/prefixes";
import { parseInput, searchParamsOf } from "@/lib/payroll/request-input";

type Ctx = { params: Promise<{ employee_id: string }> };

/** GET ?category&completed: checklist + ringkasan progres. */
export const GET = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const { employee_id } = await params;
  // Pengelola karyawan / rekrutmen, atau karyawan itu sendiri
  await requireEmployeeAccess(employee_id, [...EMPLOYEE_RECORD_MANAGERS, ...IAM.hrisRecruitment]);
  const query = parseInput(onboardingListQuerySchema, searchParamsOf(request));
  return NextResponse.json(await listOnboarding(employee_id, query));
}, "hris/onboarding.GET");

/** POST { action: "complete", task_id } | { action: "add", ...tugas } */
export const POST = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const actor = await requireWorkforceActor();
  const { employee_id } = await params;
  const input = await readJson(request, onboardingPostSchema);
  return NextResponse.json(await actOnOnboarding(actor, employee_id, input));
}, "hris/onboarding.POST");

/** PUT { task_id, ...field }: ubah tugas (HRD/manajer). */
export const PUT = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const actor = await requireWorkforceActor();
  const { employee_id } = await params;
  const input = await readJson(request, onboardingPutSchema);
  return NextResponse.json(await updateOnboardingTask(actor, employee_id, input));
}, "hris/onboarding.PUT");
