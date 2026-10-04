import { buildXlsxBuffer, parseXlsxToMatrix } from "@/lib/spreadsheet/exceljs-safe";
import {
  inferAccountLevel,
  normalizeAccountCode,
  resolveParentCode,
} from "@/lib/accounting/account-code";
import {
  inferAccountTypeCode,
  inferCashFlowCategory,
  inferIsCashBank,
  inferIsContra,
  isCashFlowCategory,
  type AccountTypeCode,
  type CashFlowCategory,
} from "@/lib/accounting/coa-types";

export interface ParsedCoaRow {
  code: string;
  name: string;
  parent_code: string | null;
  account_type_code: AccountTypeCode;
  level: 1 | 2 | 3 | 4;
  is_contra: boolean;
  is_cash_bank: boolean;
  cash_flow_category: CashFlowCategory | null;
  description: string | null;
  source_row: number;
}

export interface CoaParseIssue {
  row: number;
  code?: string;
  message: string;
}

const HEADER_ALIASES: Record<string, string> = {
  account_code: "code",
  kode: "code",
  kode_akun: "code",
  account_name: "name",
  nama: "name",
  nama_akun: "name",
  parent: "parent_code",
  parent_account: "parent_code",
  parent_kode: "parent_code",
  account_type: "account_type_code",
  type: "account_type_code",
  tipe: "account_type_code",
  contra: "is_contra",
  is_contra_account: "is_contra",
  cash_bank: "is_cash_bank",
  is_cash: "is_cash_bank",
  is_bank: "is_cash_bank",
  kas_bank: "is_cash_bank",
  cashflow: "cash_flow_category",
  cash_flow: "cash_flow_category",
  deskripsi: "description",
};

function normalizeHeader(header: string) {
  const key = header.toLowerCase().trim().replace(/\s+/g, "_");
  return HEADER_ALIASES[key] || key;
}

function cell(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function parseBool(value: string | undefined, fallback = false) {
  if (!value?.trim()) return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "ya"].includes(v)) return true;
  if (["0", "false", "no", "n", "tidak"].includes(v)) return false;
  return fallback;
}

/** Known Excel data fixes (duplicate / reserved codes). */
const CODE_OVERRIDES: Record<string, string> = {
  // First "Rounding Gain" incorrectly shares 8301001 with Rounding Loss
};

/**
 * Detect SULU layout: first column looks like spaced account code,
 * name lives in one of columns B–E (no header row with "code").
 */
export function isSuluCoaLayout(rows: unknown[][]): boolean {
  if (rows.length < 2) return false;
  const first = cell(rows[0]?.[0]);
  if (/^code$/i.test(first) || /^kode/i.test(first)) return false;
  return Boolean(normalizeAccountCode(first));
}

export function parseSuluCoaSheet(rows: unknown[][]): {
  rows: ParsedCoaRow[];
  issues: CoaParseIssue[];
} {
  const issues: CoaParseIssue[] = [];
  const staged: Array<{
    code: string;
    name: string;
    source_row: number;
  }> = [];
  const seen = new Map<string, number>();

  rows.forEach((row, idx) => {
    const source_row = idx + 1;
    const rawCode = cell(row[0]);
    if (!rawCode) return;

    let code = normalizeAccountCode(rawCode);
    if (!code) {
      issues.push({ row: source_row, message: `Kode tidak valid: ${rawCode}` });
      return;
    }

    // Excel bug: Rounding Gain listed as 8 3 01 001 before NON OPERATING EXPENSES
    const nameCandidate = [row[1], row[2], row[3], row[4], row[5], row[6]]
      .map(cell)
      .find((v) => v.length > 0);

    if (!nameCandidate) {
      issues.push({
        row: source_row,
        code,
        message: "Nama kosong — baris dilewati",
      });
      return;
    }

    if (
      code === "8301001" &&
      /rounding gain/i.test(nameCandidate) &&
      seen.has("8301001")
    ) {
      // shouldn't happen — gain appears first
    }
    if (code === "8301001" && /rounding gain/i.test(nameCandidate)) {
      code = "8201003";
    }
    if (CODE_OVERRIDES[code]) code = CODE_OVERRIDES[code];

    if (seen.has(code)) {
      issues.push({
        row: source_row,
        code,
        message: `Kode duplikat (sudah di baris ${seen.get(code)})`,
      });
      return;
    }
    seen.set(code, source_row);
    staged.push({ code, name: nameCandidate, source_row });
  });

  const existing = new Set(staged.map((r) => r.code));
  const parsed: ParsedCoaRow[] = staged.map((r) => {
    const level = inferAccountLevel(r.code)!;
    return {
      code: r.code,
      name: r.name,
      parent_code: resolveParentCode(r.code, existing),
      account_type_code: inferAccountTypeCode(r.code),
      level,
      is_contra: inferIsContra(r.name),
      is_cash_bank: inferIsCashBank(r.name, r.code, level),
      cash_flow_category: inferCashFlowCategory(r.code, r.name, level),
      description: null,
      source_row: r.source_row,
    };
  });

  return { rows: parsed, issues };
}

