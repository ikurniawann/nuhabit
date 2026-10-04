import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), queryOne: vi.fn(), withTransaction: vi.fn() }));

const { shiftPatternSchema } = await import("./employees-shifts");

const week = (shift: string | null = null) =>
  [1, 2, 3, 4, 5, 6, 7].map((day_of_week) => ({ day_of_week, shift_id: shift }));

describe("shiftPatternSchema", () => {
  it("pola 7 hari lengkap lolos", () => {
    expect(shiftPatternSchema.safeParse({ effective_from: "2026-10-05", days: week() }).success).toBe(true);
  });

  it.each([
    ["tanggal kosong", { days: week() }, "Tanggal mulai berlaku wajib diisi (YYYY-MM-DD)"],
    ["hari kurang", { effective_from: "2026-10-05", days: week().slice(1) }, "Pola jadwal harus lengkap 7 hari (Senin–Minggu)"],
    [
      "hari dobel",
      { effective_from: "2026-10-05", days: [...week().slice(1), { day_of_week: 2, shift_id: null }] },
      "Pola jadwal harus lengkap 7 hari (Senin–Minggu)",
    ],
    ["shift bukan UUID", { effective_from: "2026-10-05", days: week("pagi") }, "ID shift tidak valid"],
  ])("%s ditolak", (_name, body, message) => {
    const parsed = shiftPatternSchema.safeParse(body);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].message).toBe(message);
  });
});
