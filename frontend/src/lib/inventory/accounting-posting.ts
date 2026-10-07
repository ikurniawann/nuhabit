/**
 * Posting jurnal otomatis untuk opname / adjustment / transfer bahan baku.
 *
 * - Shortage: Dr COGS (spoil) / Cr Inventori (per coa_asset bahan, fallback mapping)
 * - Surplus: Dr Inventori / Cr COGS
 * - Transfer: Dr Inventori / Cr Inventori (audit nilai; akun sama dari coa_asset)
 *
 * Mapping template: accounting.journal_mappings module INVENTORY.
 */

import { query, queryOne } from "@/lib/db";
import {
  AccountingPostError,
  postJournalFromMapping,
  type MappingPostResult,
} from "@/lib/accounting/journal-mapping-posting";
import {
  createJournalEntryRecord,
  findJournalEntryBySource,
} from "@/lib/accounting/journal-entry-store";
import type { JournalEntryLinePayload } from "@/lib/accounting/types";
import type { JournalEventCode } from "@/lib/accounting/journal-mapping-types";

export { AccountingPostError };
export type { MappingPostResult };

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function summarizeResults(results: MappingPostResult[]): string | null {
  const notes: string[] = [];
  for (const r of results) {
    if (r.status === "posted") notes.push("jurnal posted");
    else if (r.status === "draft")
      notes.push(`jurnal draft: ${r.reason || "mapping belum lengkap"}`);
    else if (r.status === "skipped" && r.reason !== "already_exists") {
      notes.push(`jurnal dilewati: ${r.reason || "tidak ada mapping"}`);
    }
  }
  if (notes.length === 0) return null;
  return [...new Set(notes)].join("; ");
}

export type StockVarianceLine = {
  raw_material_id: string;
  qty_diff: number;
  unit_cost: number;
  material_nama?: string | null;
};

async function resolveCoaIdByCode(
  companyId: string | null,
  code: string
): Promise<string | null> {
  const compact = String(code || "").replace(/[\s\-_.]/g, "");
  if (!/^\d{7}$/.test(compact)) return null;

  const row = await queryOne<{ id: string }>(
    `SELECT id
     FROM accounting.chart_of_accounts
     WHERE deleted_at IS NULL
       AND is_active = true
       AND is_postable = true
       AND code = $1
       AND (
         ($2::uuid IS NOT NULL AND company_id = $2::uuid)
         OR company_id IS NULL
       )
     ORDER BY CASE WHEN company_id IS NULL THEN 1 ELSE 0 END ASC
     LIMIT 1`,
    [compact, companyId]
  );
  return row?.id ?? null;
}

async function resolveMappingAccount(
  eventCode: string,
  companyId: string | null,
  lineRole: string
): Promise<string | null> {
  const row = await queryOne<{ account_id: string | null }>(
    `SELECT l.account_id
     FROM accounting.journal_mappings m
     JOIN accounting.journal_mapping_lines l ON l.mapping_id = m.id
     WHERE m.deleted_at IS NULL
       AND m.is_active = true
       AND m.event_code = $1
       AND l.line_role = $2
       AND (
         ($3::uuid IS NOT NULL AND m.company_id = $3::uuid)
         OR m.company_id IS NULL
       )
     ORDER BY CASE WHEN m.company_id IS NULL THEN 1 ELSE 0 END ASC,
              l.sort_order ASC
     LIMIT 1`,
    [eventCode, lineRole, companyId]
  );
  return row?.account_id ?? null;
}

async function loadMaterialCoa(
  rawMaterialIds: string[]
): Promise<
  Map<string, { company_id: string | null; coa_asset: string | null; nama: string }>
