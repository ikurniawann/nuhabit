import { describe, expect, it } from "vitest";
import {
  buildHourRangeContribution,
  buildRushHourReport,
  formatHourLabel,
  rushHourHeatIntensity,
} from "./rush-hour";

describe("formatHourLabel", () => {
  it("pads hour in 24h", () => {
    expect(formatHourLabel(8)).toBe("08:00");
    expect(formatHourLabel(14)).toBe("14:00");
  });
});

describe("buildRushHourReport", () => {
  it("aggregates hour and weekday, then picks peaks", () => {
    const report = buildRushHourReport([
      { hour: 12, dow: 6, transactions: 10, revenue: 1_000_000 },
      { hour: 12, dow: 7, transactions: 4, revenue: 200_000 },
      { hour: 19, dow: 6, transactions: 3, revenue: 900_000 },
    ]);

    expect(report.summary.transactions).toBe(17);
    expect(report.summary.revenue).toBe(2_100_000);
    expect(report.hourly[12]?.transactions).toBe(14);
    expect(report.hourly[12]?.average_ticket).toBe(Math.round((1_200_000 / 14) * 100) / 100);
    expect(report.peak_hour.hour).toBe(12);
    expect(report.peak_revenue_hour.hour).toBe(12);
    expect(report.peak_day.dow).toBe(6);
    expect(report.peak_day.dow_label).toBe("Sab");
  });

  it("ignores out-of-range buckets", () => {
    const report = buildRushHourReport([
      { hour: 25, dow: 1, transactions: 9, revenue: 1 },
      { hour: 10, dow: 0, transactions: 9, revenue: 1 },
    ]);
    expect(report.summary.transactions).toBe(0);
  });
});

describe("buildHourRangeContribution", () => {
  const report = buildRushHourReport([
    { hour: 8, dow: 1, transactions: 5, revenue: 500_000, quantity: 10 },
    { hour: 10, dow: 2, transactions: 10, revenue: 1_000_000, quantity: 30 },
    { hour: 12, dow: 3, transactions: 5, revenue: 500_000, quantity: 20 },
    { hour: 19, dow: 4, transactions: 20, revenue: 2_000_000, quantity: 40 },
  ]);

  it("menghitung kontribusi rentang jam berdasarkan amount & quantity", () => {
    const range = buildHourRangeContribution(report.hourly, report.summary, 7, 12);
    expect(range.label).toBe("07:00–12:00:59".replace("12:00:59", "12:00:59"));
    expect(range.transactions).toBe(20);
    expect(range.revenue).toBe(2_000_000);
    expect(range.quantity).toBe(60);
    // total revenue 4jt → 2jt = 50%; total qty 100 → 60 = 60%
    expect(range.share_revenue).toBe(50);
    expect(range.share_quantity).toBe(60);
    expect(range.share_transactions).toBe(50);
    expect(range.hours).toHaveLength(6); // jam 07..12
  });

  it("meng-clamp jam terbalik/di luar batas dan aman saat total nol", () => {
    const flipped = buildHourRangeContribution(report.hourly, report.summary, 12, 7);
    expect(flipped.from_hour).toBe(12);
    expect(flipped.to_hour).toBe(12);

    const empty = buildRushHourReport([]);
    const zero = buildHourRangeContribution(empty.hourly, empty.summary, 0, 23);
    expect(zero.share_revenue).toBe(0);
    expect(zero.share_quantity).toBe(0);
  });

  it("summary menyertakan total quantity", () => {
    expect(report.summary.quantity).toBe(100);
    expect(report.hourly[10]?.quantity).toBe(30);
  });
});

describe("rushHourHeatIntensity", () => {
  it("scales 0-1 from max", () => {
    expect(rushHourHeatIntensity(0, 10)).toBe(0);
    expect(rushHourHeatIntensity(5, 10)).toBe(0.5);
    expect(rushHourHeatIntensity(10, 0)).toBe(0);
  });
});
