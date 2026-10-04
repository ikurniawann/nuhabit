import { formatLedgerAmount } from "@/lib/accounting/format";
import type { CoaAccountItem } from "@/features/accounting/chart-of-accounts/types";

/** Logika murni editor saldo awal: baris neraca, total, dan payload simpan. */

const BS_TYPES = new Set(["ASSET", "LIABILITY", "EQUITY"]);

export type ViewMode = "cash_bank" | "all";
type LineSource = "PRIOR_BS" | "RETAINED_EARNINGS" | "MANUAL";

export type BalanceRow = {
  account_id: string;
  code: string;
  name: string;
  account_type_code: string;
  normal_balance: string;
  is_cash_bank: boolean;
  debit: number;
  credit: number;
  source: LineSource | null;
};

export type SuggestedLine = {
  account_id: string;
  account_code?: string;
  entry_side: string;
  amount: number;
  source: LineSource;
};

export type PayloadLine = {
  account_id: string;
  entry_side: "DEBIT" | "CREDIT";
  amount: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function normalizeCode(code: string) {
  return code.replace(/\D/g, "") || code.trim();
}

/** Akun neraca postable & aktif, terisi saran (cocok per id lalu per kode). */
export function buildRows(
  accounts: CoaAccountItem[],
  suggested: SuggestedLine[],
): BalanceRow[] {
  type Hit = { debit: number; credit: number; source: LineSource };
  const byId = new Map<string, Hit>();
  const byCode = new Map<string, Hit>();

  for (const line of suggested) {
    const hit: Hit = {
      debit: line.entry_side === "DEBIT" ? line.amount : 0,
      credit: line.entry_side === "CREDIT" ? line.amount : 0,
      source: line.source,
    };
    byId.set(line.account_id, hit);
    if (line.account_code) {
      byCode.set(normalizeCode(line.account_code), hit);
      byCode.set(line.account_code, hit);
    }
  }

  return accounts
    .filter(
      (a) =>
        a.is_postable &&
        a.is_active &&
        a.account_type_code &&
        BS_TYPES.has(a.account_type_code),
    )
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => {
      const hit =
        byId.get(a.id) ??
        byCode.get(a.code) ??
        byCode.get(normalizeCode(a.code)) ??
        byCode.get(normalizeCode(a.code_display || a.code));
      return {
        account_id: a.id,
        code: a.code_display || a.code,
        name: a.name,
        account_type_code: a.account_type_code || "",
        normal_balance: a.normal_balance || "DEBIT",
        is_cash_bank: Boolean(a.is_cash_bank),
        debit: hit?.debit ?? 0,
        credit: hit?.credit ?? 0,
        source: hit?.source ?? null,
      };
    });
}

/** Isi satu sisi per akun (saldo netto): mengisi debit mengosongkan kredit, dan sebaliknya. */
export function setRowAmount(
  rows: BalanceRow[],
  accountId: string,
  side: "debit" | "credit",
  value: number,
) {
  const amount = Number.isFinite(value) && value > 0 ? value : 0;
  return rows.map((r) => {
    if (r.account_id !== accountId) return r;
    const other = side === "debit" ? "credit" : "debit";
    return {
      ...r,
      [side]: amount,
      [other]: amount > 0 ? 0 : r[other],
      source: r.source ?? "MANUAL",
    };
  });
}

export function balanceTotals(rows: BalanceRow[]) {
  let debit = 0;
  let credit = 0;
  let filled = 0;
  for (const row of rows) {
    if (row.debit > 0) debit += row.debit;
    if (row.credit > 0) credit += row.credit;
    if (row.debit > 0 || row.credit > 0) filled += 1;
  }
  return {
    debit: round2(debit),
    credit: round2(credit),
    diff: round2(debit - credit),
    filled,
  };
}

export function filterRows(
  rows: BalanceRow[],
  viewMode: ViewMode,
  searchQuery: string,
) {
  const base =
    viewMode === "cash_bank" ? rows.filter((r) => r.is_cash_bank) : rows;
  const q = searchQuery.trim().toLowerCase();
  if (!q) return base;
  return base.filter(
    (r) =>
      r.code.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.account_type_code.toLowerCase().includes(q),
  );
}

function toLine(r: BalanceRow): PayloadLine {
  return {
    account_id: r.account_id,
    entry_side: r.debit > 0 ? "DEBIT" : "CREDIT",
    amount: r.debit > 0 ? r.debit : r.credit,
  };
}

/**
 * Baris yang dikirim saat simpan. Mode Kas & Bank: selisih kas/bank otomatis
 * diseimbangkan ke Retained Earnings. Return pesan galat bila belum valid.
 */
export function buildSaveLines(
  rows: BalanceRow[],
  viewMode: ViewMode,
  retainedEarningsId: string | null | undefined,
): { lines: PayloadLine[] } | { error: string } {
  const filled = (r: BalanceRow) => r.debit > 0 || r.credit > 0;

  if (viewMode === "all") {
    const lines = rows.filter(filled).map(toLine);
    if (lines.length < 2) return { error: "Minimal 2 akun dengan saldo > 0" };
    const { diff } = balanceTotals(rows);
    if (diff !== 0)
      return {
        error: `Belum balance (selisih ${formatLedgerAmount(Math.abs(diff))})`,
      };
    return { lines };
  }

  const cashRows = rows.filter((r) => r.is_cash_bank);
  let lines = cashRows.filter(filled).map(toLine);
  const { diff } = balanceTotals(cashRows);
  if (diff !== 0) {
    if (!retainedEarningsId) {
      return {
        error:
          "Butuh akun Retained Earnings / Laba Ditahan untuk menyeimbangkan Kas & Bank",
      };
    }
    // Jangan dobel bila RE ikut terisi manual di daftar kas.
    lines = lines.filter((l) => l.account_id !== retainedEarningsId);
    lines.push({
      account_id: retainedEarningsId,
      entry_side: diff > 0 ? "CREDIT" : "DEBIT",
      amount: Math.abs(diff),
    });
  }
  if (lines.length < 2)
    return {
      error: "Isi minimal satu akun Kas/Bank (lawan otomatis ke Laba Ditahan)",
    };
  return { lines };
}
