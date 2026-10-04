import { describe, expect, it } from "vitest";
import type { PurchaseOrderPaymentTerm, PurchaseOrderWithStats } from "@/types/purchasing";
import {
  defaultPaymentForm,
  localizeTermDescription,
  paymentKind,
  poDetailFigures,
  poFinancialBreakdown,
  receiptHref,
  termDisplayLabel,
  validatePaymentForm,
} from "./po-ui-detail";

const po = (fields: Partial<PurchaseOrderWithStats>) => fields as PurchaseOrderWithStats;

describe("poDetailFigures", () => {
  it("uses server figures when present", () => {
    const figures = poDetailFigures(
      po({
        payable_amount: 900,
        gross_payable_amount: 1000,
        return_credit_amount: 60,
        reject_credit_amount: 40,
        outstanding_amount: 400,
        fulfillment_progress_pct: 55,
        receipt_progress_pct: 80,
      })
    );
    expect(figures).toMatchObject({
      payableAmount: 900,
      grossPayableAmount: 1000,
      outstandingAmount: 400,
      overallProgress: 55,
      receiptProgress: 80,
    });
  });

  it("derives progress, gross payable and outstanding for older payloads", () => {
    const figures = poDetailFigures(
      po({
        grand_total: 1000,
        paid_amount: 1200,
        received_percentage: 40,
        order_progress_pct: 100,
        qc_progress_pct: 20,
        return_progress_pct: 0,
        return_credit_amount: 100,
      })
    );
    expect(figures.receiptProgress).toBe(40);
    expect(figures.overallProgress).toBe(40);
    expect(figures.payableAmount).toBe(1000);
    expect(figures.grossPayableAmount).toBe(1100);
    expect(figures.outstandingAmount).toBe(0);
  });
});

describe("poFinancialBreakdown", () => {
  it("computes from items when the header is still zero", () => {
    const result = poFinancialBreakdown({
      subtotal: 0,
      diskon_nominal: 100,
      ppn_persen: 11,
      items: [
        { qty_ordered: 2, harga_satuan: 500, subtotal: 0 },
        { qty_ordered: 1, harga_satuan: 300, subtotal: 300 },
      ],
    });
    expect(result).toEqual({ subtotal: 1300, discount: 100, ppnPercent: 11, ppnAmount: 132, total: 1332 });
  });

  it("prefers stored header totals", () => {
    expect(poFinancialBreakdown({ subtotal: 1000, ppn_persen: 11, ppn_nominal: 110, grand_total: 1110 }).total).toBe(
      1110
    );
  });
});

describe("payment terms", () => {
  const term = (fields: Partial<PurchaseOrderPaymentTerm>) => ({ term_no: 1, amount: 0, description: null, ...fields });

  it("localizes server-generated English descriptions", () => {
    expect(localizeTermDescription("Paid in full")).toBe("Lunas");
    expect(localizeTermDescription("Installment 2")).toBe("Cicilan 2");
    expect(localizeTermDescription("DP 30%")).toBe("DP 30%");
  });

  it("shows a full down payment as Lunas and empty descriptions as Cicilan N", () => {
    expect(termDisplayLabel(term({ description: "Down payment", amount: 1000 }), 1000)).toBe("Lunas");
    expect(termDisplayLabel(term({ description: "Down payment", amount: 300 }), 1000)).toBe("Uang Muka");
    expect(termDisplayLabel(term({ term_no: 3 }), 1000)).toBe("Cicilan 3");
  });

  it("defaults the payment form to the first unpaid term and the outstanding amount", () => {
    const form = defaultPaymentForm(
      [
        { id: "t1", status: "paid" },
        { id: "t2", status: "unpaid" },
      ],
      750,
      "2026-10-04"
    );
    expect(form).toMatchObject({ payment_term_id: "t2", amount: 750, payment_date: "2026-10-04", method: "bank_transfer" });
    expect(defaultPaymentForm([], 0, "2026-10-04").amount).toBeUndefined();
  });

  it("validates payment amount against the outstanding balance", () => {
    const base = defaultPaymentForm([], 500, "2026-10-04");
    expect(validatePaymentForm(base, 500)).toBeNull();
    expect(validatePaymentForm({ ...base, amount: 0 }, 500)).toMatch(/Masukkan tanggal/);
    expect(validatePaymentForm({ ...base, amount: 600 }, 500)).toBe(
      "Nominal pembayaran tidak boleh melebihi sisa tagihan (Rp500)"
    );
  });

  it("classifies full vs installment payments", () => {
    expect(paymentKind(undefined, 500)).toBeNull();
    expect(paymentKind(500, 500)).toBe("full");
    expect(paymentKind(200, 500)).toBe("installment");
  });
});

describe("receiptHref", () => {
  it("strips the bucket prefix and encodes each segment", () => {
    expect(receiptHref("purchasing-receipts/2026/nota 1.jpg")).toBe("/api/purchasing/receipts/2026/nota%201.jpg");
  });
});
