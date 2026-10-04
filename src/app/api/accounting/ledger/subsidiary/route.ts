import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import {
  getSubsidiaryLedger,
  listSubsidiaryParties,
  SUBSIDIARY_KINDS,
  type SubsidiaryKind,
} from "@/lib/accounting/subsidiary-ledger-store";

function isSubsidiaryKind(value: string): value is SubsidiaryKind {
  return (SUBSIDIARY_KINDS as readonly string[]).includes(value);
}

export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.accounting);
  const companyId = requireAccountingCompanyId(await getApiUserScope());
  const sp = request.nextUrl.searchParams;
  const kind = (sp.get("kind") || "AP").toUpperCase();
  if (!isSubsidiaryKind(kind)) throw ApiError.badRequest("kind harus AP atau AR");
  const partyKey = sp.get("party_key")?.trim() || undefined;

  if (!partyKey) {
    const data = await listSubsidiaryParties(companyId, kind);
    return NextResponse.json({ success: true, data });
  }

  const today = new Date().toISOString().slice(0, 10);
  const data = await getSubsidiaryLedger({
    companyId,
    kind,
    partyKey,
    dateFrom: sp.get("date_from")?.trim() || `${today.slice(0, 4)}-01-01`,
    dateTo: sp.get("date_to")?.trim() || today,
  });
  if (!data) throw ApiError.notFound("Party tidak ditemukan");
  return NextResponse.json({ success: true, data });
}, "GET /api/accounting/ledger/subsidiary");
