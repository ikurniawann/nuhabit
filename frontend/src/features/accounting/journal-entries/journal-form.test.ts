import { describe, expect, it } from "vitest";
import { journalPayloadLines, lineTotals, newLine, setLineAmount } from "./journal-form";

const line = (account: string, debit: number, credit: number) => newLine({ account_id: account, debit, credit });

describe("journal form", () => {
  it("total dibulatkan 2 desimal", () => {
    expect(lineTotals([line("a", 0.1, 0), line("b", 0.2, 0), line("c", 0, 0.3)])).toEqual({
      debit: 0.3,
      credit: 0.3,
      diff: 0,
    });
  });

  it("isi debit mengosongkan kredit pada baris yang sama", () => {
    const l = line("a", 0, 50);
    expect(setLineAmount([l], l.key, "debit", 20)[0]).toMatchObject({ debit: 20, credit: 0 });
  });

  it("validasi berurutan: minimal 2 baris, akun unik, balance", () => {
    expect(journalPayloadLines([line("a", 10, 0)])).toEqual({ error: "Minimal 2 baris jurnal dengan akun dan amount" });
    expect(journalPayloadLines([line("a", 10, 0), line("a", 0, 10)])).toEqual({
      error: "Satu akun tidak boleh dipakai lebih dari sekali",
    });
    expect(journalPayloadLines([line("a", 10, 0), line("b", 0, 7)])).toEqual({
      error: "Jurnal belum balance (selisih 3,00)",
    });
  });

  it("baris kosong diabaikan; payload memakai sisi terisi", () => {
    const result = journalPayloadLines([line("a", 10, 0), line("", 0, 0), { ...line("b", 0, 10), memo: " tunai " }]);
    expect(result).toEqual({
      lines: [
        { account_id: "a", entry_side: "DEBIT", amount: 10, memo: null, sort_order: 10 },
        { account_id: "b", entry_side: "CREDIT", amount: 10, memo: "tunai", sort_order: 10 },
      ],
    });
  });
});
