import { describe, expect, it } from "vitest";
import type { DayRevenue, MonthRow } from "./api";
import { branchSeries, changeLabel, csvFilename, fileSize, monthColumns, monthLabel, percent, streamSeries, tableCsv } from "./format";

const day = (d: string, streams: Partial<DayRevenue["streams"]>, branches: Record<string, number>): DayRevenue => ({
  day: d,
  total: Object.values(streams).reduce((a, b) => a + (b ?? 0), 0),
  streams: { packages: 0, passes: 0, pt: 0, pos: 0, ...streams },
  branches,
});

describe("format investor", () => {
  it("menamai bulan dalam bahasa Indonesia", () => {
    expect(monthLabel("2031-03")).toBe("Mar 2031");
    expect(monthLabel("2031-12")).toBe("Des 2031");
    expect(monthLabel("rusak")).toBe("rusak");
  });

  it("menulis perubahan relatif dengan tanda dan satu desimal", () => {
    expect(changeLabel(0.125)).toBe("+12,5%");
    expect(changeLabel(-0.03)).toBe("-3,0%");
    expect(changeLabel(0)).toBe("0,0%");
    expect(changeLabel(null)).toBeNull();
    expect(percent(0.225)).toBe(22.5);
  });

  it("menyusun seri stream dan cabang per hari", () => {
    const daily = [
      day("2031-03-01", { packages: 1_000_000, pos: 50_000 }, { b1: 1_050_000 }),
      day("2031-03-02", { passes: 500_000 }, { b2: 400_000, "": 100_000 }),
    ];
    const streams = streamSeries(daily);
    expect(streams[0]).toEqual({ day: "2031-03-01", total: 1_050_000, packages: 1_000_000, passes: 0, pt: 0, pos: 50_000 });
    const branches = branchSeries(daily, { b1: "Kemang", b2: "Senopati" });
    expect(branches.keys).toEqual(["Kemang", "Senopati", "Tanpa cabang"]);
    expect(branches.points[0]).toEqual({ day: "2031-03-01", Kemang: 1_050_000, Senopati: 0, "Tanpa cabang": 0 });
    expect(branches.points[1]).toEqual({ day: "2031-03-02", Kemang: 0, Senopati: 400_000, "Tanpa cabang": 100_000 });
  });

  it("mengekspor baris bulanan ke CSV dengan angka mentah", () => {
    const row: MonthRow = {
      month: "2031-03",
      revenue: { total: 2_550_000, streams: { packages: 1_000_000, passes: 500_000, pt: 800_000, pos: 250_000 } },
      accounting: { revenue: 2_000_000, cogs: 500_000, gross_profit: 1_500_000, gross_margin: 0.75, expenses: 300_000, operating_income: 1_200_000, net_income: 1_200_000 },
      members: { new: 2, active: 1, retained: 0, retention_rate: 0 },
      classes: { sessions: 2, checked_in: 2, avg_fill: 0.225 },
      pt_sessions: 2,
    };
    const columns = monthColumns(
      (v) => `Rp ${v}`,
      (r) => (r === null ? "-" : `${percent(r)}%`)
    );
    const csv = tableCsv([row, { ...row, month: "2031-04", accounting: null }], columns);
    const [header, first, second] = csv.trim().split("\n");
    expect(header).toContain("Bulan");
    expect(header).toContain("Margin kotor");
    expect(first).toContain("2031-03");
    expect(first).toContain("2550000");
    expect(first).toContain("0.75");
    expect(second).toContain("2031-04");
    expect(columns.find((c) => c.label === "Margin kotor")?.render?.({ ...row, accounting: null })).toBe("-");
    expect(csvFilename("kinerja", "2031-01-01", "2031-03-31")).toBe("investor-kinerja-2031-01-01-2031-03-31.csv");
  });

  it("meringkas ukuran berkas", () => {
    expect(fileSize(512)).toBe("512 B");
    expect(fileSize(320 * 1024)).toBe("320 KB");
    expect(fileSize(1.5 * 1024 * 1024)).toBe("1,5 MB");
  });
});
