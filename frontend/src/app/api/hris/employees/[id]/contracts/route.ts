import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import {
  createContractSchema,
  createEmployeeContract,
  listEmployeeContracts,
} from "@/lib/hris/employees-profile";
import { readJson, requireUuid } from "@/lib/hris/workforce-route";

/**
 * GET  /api/hris/employees/[id]/contracts — daftar kontrak karyawan
 * POST /api/hris/employees/[id]/contracts — buat draft kontrak (PKWTT/PKWT)
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const GET = apiHandler(async (_req: NextRequest, { params }: RouteParams) => {
  await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const id = requireUuid((await params).id, "ID karyawan tidak valid");
  return NextResponse.json({ data: await listEmployeeContracts(id) });
}, "hris/employees/contracts GET");

export const POST = apiHandler(async (req: NextRequest, { params }: RouteParams) => {
  const user = await requireIamMenuPrefix(IAM.hrisKepegawaian);
  const id = requireUuid((await params).id, "ID karyawan tidak valid");
  const body = await readJson(req, createContractSchema);
  const { contract, contractNumber } = await createEmployeeContract(id, body, user.full_name);
  return NextResponse.json(
    { data: contract, message: `Draft kontrak ${contractNumber} dibuat` },
    { status: 201 }
  );
}, "hris/employees/contracts POST");
