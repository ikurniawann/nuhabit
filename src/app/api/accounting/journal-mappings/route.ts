import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  getApiUserScope,
} from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import {
  accountingCompanyId,
  requireAccountingCompanyId,
} from "@/lib/accounting/company-scope";
import {
  JOURNAL_AMOUNT_SOURCES,
  JOURNAL_ENTRY_SIDES,
  JOURNAL_EVENT_CODES,
  JOURNAL_EVENT_META,
  JOURNAL_MODULES,
} from "@/lib/accounting/journal-mapping-types";
import {
  createJournalMappingRecord,
  listJournalMappings,
} from "@/lib/accounting/journal-mapping-store";

const lineSchema = z.object({
  id: z.string().uuid().optional(),
  entry_side: z.enum([...JOURNAL_ENTRY_SIDES]),
  line_role: z.string().trim().min(1).max(40),
  account_id: z.string().uuid().nullable().optional(),
  amount_source: z.enum([...JOURNAL_AMOUNT_SOURCES]),
  sort_order: z.number().int().optional(),
  is_required: z.boolean().optional(),
});

const payloadSchema = z.object({
  event_code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().nullable().optional(),
  module: z.enum([...JOURNAL_MODULES]),
  is_active: z.boolean().optional(),
  lines: z.array(lineSchema).min(1),
});

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.accounting);
    const scope = await getApiUserScope();
    const { searchParams } = new URL(request.url);

    const companyId = accountingCompanyId(scope);
    if (!companyId) {
      return NextResponse.json({ data: [] });
    }
    const data = await listJournalMappings({
      search: searchParams.get("search")?.trim() || undefined,
      module: searchParams.get("module") || undefined,
      isActive: searchParams.get("is_active") || undefined,
      companyScopeOr: `company_id.eq.${companyId}`,
    });

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/journal-mappings] GET", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const body = payloadSchema.parse(await request.json());
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);

    const eventCode = body.event_code.trim().toUpperCase();
    const meta =
      JOURNAL_EVENT_META[eventCode as (typeof JOURNAL_EVENT_CODES)[number]];
    const journalModule = (body.module || meta?.module) as (typeof JOURNAL_MODULES)[number];
    if (!(JOURNAL_MODULES as readonly string[]).includes(journalModule)) {
      throw ApiError.badRequest("Module tidak valid");
    }

    if (body.lines.length < 1) {
      throw ApiError.badRequest("Minimal satu baris mapping");
    }

    try {
      const data = await createJournalMappingRecord({
        userId: user.id,
        companyId,
        event_code: eventCode,
        name: body.name.trim() || meta?.name || eventCode,
        description: body.description?.trim() || meta?.description || null,
        module: journalModule,
        is_active: body.is_active ?? true,
        lines: body.lines,
      });

      return NextResponse.json(
        { data, message: "Journal mapping berhasil ditambahkan" },
        { status: 201 }
      );
    } catch (error) {
      const msg = errMsg(error);
      if (/duplicate|unique/i.test(msg) || (error as { code?: string }).code === "23505") {
        throw ApiError.badRequest("Event code sudah ada untuk company ini");
      }
      if (/postable|tidak ditemukan|company yang sama|dihapus/i.test(msg)) {
        throw ApiError.badRequest(msg);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Validasi gagal" },
        { status: 400 }
      );
    }
    console.error("[accounting/journal-mappings] POST", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
