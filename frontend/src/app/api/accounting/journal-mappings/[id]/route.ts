import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { JOURNAL_EVENT_META, type JournalEventCode } from "@/lib/accounting/journal-mapping-types";
import { assertRecordInScope, rethrowUniqueViolation } from "@/lib/accounting/route-helpers";
import { journalMappingPayloadSchema } from "@/lib/accounting/schemas";
import {
  getJournalMapping,
  softDeleteJournalMapping,
  updateJournalMappingRecord,
} from "@/lib/accounting/journal-mapping-store";

type RouteContext = { params: Promise<{ id: string }> };

const NOT_FOUND = "Journal mapping tidak ditemukan";
const OUT_OF_SCOPE = "Mapping di luar scope";

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  // User ber-scope boleh membaca template global; row company harus sesuai scope.
  const data = assertRecordInScope(await getJournalMapping(id), await getApiUserScope(), {
    notFound: NOT_FOUND,
    outOfScope: OUT_OF_SCOPE,
  });
  return NextResponse.json({ data });
}, "GET /api/accounting/journal-mappings/[id]");

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  const body = await validateBody(request, journalMappingPayloadSchema);
  const existing = assertRecordInScope(await getJournalMapping(id), await getApiUserScope(), {
    notFound: NOT_FOUND,
    outOfScope: OUT_OF_SCOPE,
    global: "Tidak dapat mengubah template global",
  });
  const eventCode = body.event_code.trim().toUpperCase();
  const meta = JOURNAL_EVENT_META[eventCode as JournalEventCode];

  const data = await updateJournalMappingRecord({
    id,
    userId: user.id,
    event_code: eventCode,
    name: body.name.trim() || meta?.name || eventCode,
    description: body.description?.trim() || null,
    module: body.module,
    is_active: body.is_active ?? true,
    lines: body.lines,
    existingCompanyId: existing.company_id,
  }).catch(rethrowUniqueViolation("Event code sudah digunakan"));
  return NextResponse.json({ data, message: "Journal mapping berhasil diperbarui" });
}, "PUT /api/accounting/journal-mappings/[id]");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  assertRecordInScope(await getJournalMapping(id), await getApiUserScope(), {
    notFound: NOT_FOUND,
    outOfScope: OUT_OF_SCOPE,
    global: "Tidak dapat menghapus template global",
  });
  await softDeleteJournalMapping(id, user.id);
  return NextResponse.json({ message: "Journal mapping berhasil dihapus" });
}, "DELETE /api/accounting/journal-mappings/[id]");
