import { formatLedgerAmount } from "@/lib/accounting/format";
import type { JournalEntryItem, JournalEntryLinePayload } from "@/lib/accounting/types";

/** State & aturan murni form jurnal manual (diuji unit). */

export type FormLine = {
  key: string;
  account_id: string;
  debit: number;
  credit: number;
  memo: string;
  sort_order: number;
};

export type JournalFormState = {
  entry_date: string;
  description: string;
  is_recon: boolean;
  lines: FormLine[];
};

let lineSeq = 0;

export function newLine(partial?: Partial<FormLine>): FormLine {
  lineSeq += 1;
  return { key: `tmp-${lineSeq}`, account_id: "", debit: 0, credit: 0, memo: "", sort_order: 10, ...partial };
}

export function createJournalForm(): JournalFormState {
  return {
    entry_date: new Date().toISOString().slice(0, 10),
    description: "",
    is_recon: false,
    lines: [newLine({ sort_order: 10 }), newLine({ sort_order: 20 })],
  };
}

export function journalFormFromEntry(entry: JournalEntryItem): JournalFormState {
  return {
    entry_date: entry.entry_date,
    description: entry.description ?? "",
    is_recon: entry.is_recon,
    lines: entry.lines.map((l, idx) => ({
      key: l.id,
      account_id: l.account_id,
      debit: l.entry_side === "DEBIT" ? l.amount : 0,
      credit: l.entry_side === "CREDIT" ? l.amount : 0,
      memo: l.memo ?? "",
      sort_order: l.sort_order ?? (idx + 1) * 10,
    })),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function lineTotals(lines: FormLine[]) {
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    if (line.debit > 0) debit += line.debit;
    if (line.credit > 0) credit += line.credit;
  }
  const d = round2(debit);
  const c = round2(credit);
  return { debit: d, credit: c, diff: round2(d - c) };
}

/** Satu sisi per baris: mengisi debit mengosongkan kredit, dan sebaliknya. */
export function setLineAmount(lines: FormLine[], key: string, side: "debit" | "credit", value: number) {
  const amount = Number.isFinite(value) && value > 0 ? value : 0;
  const other = side === "debit" ? "credit" : "debit";
  return lines.map((l) => (l.key === key ? { ...l, [side]: amount, [other]: amount > 0 ? 0 : l[other] } : l));
}

/** Baris siap kirim, atau pesan galat pertama yang harus dibenahi user. */
export function journalPayloadLines(lines: FormLine[]): { lines: JournalEntryLinePayload[] } | { error: string } {
  const filled = lines.filter((l) => l.account_id && (l.debit > 0 || l.credit > 0));
  if (filled.length < 2) return { error: "Minimal 2 baris jurnal dengan akun dan amount" };
  const accountIds = filled.map((l) => l.account_id);
  if (new Set(accountIds).size !== accountIds.length) {
    return { error: "Satu akun tidak boleh dipakai lebih dari sekali" };
  }
  const totals = lineTotals(filled);
  if (totals.diff !== 0) return { error: `Jurnal belum balance (selisih ${formatLedgerAmount(Math.abs(totals.diff))})` };
  if (totals.debit <= 0 || totals.credit <= 0) return { error: "Harus ada minimal satu Debit dan satu Credit" };

  return {
    lines: filled.map((l, idx) => ({
      account_id: l.account_id,
      entry_side: l.debit > 0 ? "DEBIT" : "CREDIT",
      amount: l.debit > 0 ? l.debit : l.credit,
      memo: l.memo.trim() || null,
      sort_order: l.sort_order || (idx + 1) * 10,
    })),
  };
}
