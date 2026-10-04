import { describe, expect, it } from "vitest";
import { buildOrgTree } from "./org-chart";

describe("buildOrgTree", () => {
  it("menyusun bawahan di bawah atasan dalam kelompok", () => {
    const roots = buildOrgTree([
      { id: "a", full_name: "Ani" },
      { id: "b", full_name: "Budi", reporting_to: "a" },
      { id: "c", full_name: "Citra", reporting_to: "b" },
    ]);
    expect(roots.map((r) => r.id)).toEqual(["a"]);
    expect(roots[0].direct_reports[0].direct_reports[0].full_name).toBe("Citra");
  });

  it("menjadikan akar karyawan yang atasannya di luar kelompok", () => {
    const roots = buildOrgTree([
      { id: "b", full_name: "Budi", reporting_to: "x" },
      { id: "d", full_name: "Dewi", reporting_to: null },
    ]);
    expect(roots.map((r) => r.id)).toEqual(["b", "d"]);
  });
});
