import { describe, expect, it } from "vitest";
import { allowedToolNames, isToolAllowed } from "@/lib/assistant/tool-scope";

describe("allowedToolNames", () => {
  it("role penuh mendapat seluruh alat", () => {
    expect(allowedToolNames("super_admin", [])).toHaveLength(7);
    expect(allowedToolNames("admin", [])).toHaveLength(7);
  });

  it("kasir hanya dapat alat POS, bukan data karyawan", () => {
    const tools = allowedToolNames("pos", ["pos.operations.cashier", "pos.reports.dashboard"]);
    expect(tools).toContain("penjualan_periode");
    expect(tools).not.toContain("cari_karyawan");
    expect(tools).not.toContain("status_kandidat");
  });

  it("HR dapat alat kepegawaian & rekrutmen, bukan laporan penjualan", () => {
    const tools = allowedToolNames("hrd", ["hris.kepegawaian.users", "hris.recruitment.candidates"]);
    expect(tools).toContain("cari_karyawan");
    expect(tools).toContain("status_kandidat");
    expect(tools).not.toContain("penjualan_periode");
  });

  it("tanpa menu sama sekali → tidak ada alat (Do tetap bisa mengobrol umum)", () => {
    expect(allowedToolNames("staff", [])).toEqual([]);
  });

  it("prefiks harus cocok utuh, bukan sekadar awalan string", () => {
    expect(isToolAllowed("cari_karyawan", "staff", ["hrisx.kepegawaian"])).toBe(false);
    expect(isToolAllowed("cari_karyawan", "staff", ["hris.kepegawaian.users"])).toBe(true);
  });

  it("alat tak dikenal selalu ditolak", () => {
    expect(isToolAllowed("hapus_semua", "super_admin", [])).toBe(false);
  });
});
