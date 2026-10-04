import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { readJson } from "@/lib/hris/workforce-route";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseInput, searchParamsOf } from "@/lib/payroll/request-input";
import { createRun, createRunSchema, listRuns, runListQuerySchema } from "@/lib/payroll/runs";

/** GET /api/hris/payroll?year&status: daftar run payroll. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisCompensation);
  const filter = parseInput(runListQuerySchema, searchParamsOf(request));
  const data = await listRuns(await createServerPgClient(), filter);
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}, "hris/payroll.GET");

/** POST /api/hris/payroll: buat run draft untuk satu periode. */
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.hrisCompensation);
  const input = await readJson(
    request,
    createRunSchema,
    "Bulan dan tahun periode wajib diisi dengan benar"
  );
  const data = await createRun(await createServerPgClient(), user.id, input);
  return NextResponse.json({ data, message: "Payroll run berhasil dibuat" });
}, "hris/payroll.POST");