> {
  const map = new Map<
    string,
    { company_id: string | null; coa_asset: string | null; nama: string }
  >();
  if (rawMaterialIds.length === 0) return map;

  const rows = await query<{
    id: string;
    company_id: string | null;
    coa_asset: string | null;
    nama: string;
  }>(
    `SELECT id, company_id, coa_asset, nama
     FROM item.raw_materials
     WHERE id = ANY($1::uuid[])
       AND deleted_at IS NULL`,
    [rawMaterialIds]
  );
  for (const row of rows) {
    map.set(row.id, {
      company_id: row.company_id,
      coa_asset: row.coa_asset,
      nama: row.nama,
    });
  }
  return map;
}

async function resolveInventoryAccountId(opts: {
  companyId: string | null;
  eventCode: string;
  coaAssetCode: string | null;
}): Promise<string | null> {
  if (opts.coaAssetCode) {
    const fromMaterial = await resolveCoaIdByCode(
      opts.companyId,
      opts.coaAssetCode
    );
    if (fromMaterial) return fromMaterial;
  }
  return resolveMappingAccount(opts.eventCode, opts.companyId, "INVENTORY");
}

type VarianceBucket = {
  inventoryAccountId: string;
  amount: number;
  labels: string[];
};

async function postVarianceJournal(opts: {
  companyId: string | null;
  userId: string;
  eventCode: JournalEventCode;
  documentType: string;
  documentId: string;
  entryDate: string;
  description: string;
  lines: StockVarianceLine[];
  /** shortage = qty_diff < 0; surplus = qty_diff > 0 */
  direction: "shortage" | "surplus";
}): Promise<MappingPostResult> {
  const relevant = opts.lines.filter((l) => {
    const qty = Number(l.qty_diff);
    if (opts.direction === "shortage") return qty < 0;
    return qty > 0;
  });

  let total = 0;
  const valued: Array<StockVarianceLine & { value: number }> = [];
  for (const line of relevant) {
    const value = round2(Math.abs(Number(line.qty_diff)) * Number(line.unit_cost || 0));
    if (value <= 0) continue;
    total = round2(total + value);
    valued.push({ ...line, value });
  }

  if (total <= 0) {
    return { status: "skipped", reason: "Nilai selisih 0 — tidak ada jurnal" };
  }

  const existing = await findJournalEntryBySource({
    companyId: opts.companyId,
    sourceEventCode: opts.eventCode,
    sourceDocumentId: opts.documentId,
  });
  if (existing) {
    return {
      status: existing.status === "POSTED" ? "posted" : "draft",
      entryId: existing.id,
      reason: "already_exists",
    };
  }

  const materials = await loadMaterialCoa(valued.map((v) => v.raw_material_id));
  const companyId =
    opts.companyId ||
    [...materials.values()].find((m) => m.company_id)?.company_id ||
    null;

  const offsetRole = "COGS";
  const offsetAccountId = await resolveMappingAccount(
    opts.eventCode,
    companyId,
    offsetRole
  );
  if (!offsetAccountId) {
    // Fallback to template mapping (may be incomplete → draft)
    return postJournalFromMapping({
      companyId,
      userId: opts.userId,
      eventCode: opts.eventCode,
      documentType: opts.documentType,
      documentId: opts.documentId,
      entryDate: opts.entryDate,
      amounts: { TOTAL: total },
      description: opts.description,
      sourceModule: "INVENTORY",
    });
  }

  const buckets = new Map<string, VarianceBucket>();
  for (const line of valued) {
    const mat = materials.get(line.raw_material_id);
    const invId = await resolveInventoryAccountId({
      companyId,
      eventCode: opts.eventCode,
      coaAssetCode: mat?.coa_asset ?? null,
    });
    if (!invId) {
      return {
        status: "draft",
        reason: `Akun inventori belum tersedia untuk ${mat?.nama || line.raw_material_id}`,
      };
    }
    const prev = buckets.get(invId) || {
      inventoryAccountId: invId,
      amount: 0,
      labels: [],
    };
    prev.amount = round2(prev.amount + line.value);
    if (mat?.nama) prev.labels.push(mat.nama);
    buckets.set(invId, prev);
  }

  if (buckets.size === 0) {
    return { status: "draft", reason: "Tidak ada akun inventori yang bisa di-resolve" };
  }

  const journalLines: JournalEntryLinePayload[] = [];
  let sort = 10;

  if (opts.direction === "shortage") {
    journalLines.push({
      account_id: offsetAccountId,
      entry_side: "DEBIT",
      amount: total,
      memo: opts.description,
      sort_order: sort,
    });
    sort += 10;
    for (const bucket of buckets.values()) {
      journalLines.push({
        account_id: bucket.inventoryAccountId,
        entry_side: "CREDIT",
        amount: bucket.amount,
        memo:
          bucket.labels.length > 0
            ? `${opts.description} (${bucket.labels.slice(0, 3).join(", ")})`
            : opts.description,
        sort_order: sort,
      });
      sort += 10;
    }
  } else {
    for (const bucket of buckets.values()) {
      journalLines.push({
        account_id: bucket.inventoryAccountId,
        entry_side: "DEBIT",
        amount: bucket.amount,
        memo:
          bucket.labels.length > 0
            ? `${opts.description} (${bucket.labels.slice(0, 3).join(", ")})`
            : opts.description,
        sort_order: sort,
      });
      sort += 10;
    }
    journalLines.push({
      account_id: offsetAccountId,
      entry_side: "CREDIT",
      amount: total,
      memo: opts.description,
      sort_order: sort,
    });
  }

  try {
    const entry = await createJournalEntryRecord({
      userId: opts.userId,
      companyId,
      entry_date: opts.entryDate,
      description: opts.description,
      is_recon: false,
      lines: journalLines,
      post: true,
      entry_type: "AUTO",
      source_module: "INVENTORY",
      source_event_code: opts.eventCode,
      source_document_type: opts.documentType,
      source_document_id: opts.documentId,
    });
    return { status: "posted", entryId: entry.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal posting jurnal";
    if (/duplicate key|unique constraint/i.test(message)) {
      const again = await findJournalEntryBySource({
        companyId,
        sourceEventCode: opts.eventCode,
        sourceDocumentId: opts.documentId,
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
      `Gagal posting jurnal ${opts.eventCode}: ${message}`
    );
  }
}

export async function postStockOpnameAccounting(opts: {
  companyId: string | null;
  userId: string;
  opnameId: string;
  opnameNumber: string;
  opnameDate: string;
  lines: StockVarianceLine[];
}): Promise<{ results: MappingPostResult[]; note: string | null }> {
  const results: MappingPostResult[] = [];

  results.push(
    await postVarianceJournal({
      companyId: opts.companyId,
      userId: opts.userId,
      eventCode: "STOCK_OPNAME_SHORTAGE",
      documentType: "stock_opname",
      documentId: opts.opnameId,
      entryDate: opts.opnameDate,
      description: `Stock opname ${opts.opnameNumber} — shortage`,
      lines: opts.lines,
      direction: "shortage",
    })
  );

  results.push(
    await postVarianceJournal({
      companyId: opts.companyId,
      userId: opts.userId,
      eventCode: "STOCK_OPNAME_SURPLUS",
      documentType: "stock_opname",
      documentId: opts.opnameId,
      entryDate: opts.opnameDate,
      description: `Stock opname ${opts.opnameNumber} — surplus`,
      lines: opts.lines,
      direction: "surplus",
    })
  );

  return { results, note: summarizeResults(results) };
}

export async function postStockAdjustmentAccounting(opts: {
  companyId: string | null;
  userId: string;
  documentId: string;
  entryDate: string;
  rawMaterialId: string;
  qtyDiff: number;
  unitCost: number;
  notes?: string | null;
}): Promise<{ result: MappingPostResult; note: string | null }> {
  if (opts.qtyDiff === 0) {
    return {
      result: { status: "skipped", reason: "Tidak ada selisih qty" },
      note: null,
    };
  }

  const direction = opts.qtyDiff < 0 ? "shortage" : "surplus";
  const eventCode: JournalEventCode =
    direction === "shortage"
      ? "STOCK_ADJUSTMENT_SHORTAGE"
      : "STOCK_ADJUSTMENT_SURPLUS";

  const result = await postVarianceJournal({
    companyId: opts.companyId,
    userId: opts.userId,
    eventCode,
    documentType: "stock_adjustment",
    documentId: opts.documentId,
    entryDate: opts.entryDate,
    description:
      opts.notes?.trim() ||
      `Stock adjustment ${direction} (${opts.qtyDiff > 0 ? "+" : ""}${opts.qtyDiff})`,
    lines: [
      {
        raw_material_id: opts.rawMaterialId,
        qty_diff: opts.qtyDiff,
        unit_cost: opts.unitCost,
      },
    ],
    direction,
  });

  return { result, note: summarizeResults([result]) };
}

export async function postStockTransferAccounting(opts: {
  companyId: string | null;
  userId: string;
  transferId: string;
  transferNumber: string;
  entryDate: string;
  rawMaterialId: string;
  qty: number;
  unitCost: number;
  sourceWarehouseName?: string;
  destWarehouseName?: string;
}): Promise<{ result: MappingPostResult; note: string | null }> {
  const amount = round2(Math.abs(opts.qty) * Number(opts.unitCost || 0));
  if (amount <= 0) {
    return {
      result: { status: "skipped", reason: "Nilai transfer 0" },
      note: null,
    };
  }

  const materials = await loadMaterialCoa([opts.rawMaterialId]);
  const mat = materials.get(opts.rawMaterialId);
  const companyId = opts.companyId || mat?.company_id || null;

  const inventoryAccountId = await resolveInventoryAccountId({
    companyId,
    eventCode: "STOCK_TRANSFER",
    coaAssetCode: mat?.coa_asset ?? null,
  });

  if (!inventoryAccountId) {
    const result = await postJournalFromMapping({
      companyId,
      userId: opts.userId,
      eventCode: "STOCK_TRANSFER",
      documentType: "stock_transfer",
      documentId: opts.transferId,
      entryDate: opts.entryDate,
      amounts: { TOTAL: amount },
      description: `Transfer ${opts.transferNumber}`,
      sourceModule: "INVENTORY",
    });
    return { result, note: summarizeResults([result]) };
  }

  const existing = await findJournalEntryBySource({
    companyId,
    sourceEventCode: "STOCK_TRANSFER",
    sourceDocumentId: opts.transferId,
  });
  if (existing) {
    const result: MappingPostResult = {
      status: existing.status === "POSTED" ? "posted" : "draft",
      entryId: existing.id,
      reason: "already_exists",
    };
    return { result, note: summarizeResults([result]) };
  }

  const fromLabel = opts.sourceWarehouseName || "sumber";
  const toLabel = opts.destWarehouseName || "tujuan";
  const description = `Transfer ${opts.transferNumber}: ${fromLabel} → ${toLabel}${
    mat?.nama ? ` (${mat.nama})` : ""
  }`;

  // Audit trail: Dr/Cr akun inventori yang sama (nilai netral di GL agregat).
  const lines: JournalEntryLinePayload[] = [
    {
      account_id: inventoryAccountId,
      entry_side: "DEBIT",
      amount,
      memo: `${description} — in`,
      sort_order: 10,
    },
    {
      account_id: inventoryAccountId,
      entry_side: "CREDIT",
      amount,
      memo: `${description} — out`,
      sort_order: 20,
    },
  ];

  try {
    const entry = await createJournalEntryRecord({
      userId: opts.userId,
      companyId,
      entry_date: opts.entryDate,
      description,
      is_recon: false,
      lines,
      post: true,
      entry_type: "AUTO",
      source_module: "INVENTORY",
      source_event_code: "STOCK_TRANSFER",
      source_document_type: "stock_transfer",
      source_document_id: opts.transferId,
    });
    const result: MappingPostResult = { status: "posted", entryId: entry.id };
    return { result, note: summarizeResults([result]) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal posting jurnal";
    throw new AccountingPostError(`Gagal posting jurnal STOCK_TRANSFER: ${message}`);
  }
}
