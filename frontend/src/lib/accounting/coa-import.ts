import { ApiError } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { createServerPgClient } from "@/lib/pg/create-client";
import { recomputePostableForCompany } from "@/lib/accounting/coa-postable";
import {
  parseCoaSpreadsheet,
  type CoaParseIssue,
  type ParsedCoaRow,
} from "@/lib/accounting/coa-spreadsheet";

export type CoaPreviewAction = "create" | "update" | "skip" | "error";

export interface CoaPreviewRow {
  source_row: number;
  code: string;
  name: string;
  parent_code: string | null;
  account_type_code: string;
  action: CoaPreviewAction;
  message?: string;
}

type ExistingAccount = { id: string; name: string };

/** Klasifikasi tiap baris import terhadap COA yang sudah ada (pure). */
export function buildCoaImportPreview(
  parsed: ParsedCoaRow[],
  typeMap: Map<string, string>,
  existing: Map<string, ExistingAccount>
): CoaPreviewRow[] {
  const importCodes = new Set(parsed.map((r) => r.code));

  return parsed.map((row) => {
    const base = {
      source_row: row.source_row,
      code: row.code,
      name: row.name,
      parent_code: row.parent_code,
      account_type_code: row.account_type_code,
    };
    if (!typeMap.has(row.account_type_code)) {
      return { ...base, action: "error", message: `Account type ${row.account_type_code} tidak ditemukan` };
    }
    if (row.parent_code && !importCodes.has(row.parent_code) && !existing.has(row.parent_code)) {
      return { ...base, action: "error", message: `Parent ${row.parent_code} tidak ditemukan` };
    }
    const ex = existing.get(row.code);
    if (!ex) return { ...base, action: "create" };
    if (ex.name === row.name) return { ...base, action: "skip", message: "Tidak berubah" };
    return { ...base, action: "update" };
  });
}

/** Hitung per aksi; issue parsing ikut dihitung sebagai error. */
export function summarizeCoaImport(preview: CoaPreviewRow[], issues: CoaParseIssue[]) {
  const count = (action: CoaPreviewAction) => preview.filter((p) => p.action === action).length;
  return {
    create: count("create"),
    update: count("update"),
    skip: count("skip"),
    error: count("error") + issues.length,
  };
}

async function loadTypeMap() {
  const db = await createServerPgClient();
  const { data } = await db
    .from("account_types", "accounting")
    .select("id, code")
    .eq("is_active", true);
  const rows = (data ?? []) as Array<{ id: string; code: string }>;
  return new Map<string, string>(rows.map((row) => [row.code.toUpperCase(), row.id]));
}

async function loadExistingByCode(companyId: string) {
  const db = await createServerPgClient();
  const { data } = await db
    .from("chart_of_accounts", "accounting")
    .select("id, code, name")
    .is("deleted_at", null)
    .eq("company_id", companyId);
  const rows = (data ?? []) as Array<{ id: string; code: string; name: string }>;
  return new Map<string, ExistingAccount>(rows.map((row) => [row.code, { id: row.id, name: row.name }]));
}

async function commitCoaImport(opts: {
  companyId: string;
  userId: string;
  parsed: ParsedCoaRow[];
  typeMap: Map<string, string>;
  existing: Map<string, ExistingAccount>;
}) {
  const { companyId, userId, parsed, typeMap, existing } = opts;
  await withTransaction(async (client) => {
    // Urut level lalu kode supaya parent sudah ada lebih dulu.
    const ordered = [...parsed].sort((a, b) => a.level - b.level || a.code.localeCompare(b.code));
    const idByCode = new Map<string, string>([...existing].map(([code, row]) => [code, row.id]));

    for (const row of ordered) {
      const typeId = typeMap.get(row.account_type_code);
      if (!typeId) continue;

      let parentId: string | null = null;
      if (row.parent_code) {
        parentId = idByCode.get(row.parent_code) ?? null;
        if (!parentId) throw new Error(`Parent ${row.parent_code} belum ter-resolve`);
      }

      const ex = existing.get(row.code);
      if (ex) {
        await client.query(
          `UPDATE accounting.chart_of_accounts
           SET name = $1,
               parent_id = $2,
               account_type_id = $3,
               level = $4,
               is_contra = $5,
               is_cash_bank = $6,
               cash_flow_category = $7,
               description = $8,
               is_active = true,
               deleted_at = NULL,
               deleted_by = NULL,
               updated_by = $9,
               updated_at = now()
           WHERE id = $10`,
          [
            row.name,
            parentId,
            typeId,
            row.level,
            row.is_contra,
            row.is_cash_bank,
            row.cash_flow_category,
            row.description,
            userId,
            ex.id,
          ]
        );
        idByCode.set(row.code, ex.id);
      } else {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO accounting.chart_of_accounts (
             company_id, code, name, parent_id, account_type_id, level,
             is_postable, is_contra, is_cash_bank, cash_flow_category, description,
             is_active, created_by, updated_by
           ) VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,true,$11,$11)
           RETURNING id`,
          [
            companyId,
            row.code,
            row.name,
            parentId,
            typeId,
            row.level,
            row.is_contra,
            row.is_cash_bank,
            row.cash_flow_category,
            row.description,
            userId,
          ]
        );
        idByCode.set(row.code, inserted.rows[0].id);
      }
    }

    await recomputePostableForCompany(companyId, client);
  });
}

/** Preview (default) atau commit import COA dari file Excel. */
export async function importChartOfAccounts(opts: {
  companyId: string;
  userId: string;
  file: File;
  mode: string;
}) {
  const { companyId, userId, file, mode } = opts;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { rows: parsed, issues } = await parseCoaSpreadsheet(buffer);

  if (parsed.length === 0) {
    return {
      data: {
        mode,
        issues,
        preview: [],
        summary: { create: 0, update: 0, skip: 0, error: issues.length },
      },
      message: "Tidak ada baris valid untuk diimpor",
    };
  }

  const typeMap = await loadTypeMap();
  const existing = await loadExistingByCode(companyId);
  const preview = buildCoaImportPreview(parsed, typeMap, existing);
  const summary = summarizeCoaImport(preview, issues);

  if (mode !== "commit") return { data: { mode: "preview", issues, preview, summary } };
  if (summary.error > 0) throw ApiError.badRequest("Masih ada error — perbaiki file sebelum commit");

  await commitCoaImport({ companyId, userId, parsed, typeMap, existing });
  return {
    data: { mode: "commit", issues, preview, summary },
    message: `Import selesai: ${summary.create} baru, ${summary.update} update`,
  };
}
