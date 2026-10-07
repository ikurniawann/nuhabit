import { describe, expect, it } from "vitest";
import {
  bucketAging,
  computeInvoiceOutstanding,
  daysPastDue,
  resolvePaymentStatus,
} from "@/lib/accounting/ap-status";

describe("computeInvoiceOutstanding", () => {
  it("returns remaining balance rounded", () => {
    expect(computeInvoiceOutstanding(1000, 250)).toBe(750);
    expect(computeInvoiceOutstanding(100, 100)).toBe(0);
    expect(computeInvoiceOutstanding(50, 80)).toBe(0);
  });
});

describe("resolvePaymentStatus", () => {
  it("returns paid when fully allocated", () => {
    expect(
      resolvePaymentStatus({
        totalAmount: 1000,
        allocatedAmount: 1000,
        dueDate: "2026-01-01",
        today: "2026-08-12",
      })
    ).toBe("paid");
  });

  it("returns partial when some allocated and not past due", () => {
    expect(
      resolvePaymentStatus({
        totalAmount: 1000,
        allocatedAmount: 400,
        dueDate: "2026-12-01",
        today: "2026-08-12",
      })
    ).toBe("partial");
  });

  it("returns overdue when unpaid/partial past due", () => {
    expect(
      resolvePaymentStatus({
        totalAmount: 1000,
        allocatedAmount: 0,
        dueDate: "2026-01-01",
        today: "2026-08-12",
      })
    ).toBe("overdue");
    expect(
      resolvePaymentStatus({
        totalAmount: 1000,
        allocatedAmount: 100,
        dueDate: "2026-01-01",
        today: "2026-08-12",
      })
    ).toBe("overdue");
  });

  it("returns unpaid when nothing allocated and not due", () => {
    expect(
      resolvePaymentStatus({
        totalAmount: 1000,
        allocatedAmount: 0,
        dueDate: "2026-12-01",
        today: "2026-08-12",
      })
    ).toBe("unpaid");
  });
});

describe("bucketAging", () => {
  it("returns null when no outstanding", () => {
    expect(bucketAging(0, "2026-01-01", "2026-08-12")).toBeNull();
  });

  it("buckets by days past due", () => {
    expect(bucketAging(100, "2026-08-20", "2026-08-12")).toBe("current");
    expect(bucketAging(100, "2026-08-12", "2026-08-12")).toBe("current");
    expect(bucketAging(100, "2026-07-20", "2026-08-12")).toBe("1_30");
    expect(bucketAging(100, "2026-06-20", "2026-08-12")).toBe("31_60");
    expect(bucketAging(100, "2026-05-20", "2026-08-12")).toBe("61_90");
    expect(bucketAging(100, "2026-01-01", "2026-08-12")).toBe("90_plus");
  });
});

describe("daysPastDue", () => {
  it("computes day difference", () => {
    expect(daysPastDue("2026-08-01", "2026-08-12")).toBe(11);
    expect(daysPastDue("2026-08-20", "2026-08-12")).toBe(-8);
  });
});
