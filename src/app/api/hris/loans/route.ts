import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { readJson, requireWorkforceActor } from "@/lib/hris/workforce-route";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  createLoan,
  createLoanSchema,
  listLoans,
  loanListQuerySchema,
} from "@/lib/payroll/loan-requests";
import { parseInput, searchParamsOf } from "@/lib/payroll/request-input";

/** GET /api/hris/loans: HR/finance: semua; karyawan: pinjaman miliknya (ESS). */
export const GET = apiHandler(async (request: NextRequest) => {
  const actor = await requireWorkforceActor();
  const filter = parseInput(loanListQuerySchema, searchParamsOf(request));
  const data = await listLoans(await createServerPgClient(), actor, filter);
  return NextResponse.json({ data });
}, "hris/loans.GET");

/**
 * POST /api/hris/loans: HR/finance untuk karyawan mana pun; karyawan untuk
 * diri sendiri (bunga dipaksa 0, tetap menunggu approval HR).
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const actor = await requireWorkforceActor();
  const input = await readJson(request, createLoanSchema);
  const data = await createLoan(await createServerPgClient(), actor, input);
  return NextResponse.json({
    data,
    message: "Pengajuan pinjaman berhasil dibuat, menunggu approval",
  });
}, "hris/loans.POST");
