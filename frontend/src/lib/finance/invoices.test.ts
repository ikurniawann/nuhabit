import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock("@/lib/sales-funnel/access", () => ({ findAccessibleDeal: vi.fn() }));

const { invoicePaymentSummary } = await import("./invoices");

describe("invoicePaymentSummary", () => {
  it("lunas, sebagian, belum", () => {
    expect(invoicePaymentSummary(1000, 1000)).toEqual({ payment_status: "lunas", outstanding: 0 });
    expect(invoicePaymentSummary(1000, 250.555)).toEqual({ payment_status: "sebagian", outstanding: 749.45 });
    expect(invoicePaymentSummary(1000, 0)).toEqual({ payment_status: "belum", outstanding: 1000 });
  });

  it("nominal 0 tidak pernah lunas dan sisa tidak negatif", () => {
    expect(invoicePaymentSummary(0, 0)).toEqual({ payment_status: "belum", outstanding: 0 });
    expect(invoicePaymentSummary(100, 150)).toEqual({ payment_status: "lunas", outstanding: 0 });
  });
});
