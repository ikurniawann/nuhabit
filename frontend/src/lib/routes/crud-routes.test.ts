import { describe, expect, it } from "vitest";
import { crudDetailPath, crudEditPath, crudInsertPath } from "@/lib/routes/crud-routes";

describe("crud-routes", () => {
  it("builds insert and edit paths", () => {
    const base = "/dashboard/employees";
    expect(crudInsertPath(base)).toBe("/dashboard/employees/insert");
    expect(crudEditPath(base, "abc")).toBe("/dashboard/employees/edit/abc");
    expect(crudDetailPath(base, "abc")).toBe("/dashboard/employees/abc");
  });
});
