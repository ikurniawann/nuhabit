import { describe, expect, it, vi } from "vitest";
import type { ParsedCoaRow } from "./coa-spreadsheet";

vi.mock("@/lib/db", () => ({ withTransaction: vi.fn() }));
vi.mock("@/lib/pg/create-client", () => ({ createServerPgClient: vi.fn() }));

const { buildCoaImportPreview, summarizeCoaImport } = await import("./coa-import");

function row(code: string, overrides: Partial<ParsedCoaRow> = {}): ParsedCoaRow {
  return {
    code,
    name: `Akun ${code}`,
    parent_code: null,
    account_type_code: "ASSET",
    level: 1,
    is_contra: false,
    is_cash_bank: false,
    cash_flow_category: null,
    description: null,
    source_row: 1,
    ...overrides,
  };
}

const typeMap = new Map([["ASSET", "type-asset"]]);

describe("buildCoaImportPreview", () => {
  it("klasifikasi create / update / skip / error", () => {
    const existing = new Map([
      ["1100", { id: "a", name: "Akun 1100" }],
      ["1200", { id: "b", name: "Nama lama" }],
    ]);
    const preview = buildCoaImportPreview(
      [
        row("1000"),
        row("1100"),
        row("1200"),
        row("1300", { account_type_code: "EXPENSE" }),
        row("1400", { parent_code: "9999" }),
        row("1500", { parent_code: "1000" }),
      ],
      typeMap,
      existing
    );
    expect(preview.map((p) => [p.code, p.action, p.message])).toEqual([
      ["1000", "create", undefined],
      ["1100", "skip", "Tidak berubah"],
      ["1200", "update", undefined],
      ["1300", "error", "Account type EXPENSE tidak ditemukan"],
      ["1400", "error", "Parent 9999 tidak ditemukan"],
      ["1500", "create", undefined],
    ]);
  });

  it("summary menghitung issue parsing sebagai error", () => {
    const preview = buildCoaImportPreview([row("1000")], typeMap, new Map());
    expect(summarizeCoaImport(preview, [{ row: 3, message: "Kode kosong" }])).toEqual({
      create: 1,
      update: 0,
      skip: 0,
      error: 1,
    });
  });
});
