import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { readJson } from "@/lib/hris/workforce-route";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { deleteRun, getRun, updateRun, updateRunSchema } from "@/lib/payroll/runs";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/hris/payroll/[id]: run + detail per karyawan. */
export const GET = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  await requireIamMenuPrefix(IAM.hrisCompensation);
  const { id } = await params;
  return NextResponse.json({ data: await getRun(await createServerPgClient(), id) });
}, "hris/payroll/[id].GET");

/** PUT /api/hris/payroll/[id]: transisi status (draft → processing → completed → paid). */
export const PUT = apiHandler(async (request: NextRequest, { params }: Ctx) => {
  const user = await requireIamMenuPrefix(IAM.hrisCompensation);
  const { id } = await params;
  const input = await readJson(request, updateRunSchema);
  return NextResponse.json(await updateRun(await createServerPgClient(), user.id, id, input));
}, "hris/payroll/[id].PUT");

/** DELETE /api/hris/payroll/[id]: hanya superadmin; run paid tidak bisa dihapus. */
export const DELETE = apiHandler(async (_request: NextRequest, { params }: Ctx) => {
  const user = await requireIamMenuPrefix(IAM.hrisCompensation);
  if (user.role !== "super_admin") throw ApiError.forbidden("Hanya superadmin yang dapat menghapus payroll run");
  const { id } = await params;
  await deleteRun(await createServerPgClient(), id);
  return NextResponse.json({ message: "Payroll run berhasil dihapus" });
}, "hris/payroll/[id].DELETE");
