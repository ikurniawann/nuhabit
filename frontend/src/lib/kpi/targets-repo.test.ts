import { describe, expect, it } from "vitest";
import { createTargetSchema } from "./targets-repo";

const firstMessage = (data: unknown) => {
  const parsed = createTargetSchema.safeParse(data);
  return parsed.success ? null : parsed.error.issues[0]?.message;
};

describe("createTargetSchema", () => {
  it("indikator dan target ≥ 0 wajib", () => {
    expect(firstMessage({ target: 5 })).toBe("indicator_id dan target (angka ≥ 0) wajib");
    expect(firstMessage({ indicator_id: "i", target: -1 })).toBe("indicator_id dan target (angka ≥ 0) wajib");
    expect(firstMessage({ indicator_id: "i", target: "abc" })).toBe("indicator_id dan target (angka ≥ 0) wajib");
  });

  it("periode opsional tapi harus valid", () => {
    expect(firstMessage({ indicator_id: "i", target: 1, period_month: 13 })).toBe("Periode tidak valid");
    expect(firstMessage({ indicator_id: "i", target: 1, period_year: 2026, period_month: null })).toBeNull();
  });

  it("maksimal satu scope", () => {
    expect(firstMessage({ indicator_id: "i", target: 1, role_code: "pos", department_id: "d" })).toBe(
      "Pilih satu scope saja (role ATAU department ATAU karyawan)"
    );
    expect(firstMessage({ indicator_id: "i", target: 1, role_code: "pos", department_id: "" })).toBeNull();
  });
});
