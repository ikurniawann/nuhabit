import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { accountingCompanyId, requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { journalEntryPayloadSchema } from "@/lib/accounting/schemas";
import { createJournalEntryRecord, listJournalEntries } from "@/lib/accounting/journal-entry-store";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.accounting);
  const companyId = accountingCompanyId(await getApiUserScope());
  if (!companyId) return NextResponse.json({ data: [] });

  const sp = request.nextUrl.searchParams;
  const data = await listJournalEntries({
    search: sp.get("search")?.trim() || undefined,
    status: sp.get("status") || undefined,
    dateFrom: sp.get("date_from") || undefined,
    dateTo: sp.get("date_to") || undefined,
    entryType: sp.get("entry_type") || undefined,
    accountId: sp.get("account_id") || undefined,
    companyScopeOr: `company_id.eq.${companyId}`,
  });
  return NextResponse.json({ data });
}, "GET /api/accounting/journal-entries");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const body = await validateBody(request, journalEntryPayloadSchema);
  const companyId = requireAccountingCompanyId(await getApiUserScope());

  const data = await createJournalEntryRecord({
    userId: user.id,
    companyId,
    entry_date: body.entry_date,
    description: body.description?.trim() || null,
    // is_recon hanya di-set dari proses rekonsiliasi
    is_recon: false,
    lines: body.lines,
    post: body.post ?? false,
  });
  return NextResponse.json(
    {
      data,
      message: body.post
        ? "Journal entry berhasil diposting"
        : "Journal entry draft berhasil disimpan",
    },
    { status: 201 }
  );
}, "POST /api/accounting/journal-entries");
