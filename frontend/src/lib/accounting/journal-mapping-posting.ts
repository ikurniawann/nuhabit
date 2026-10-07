import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import {
  createJournalEntryRecord,
  findJournalEntryBySource,
} from "@/lib/accounting/journal-entry-store";
import type { JournalEntryLinePayload, JournalMappingLineItem } from "./types";
import type {
  JournalAmountSource,
  JournalEventCode,
} from "@/lib/accounting/journal-mapping-types";
import type { JournalLineSide } from "@/lib/accounting/fiscal-types";

export type JournalAmountBag = Partial<Record<JournalAmountSource, number>>;
export type JournalAmountMap = JournalAmountBag;

export type MappingPostResult = {
  status: "posted" | "draft" | "skipped";
  entryId?: string;
  reason?: string;
};

export class AccountingPostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingPostError";
  }
}

/** Untuk `.catch()` di route: galat posting jurnal tetap 500 tapi pesannya sampai ke user. */
export function rethrowAccountingPostError(error: unknown): never {
  if (error instanceof AccountingPostError) throw new ApiError(500, error.message);
  throw error;
}

type MappingHeader = {
  id: string;
  company_id: string | null;
  event_code: string;
  name: string;
  is_active: boolean;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function resolveAmountFromSource(
  source: string,
  amounts: JournalAmountBag
): number {
  const key = source as JournalAmountSource;
  const value = Number(amounts[key] ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return round2(value);
}

export function mappingHasRequiredAccounts(
  lines: Array<Pick<JournalMappingLineItem, "account_id" | "is_required">>
): boolean {
  return lines.every((line) => !line.is_required || Boolean(line.account_id));
}

export function buildJournalLinesFromMapping(opts: {
  lines: Array<
    Pick<
      JournalMappingLineItem,
      | "entry_side"
      | "account_id"
      | "amount_source"
      | "sort_order"
      | "is_required"
      | "line_role"
    >
  >;
  amounts: JournalAmountBag;
  memo?: string | null;
}): {
  ready: boolean;
  reason?: string;
  journalLines: JournalEntryLinePayload[];
} {
  if (!mappingHasRequiredAccounts(opts.lines)) {
    return {
      ready: false,
      reason: "Journal mapping belum lengkap (akun COA wajib belum diisi)",
      journalLines: [],
    };
  }

  const journalLines: JournalEntryLinePayload[] = [];
  for (const line of opts.lines) {
    const amount = resolveAmountFromSource(line.amount_source, opts.amounts);
    if (amount <= 0) {
      if (line.is_required) {
        return {
          ready: false,
          reason: `Amount source ${line.amount_source} untuk role ${line.line_role} bernilai 0`,
          journalLines: [],
        };
      }
      continue;
    }
    // Optional role (DISCOUNT/TAX/SC) dengan nilai > 0 tapi COA kosong
    // jangan di-skip diam-diam — itu bikin jurnal tidak balance.
    if (!line.account_id) {
      return {
        ready: false,
        reason: `Akun COA untuk role ${line.line_role} belum diisi (nilai ${line.amount_source}=${amount})`,
        journalLines: [],
      };
    }
    journalLines.push({
      account_id: line.account_id,
      entry_side: line.entry_side as JournalLineSide,
      amount,
      memo: opts.memo ?? null,
      sort_order: line.sort_order,
    });
  }

  if (journalLines.length < 2) {
    return {
      ready: false,
      reason: "Baris jurnal dari mapping kurang dari 2 setelah amount dihitung",
      journalLines: [],
    };
  }

  return { ready: true, journalLines };
}

async function resolveActiveMapping(
  eventCode: string,
  companyId: string | null
): Promise<{ mapping: MappingHeader; lines: JournalMappingLineItem[] } | null> {
  const mapping = await queryOne<MappingHeader>(
    `SELECT id, company_id, event_code, name, is_active
     FROM accounting.journal_mappings
     WHERE deleted_at IS NULL
       AND is_active = true
       AND event_code = $1
       AND (
         ($2::uuid IS NOT NULL AND company_id = $2::uuid)
         OR company_id IS NULL
       )
     ORDER BY CASE WHEN company_id IS NULL THEN 1 ELSE 0 END ASC
     LIMIT 1`,
    [eventCode, companyId]
  );

  if (!mapping) return null;

  const lineRows = await query<{
    id: string;
    mapping_id: string;
    entry_side: string;
    line_role: string;
    account_id: string | null;
    amount_source: string;
    sort_order: number;
    is_required: boolean;
    account_code: string | null;
    account_name: string | null;
  }>(
    `SELECT l.id, l.mapping_id, l.entry_side, l.line_role, l.account_id,
            l.amount_source, l.sort_order, l.is_required,
            coa.code AS account_code, coa.name AS account_name
     FROM accounting.journal_mapping_lines l
     LEFT JOIN accounting.chart_of_accounts coa
       ON coa.id = l.account_id AND coa.deleted_at IS NULL
     WHERE l.mapping_id = $1::uuid
     ORDER BY l.sort_order ASC, l.entry_side ASC`,
    [mapping.id]
  );

  return {
    mapping,
    lines: lineRows.map((row) => ({
      id: row.id,
      mapping_id: row.mapping_id,
      entry_side: row.entry_side as JournalMappingLineItem["entry_side"],
      line_role: row.line_role,
      account_id: row.account_id,
      account_code: row.account_code,
      account_name: row.account_name,
      amount_source: row.amount_source as JournalMappingLineItem["amount_source"],
      sort_order: row.sort_order,
      is_required: row.is_required,
    })),
  };
}

export type PostFromMappingInput = {
  companyId: string | null;
  userId: string;
  eventCode: JournalEventCode | string;
  documentType: string;
  documentId: string;
  entryDate: string;
  amounts: JournalAmountBag;
  description: string;
  sourceModule?: string;
};

/**
 * Post journal from mapping template.
 * - No active mapping → skipped (non-blocking)
 * - Mapping incomplete (missing COA) → draft status without entry (non-blocking warning)
 * - Mapping ready → create AUTO POSTED entry; technical/fiscal failures throw AccountingPostError
 */
export async function postJournalFromMapping(
  input: PostFromMappingInput
): Promise<MappingPostResult> {
  const existing = await findJournalEntryBySource({
    companyId: input.companyId,
    sourceEventCode: input.eventCode,
    sourceDocumentId: input.documentId,
  });
  if (existing) {
    return {
      status: existing.status === "POSTED" ? "posted" : "draft",
      entryId: existing.id,
      reason: "already_exists",
    };
  }

  const resolved = await resolveActiveMapping(input.eventCode, input.companyId);
  if (!resolved) {
    return {
      status: "skipped",
      reason: `Tidak ada journal mapping aktif untuk ${input.eventCode}`,
    };
  }

  const built = buildJournalLinesFromMapping({
    lines: resolved.lines,
    amounts: input.amounts,
    memo: input.description,
  });

  if (!built.ready) {
    // Mapping ada tapi belum siap → DRAFT logical / non-blocking (hybrid)
    return {
      status: "draft",
      reason: built.reason,
    };
  }

  try {
    const entry = await createJournalEntryRecord({
      userId: input.userId,
      companyId: input.companyId,
      entry_date: input.entryDate,
      description: input.description,
      is_recon: false,
      lines: built.journalLines,
      post: true,
      entry_type: "AUTO",
      source_module: input.sourceModule ?? "PURCHASING",
      source_event_code: input.eventCode,
      source_document_type: input.documentType,
      source_document_id: input.documentId,
    });
    return { status: "posted", entryId: entry.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal posting jurnal";
    // Unique race → treat as success idempotent
    if (/duplicate key|unique constraint/i.test(message)) {
      const again = await findJournalEntryBySource({
        companyId: input.companyId,
        sourceEventCode: input.eventCode,
        sourceDocumentId: input.documentId,
      });
      if (again) {
        return {
          status: again.status === "POSTED" ? "posted" : "draft",
          entryId: again.id,
          reason: "already_exists",
        };
      }
    }
    throw new AccountingPostError(
      `Gagal posting jurnal ${input.eventCode}: ${message}`
    );
  }
}
