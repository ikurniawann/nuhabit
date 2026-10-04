import { describe, expect, it } from "vitest";
import type { CoaAccountItem } from "@/features/accounting/chart-of-accounts/types";
import { balanceTotals, buildRows, buildSaveLines, filterRows, setRowAmount, type BalanceRow } from "./balance-rows";

function account(id: string, code: string, type: string, extra: Partial<CoaAccountItem> = {}): CoaAccountItem {
  return {
    id,
    code,
    code_display: code,
    name: `Akun ${code}`,
    account_type_code: type,
    normal_balance: "DEBIT",
    is_postable: true,
    is_active: true,
    is_cash_bank: false,
    ...extra,
  } as CoaAccountItem;
}

function row(id: string, debit: number, credit: number, isCash = true): BalanceRow {
  return {
    account_id: id,
    code: id,
    name: id,
    account_type_code: "ASSET",
    normal_balance: "DEBIT",
    is_cash_bank: isCash,
    debit,
    credit,
    source: null,
  };
}

describe("buildRows", () => {
  it("hanya akun neraca postable & aktif, urut kode, saran cocok via id atau kode", () => {
    const rows = buildRows(
      [
        account("b", "1-200", "ASSET"),
        account("a", "1-100", "ASSET", { is_cash_bank: true }),
        account("r", "4-100", "REVENUE"),
        account("h", "1-000", "ASSET", { is_postable: false }),
      ],
      [
        { account_id: "a", entry_side: "DEBIT", amount: 500, source: "PRIOR_BS" },
        { account_id: "x", account_code: "1200", entry_side: "CREDIT", amount: 80, source: "MANUAL" },
      ]
    );
    expect(rows.map((r) => [r.account_id, r.debit, r.credit, r.source])).toEqual([
      ["a", 500, 0, "PRIOR_BS"],
      ["b", 0, 80, "MANUAL"],
    ]);
  });
});

describe("setRowAmount", () => {
  it("mengisi satu sisi mengosongkan sisi lain dan menandai MANUAL", () => {
    const [next] = setRowAmount([row("a", 0, 100)], "a", "debit", 40);
    expect([next.debit, next.credit, next.source]).toEqual([40, 0, "MANUAL"]);
    const [cleared] = setRowAmount([row("a", 0, 100)], "a", "debit", 0);
    expect([cleared.debit, cleared.credit]).toEqual([0, 100]);
  });
});

describe("balanceTotals & filterRows", () => {
  it("total dibulatkan 2 desimal", () => {
    expect(balanceTotals([row("a", 0.1, 0), row("b", 0.2, 0), row("c", 0, 0.3)])).toEqual({
      debit: 0.3,
      credit: 0.3,
      diff: 0,
      filled: 3,
    });
  });

  it("mode kas hanya baris kas, cari kode/nama", () => {
    const rows = [row("kas", 1, 0), row("piutang", 1, 0, false)];
    expect(filterRows(rows, "cash_bank", "").map((r) => r.account_id)).toEqual(["kas"]);
    expect(filterRows(rows, "all", "PIUT").map((r) => r.account_id)).toEqual(["piutang"]);
  });
});

describe("buildSaveLines", () => {
  it("mode kas: selisih diseimbangkan ke Retained Earnings", () => {
    const result = buildSaveLines([row("kas", 1000, 0), row("re", 0, 50, false)], "cash_bank", "re");
    expect(result).toEqual({
      lines: [
        { account_id: "kas", entry_side: "DEBIT", amount: 1000 },
        { account_id: "re", entry_side: "CREDIT", amount: 1000 },
      ],
    });
  });

  it("mode kas tanpa RE dan ada selisih → galat", () => {
    expect(buildSaveLines([row("kas", 1000, 0)], "cash_bank", null)).toEqual({
      error: "Butuh akun Retained Earnings / Laba Ditahan untuk menyeimbangkan Kas & Bank",
    });
  });

  it("mode semua: wajib 2 akun dan balance", () => {
    expect(buildSaveLines([row("a", 10, 0)], "all", null)).toEqual({ error: "Minimal 2 akun dengan saldo > 0" });
    expect(buildSaveLines([row("a", 10, 0), row("b", 0, 4)], "all", null)).toEqual({
      error: "Belum balance (selisih 6,00)",
    });
    expect("lines" in buildSaveLines([row("a", 10, 0), row("b", 0, 10)], "all", null)).toBe(true);
  });
});
