import { describe, expect, it } from "vitest";
import type { UserScope } from "@/lib/api/scope";
import { scopeSqlFilters, xlsxDownload } from "./export-scope";

const branchScope: UserScope = {
  userId: "u1",
  role: "admin",
  businessScope: "branch",
  holdingId: "h1",
  companyId: "c1",
  branchId: "b1",
  isUnscoped: false,
} as UserScope;

describe("scopeSqlFilters", () => {
  it("adds company and branch filters for a scoped user", () => {
    expect(scopeSqlFilters(branchScope, "rm")).toEqual({
      filters: ["rm.deleted_at IS NULL", "rm.company_id = $1", "rm.branch_id = $2"],
      params: ["c1", "b1"],
    });
  });

  it("only filters deleted rows for unscoped users", () => {
    expect(scopeSqlFilters(null, "s")).toEqual({ filters: ["s.deleted_at IS NULL"], params: [] });
  });
});

describe("xlsxDownload", () => {
  it("serves an attachment named after today", () => {
    const res = xlsxDownload(Buffer.from("x"), "suppliers");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="suppliers-\d{4}-\d{2}-\d{2}\.xlsx"$/);
  });
});
