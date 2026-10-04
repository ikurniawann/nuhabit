import { describe, expect, it } from "vitest";
import { pageMeta } from "@/lib/purchasing/vendor-directory";
import { toPurchaseInvoice, type InvoicePoRow } from "@/lib/purchasing/vendor-invoices";
import { pickPriceListUnit } from "@/lib/purchasing/vendor-price-list";

describe("pageMeta", () => {
  it("always reports at least one page", () => {
    expect(pageMeta(1, 10, 0)).toEqual({ page: 1, limit: 10, total: 0, total_pages: 1 });
    expect(pageMeta(2, 10, 21).total_pages).toBe(3);
  });
});

describe("pickPriceListUnit", () => {
  it("defaults to the product base unit and rejects a different unit", () => {
    expect(pickPriceListUnit("u-base", undefined)).toBe("u-base");
    expect(pickPriceListUnit(null, "u-any")).toBe("u-any");
    expect(() => pickPriceListUnit("u-base", "u-other")).toThrow("Unit must match the product base unit");
    expect(() => pickPriceListUnit(null, undefined)).toThrow("Product unit is not configured");
  });
});

describe("toPurchaseInvoice", () => {
  const row: InvoicePoRow = {
    id: "po-1",
    nomor_po: "PO-1",
    tanggal_po: "2026-09-01",
    status: "received",
    nama_supplier: null,
    vendor_name: "PT Vendor",
    payable_amount: "1000000",
    paid_amount: "250000",
    payment_term_count: "2",
    next_due_date: null,
    received_percentage: "100",
  };

  it("nets credits and payments and names the vendor for product POs", () => {
    expect(toPurchaseInvoice(row, "product", { returnCredit: 100_000, rejectCredit: 50_000 })).toMatchObject({
      purchase_order_id: "po-1",
      nama_supplier: "PT Vendor",
      po_status: "received",
      total_credit_amount: 150_000,
      payable_amount: 850_000,
      outstanding_amount: 600_000,
      payment_status: "partial",
      payment_term_count: 2,
      received_percentage: 100,
      can_pay: true,
    });
  });

  it("uses the supplier name for raw-material POs", () => {
    expect(
      toPurchaseInvoice({ ...row, nama_supplier: "CV Supplier" }, "raw_material", { returnCredit: 0, rejectCredit: 0 })
        .nama_supplier
    ).toBe("CV Supplier");
  });
});
