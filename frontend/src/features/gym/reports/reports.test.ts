import { describe, expect, it } from "vitest";
import { csvFilename, percent, tableCsv } from "./csv";
import { addDays, matchPreset, parseReportParams, presetRange, reportApiQuery, reportParamsToSearch, wibToday } from "./params";

describe("report params", () => {
  const today = "2026-10-20";

  it("knows today in WIB", () => {
    expect(wibToday(new Date("2026-10-20T18:30:00Z"))).toBe("2026-10-21");
    expect(wibToday(new Date("2026-10-20T16:59:00Z"))).toBe("2026-10-20");
  });

  it("builds preset ranges", () => {
    expect(presetRange("7d", today)).toEqual({ from: "2026-10-14", to: today });
    expect(presetRange("30d", today)).toEqual({ from: "2026-09-21", to: today });
    expect(presetRange("this_month", today)).toEqual({ from: "2026-10-01", to: today });
    expect(presetRange("last_month", "2026-03-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(matchPreset("2026-10-01", today, today)).toBe("this_month");
    expect(matchPreset("2026-10-02", today, today)).toBeNull();
  });

  it("defaults to the last 30 days and drops broken ranges", () => {
    expect(parseReportParams(new URLSearchParams(), today)).toEqual({ from: "2026-09-21", to: today, branch_id: "", tab: "kehadiran" });
    expect(parseReportParams(new URLSearchParams("from=2026-10-10&to=2026-10-01"), today).from).toBe("2026-09-21");
    expect(parseReportParams(new URLSearchParams("tab=bogus"), today).tab).toBe("kehadiran");
  });

  it("round-trips non-default values", () => {
    const search = "from=2026-10-01&to=2026-10-07&branch_id=b1&tab=pendapatan";
    const params = parseReportParams(new URLSearchParams(search), today);
    expect(reportParamsToSearch(params, today)).toBe(search);
    expect(reportParamsToSearch(parseReportParams(new URLSearchParams(), today), today)).toBe("");
    expect(reportApiQuery(params)).toBe("from=2026-10-01&to=2026-10-07&branch_id=b1");
  });
});

describe("report csv", () => {
  it("writes the screen columns with raw values", () => {
    const rows = [{ name: 'Engine "Builder"', fill: 0.5 }];
    const csv = tableCsv(rows, [
      { label: "Kelas", value: (r) => r.name },
      { label: "Terisi (%)", value: (r) => percent(r.fill) },
    ]);
    expect(csv).toBe('"Kelas","Terisi (%)"\n"Engine ""Builder""",50');
  });

  it("names files by table and range", () => {
    expect(csvFilename("kehadiran-harian", "2026-10-01", "2026-10-07")).toBe("laporan-gym-kehadiran-harian-2026-10-01-2026-10-07.csv");
    expect(percent(0.2254)).toBe(22.5);
  });
});
