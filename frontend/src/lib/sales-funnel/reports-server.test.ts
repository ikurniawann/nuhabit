import { describe, expect, it } from "vitest";
import { dealScopeSql, resolveReportPeriod } from "./reports-server";
import { diffLeadChanges } from "./leads-server";
import { phoneSuffixes, timelineScopeSql } from "./timeline-server";
import { parseMonthParam } from "./forecast-server";

describe("resolveReportPeriod", () => {
  const now = new Date("2026-10-04T05:00:00Z");
  it("default 90 hari terakhir", () => {
    expect(resolveReportPeriod(null, null, now)).toEqual({ from: "2026-07-06", to: "2026-10-04" });
  });
  it("rentang terbalik ditukar, format salah diabaikan", () => {
    expect(resolveReportPeriod("2026-09-30", "2026-09-01", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolveReportPeriod("30/09/2026", "2026-10-01", now).from).toBe("2026-07-06");
  });
});

describe("dealScopeSql", () => {
  it("scope branch + sales mulai placeholder $3", () => {
    const scoped = dealScopeSql(
      { id: "u1", role: "sales" },
      { businessScope: "branch", companyId: "c1", branchId: "b1" } as never,
      3
    );
    expect(scoped.sql).toBe("AND d.company_id = $3 AND d.branch_id = $4 AND (d.owner_user_id = $5 OR d.owner_user_id IS NULL)");
    expect(scoped.params).toEqual(["c1", "b1", "u1"]);
  });
  it("super_admin tanpa scope = tanpa filter", () => {
    expect(dealScopeSql({ id: "u1", role: "super_admin" }, null, 1)).toEqual({ sql: "", params: [] });
  });
});

describe("diffLeadChanges", () => {
  it("hanya field yang berubah atau baru", () => {
    expect(
      diffLeadChanges({ status: "baru", city: "Bandung" }, { status: "qualified", city: "Bandung", notes: "x", org_name: undefined })
    ).toEqual({ status: { from: "baru", to: "qualified" }, notes: { from: undefined, to: "x" } });
  });
});

describe("timeline helpers", () => {
  it("member hanya task subjeknya", () => {
    expect(timelineScopeSql("member")).toEqual({
      leadWhere: "FALSE",
      dealWhere: "FALSE",
      taskExtra: "(a.subject_type = 'member' AND a.subject_id = $1)",
    });
    expect(timelineScopeSql("deal").dealWhere).toBe("d.id = $1");
  });
  it("cocokkan nomor pada 9 digit terakhir", () => {
    expect(phoneSuffixes(["0812-3456-7890", "+62 812 3456 7890", "123"])).toEqual(["234567890", "234567890"]);
  });
});

describe("parseMonthParam", () => {
  it("YYYY-MM valid, lainnya 400", () => {
    expect(parseMonthParam("2026-10")).toBe("2026-10");
    expect(() => parseMonthParam("10-2026")).toThrow("month: YYYY-MM");
    expect(parseMonthParam(null)).toMatch(/^\d{4}-\d{2}$/);
  });
});
