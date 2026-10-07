import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { assertRecordInScope } from "@/lib/accounting/route-helpers";
import { journalEntryPayloadSchema } from "@/lib/accounting/schemas";
import {
  getJournalEntry,
  softDeleteJournalEntry,
  updateJournalEntryRecord,
} from "@/lib/accounting/journal-entry-store";

type RouteContext = { params: Promise<{ id: string }> };

const NOT_FOUND = "Journal entry tidak ditemukan";
const OUT_OF_SCOPE = "Journal entry di luar scope";

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  const data = assertRecordInScope(await getJournalEntry(id), await getApiUserScope(), {
    notFound: NOT_FOUND,
    outOfScope: OUT_OF_SCOPE,
  });
  return NextResponse.json({ data });
}, "GET /api/accounting/journal-entries/[id]");

export const PUT = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  const body = await validateBody(request, journalEntryPayloadSchema);
  const scope = await getApiUserScope();
  const existing = assertRecordInScope(await getJournalEntry(id), scope, {
    notFound: NOT_FOUND,
    outOfScope: OUT_OF_SCOPE,
    global: "Tidak dapat mengubah journal entry global",
  });

  const data = await updateJournalEntryRecord({
    id,
    userId: user.id,
    companyId: existing.company_id ?? requireAccountingCompanyId(scope),
    entry_date: body.entry_date,
    description: body.description?.trim() || null,
    lines: body.lines,
    post: body.post ?? false,
  });
  return NextResponse.json({
    data,
    message: body.post ? "Journal entry berhasil diposting" : "Journal entry berhasil diperbarui",
  });
}, "PUT /api/accounting/journal-entries/[id]");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const { id } = await params;
  assertRecordInScope(await getJournalEntry(id), await getApiUserScope(), {
    notFound: NOT_FOUND,
    outOfScope: OUT_OF_SCOPE,
    global: "Tidak dapat menghapus journal entry global",
  });
  await softDeleteJournalEntry(id, user.id);
  return NextResponse.json({ message: "Journal entry berhasil dihapus" });
}, "DELETE /api/accounting/journal-entries/[id]");
