import { describe, expect, it } from "vitest";
import {
  enumerateReportPeriods,
  parsePaymentReportGranularity,
  paymentMethodKey,
  periodKeyFromWibDate,
} from "./payment-methods-report";

describe("enumerateReportPeriods", () => {
  it("fills every day in range including empty ones", () => {
    expect(enumerateReportPeriods("2026-08-01", "2026-08-03", "day")).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
  });

  it("fills months across year boundary", () => {
    expect(enumerateReportPeriods("2025-11-15", "2026-02-01", "month")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("fills years inclusively", () => {
    expect(enumerateReportPeriods("2024-06-01", "2026-01-01", "year")).toEqual([
      "2024",
      "2025",
      "2026",
    ]);
  });
});

describe("periodKeyFromWibDate", () => {
  it("maps day/month/year keys", () => {
    expect(periodKeyFromWibDate("2026-08-20", "day")).toBe("2026-08-20");
    expect(periodKeyFromWibDate("2026-08-20", "month")).toBe("2026-08");
    expect(periodKeyFromWibDate("2026-08-20", "year")).toBe("2026");
  });
});

describe("paymentMethodKey", () => {
  it("prefers catalog code and normalizes credit", () => {
    expect(
      paymentMethodKey({ payment_method: "cash", payment_method_code: "transfer_bca" })
    ).toBe("transfer_bca");
    expect(paymentMethodKey({ payment_method: "credit" })).toBe("credit_card");
    expect(paymentMethodKey({})).toBe("unknown");
  });
});

describe("parsePaymentReportGranularity", () => {
  it("defaults to day", () => {
    expect(parsePaymentReportGranularity(null)).toBe("day");
    expect(parsePaymentReportGranularity("month")).toBe("month");
  });
});
