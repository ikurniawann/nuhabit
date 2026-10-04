import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { assertRecordInScope, rethrowUniqueViolation } from "@/lib/accounting/route-helpers";
import { fiscalYearPayloadSchema, normalizeFiscalYearPayload } from "@/lib/accounting/schemas";
import {
  getFiscalYear,
  softDeleteFiscalYear,
  updateFiscalYearRecord,
} from "@/lib/accounting/fiscal-year-store";

type RouteContext = { params: Promise<{ id: string }> };

const NOT_FOUND = "Fiscal year tidak ditemukan";
const OUT_OF_SCOPE = "Fiscal year di luar scope";

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  const data = assertRecordInScope(await getFiscalYear(id), await getApiUserScope(), {
    notFound: NOT_FOUND,
    outOfScope: OUT_OF_SCOPE,
  });
  return NextResponse.json({ data });
}, "GET /api/accounting/fiscal-years/[id]");

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  const body = await validateBody(request, fiscalYearPayloadSchema);
  assertRecordInScope(await getFiscalYear(id), await getApiUserScope(), {
    notFound: NOT_FOUND,
    outOfScope: OUT_OF_SCOPE,
    global: "Tidak dapat mengubah fiscal year global",
  });
  const data = await updateFiscalYearRecord({
    id,
    userId: user.id,
    payload: normalizeFiscalYearPayload(body),
  }).catch(rethrowUniqueViolation("Kode fiscal year sudah dipakai"));
  return NextResponse.json({ data, message: "Fiscal year berhasil diperbarui" });
}, "PUT /api/accounting/fiscal-years/[id]");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  assertRecordInScope(await getFiscalYear(id), await getApiUserScope(), {
    notFound: NOT_FOUND,
    outOfScope: OUT_OF_SCOPE,
    global: "Tidak dapat menghapus fiscal year global",
  });
  await softDeleteFiscalYear(id, user.id);
  return NextResponse.json({ message: "Fiscal year berhasil dihapus" });
}, "DELETE /api/accounting/fiscal-years/[id]");