export function parseStandardCoaSheet(matrix: unknown[][]): {
  rows: ParsedCoaRow[];
  issues: CoaParseIssue[];
} {
  const issues: CoaParseIssue[] = [];
  if (matrix.length < 2) {
    return { rows: [], issues: [{ row: 1, message: "File kosong / tanpa data" }] };
  }

  const headers = (matrix[0] as unknown[]).map((h) => normalizeHeader(cell(h)));
  const codeIdx = headers.indexOf("code");
  const nameIdx = headers.indexOf("name");
  if (codeIdx < 0 || nameIdx < 0) {
    return {
      rows: [],
      issues: [{ row: 1, message: "Header wajib: code, name" }],
    };
  }

  const parentIdx = headers.indexOf("parent_code");
  const typeIdx = headers.indexOf("account_type_code");
  const contraIdx = headers.indexOf("is_contra");
  const cashBankIdx = headers.indexOf("is_cash_bank");
  const cfIdx = headers.indexOf("cash_flow_category");
  const descIdx = headers.indexOf("description");

  const staged: ParsedCoaRow[] = [];
  const seen = new Map<string, number>();

  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i] as unknown[];
    const source_row = i + 1;
    const rawCode = cell(row[codeIdx]);
    const name = cell(row[nameIdx]);
    if (!rawCode && !name) continue;

    const code = normalizeAccountCode(rawCode);
    if (!code) {
      issues.push({ row: source_row, message: `Kode tidak valid: ${rawCode}` });
      continue;
    }
    if (!name) {
      issues.push({ row: source_row, code, message: "Nama wajib diisi" });
      continue;
    }
    if (seen.has(code)) {
      issues.push({
        row: source_row,
        code,
        message: `Kode duplikat (baris ${seen.get(code)})`,
      });
      continue;
    }
    seen.set(code, source_row);

    const level = inferAccountLevel(code);
    if (!level) {
      issues.push({ row: source_row, code, message: "Level kode tidak dikenali" });
      continue;
    }

    const typeRaw = typeIdx >= 0 ? cell(row[typeIdx]).toUpperCase() : "";
    const account_type_code = (typeRaw ||
      inferAccountTypeCode(code)) as AccountTypeCode;

    const cfRaw = cfIdx >= 0 ? cell(row[cfIdx]).toUpperCase() : "";
    let cash_flow_category: CashFlowCategory | null = null;
    if (cfRaw) {
      if (!isCashFlowCategory(cfRaw)) {
        issues.push({
          row: source_row,
          code,
          message: `cash_flow_category tidak valid: ${cfRaw}`,
        });
        continue;
      }
      cash_flow_category = cfRaw;
    } else {
      cash_flow_category = inferCashFlowCategory(code, name, level);
    }

    const parentRaw = parentIdx >= 0 ? cell(row[parentIdx]) : "";
    const parent_code = parentRaw
      ? normalizeAccountCode(parentRaw)
      : null;

    staged.push({
      code,
      name,
      parent_code,
      account_type_code,
      level,
      is_contra:
        contraIdx >= 0
          ? parseBool(cell(row[contraIdx]), inferIsContra(name))
          : inferIsContra(name),
      is_cash_bank:
        cashBankIdx >= 0
          ? parseBool(cell(row[cashBankIdx]), inferIsCashBank(name, code, level))
          : inferIsCashBank(name, code, level),
      cash_flow_category,
      description: descIdx >= 0 ? cell(row[descIdx]) || null : null,
      source_row,
    });
  }

  const existing = new Set(staged.map((r) => r.code));
  for (const r of staged) {
    if (r.parent_code == null) {
      r.parent_code = resolveParentCode(r.code, existing);
    } else if (!existing.has(r.parent_code)) {
      // allow parent already in DB — keep as-is; import resolver handles missing
    }
  }

  return { rows: staged, issues };
}

export async function parseCoaSpreadsheet(buffer: Buffer) {
  // Prefer sheet named COA if present (SULU workbook), else the first sheet.
  const matrix = await parseXlsxToMatrix(buffer, {
    pickSheet: (wb) =>
      wb.worksheets.find((ws) => ws.name.toLowerCase() === "coa") ?? wb.worksheets[0],
  });
  if (matrix.length === 0) {
    return {
      rows: [] as ParsedCoaRow[],
      issues: [{ row: 0, message: "Workbook tidak punya sheet" }] as CoaParseIssue[],
    };
  }
  if (isSuluCoaLayout(matrix)) return parseSuluCoaSheet(matrix);
  return parseStandardCoaSheet(matrix);
}

export function buildCoaImportTemplateWorkbook() {
  const headers = [
    "code",
    "name",
    "parent_code",
    "account_type_code",
    "is_contra",
    "is_cash_bank",
    "cash_flow_category",
    "description",
  ];
  const sample = [
    "1000000",
    "CURRENT ASSETS",
    "",
    "ASSET",
    "false",
    "false",
    "",
    "",
  ];
  return buildXlsxBuffer([{ name: "COA", rows: [headers, sample] }]);
}
