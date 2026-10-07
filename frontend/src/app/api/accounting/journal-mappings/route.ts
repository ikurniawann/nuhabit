import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { accountingCompanyId, requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { JOURNAL_EVENT_META, type JournalEventCode } from "@/lib/accounting/journal-mapping-types";
import { rethrowUniqueViolation } from "@/lib/accounting/route-helpers";
import { journalMappingPayloadSchema } from "@/lib/accounting/schemas";
import {
  createJournalMappingRecord,
  listJournalMappings,
} from "@/lib/accounting/journal-mapping-store";

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.accounting);
  const companyId = accountingCompanyId(await getApiUserScope());
  if (!companyId) return NextResponse.json({ data: [] });

  const sp = request.nextUrl.searchParams;
  const data = await listJournalMappings({
    search: sp.get("search")?.trim() || undefined,
    module: sp.get("module") || undefined,
    isActive: sp.get("is_active") || undefined,
    companyScopeOr: `company_id.eq.${companyId}`,
  });
  return NextResponse.json({ data });
}, "GET /api/accounting/journal-mappings");

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.accounting);
  const body = await validateBody(request, journalMappingPayloadSchema);
  const companyId = requireAccountingCompanyId(await getApiUserScope());
  const eventCode = body.event_code.trim().toUpperCase();
  const meta = JOURNAL_EVENT_META[eventCode as JournalEventCode];

  const data = await createJournalMappingRecord({
    userId: user.id,
    companyId,
    event_code: eventCode,
    name: body.name.trim() || meta?.name || eventCode,
    description: body.description?.trim() || meta?.description || null,
    module: body.module,
    is_active: body.is_active ?? true,
    lines: body.lines,
  }).catch(rethrowUniqueViolation("Event code sudah ada untuk company ini"));
  return NextResponse.json({ data, message: "Journal mapping berhasil ditambahkan" }, { status: 201 });
}, "POST /api/accounting/journal-mappings");
