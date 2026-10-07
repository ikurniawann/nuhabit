import { describe, expect, it } from "vitest";
import { sortWarehouses } from "./sort-warehouses";

describe("sortWarehouses", () => {
  it("does not throw when code or name is missing", () => {
    const rows = [
      { is_default: false, code: null as unknown as string, name: null as unknown as string },
      { is_default: true, code: "WH-01", name: "Operasional" },
      { is_default: false, code: "STALL-02", name: "Yakitori" },
    ];
    expect(() => sortWarehouses(rows)).not.toThrow();
    expect(sortWarehouses(rows)[0].code).toBe("WH-01");
  });
});
