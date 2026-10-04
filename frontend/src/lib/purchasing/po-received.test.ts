import { describe, expect, it } from "vitest";
import { resolveGrnItemReceivedQty } from "@/lib/purchasing/grn";
import { computePoShortageAmount } from "@/lib/purchasing/po-payments";
import { canTransition, normalizePOStatus } from "@/lib/purchasing/po";

describe("resolveGrnItemReceivedQty", () => {
  it("uses QC posted qty when inventory was posted", () => {
    expect(
      resolveGrnItemReceivedQty({
        qty_diterima: 10,
        qty_qc_posted: 7,
        grn_status: "received",
        inventory_posted: true,
      })
    ).toBe(7);
  });

  it("counts 0 while GRN is still pending QC", () => {
    expect(
      resolveGrnItemReceivedQty({
        qty_diterima: 10,
        qty_qc_posted: 0,
        grn_status: "pending",
        inventory_posted: false,
      })
    ).toBe(0);
  });

  it("uses door-accepted qty for finalized receives without QC (general)", () => {
    expect(
      resolveGrnItemReceivedQty({
        qty_diterima: 5,
        qty_qc_posted: 0,
        grn_status: "received",
        inventory_posted: false,
      })
    ).toBe(5);
  });
});

describe("computePoShortageAmount", () => {
  it("sums (ordered − received) × unit price", () => {
    expect(
      computePoShortageAmount([
        { qty_ordered: 25, qty_received: 17, harga_satuan: 1000 },
        { qty_ordered: 10, qty_received: 10, harga_satuan: 500 },
      ])
    ).toBe(8000);
  });

  it("ignores over-received lines", () => {
    expect(
      computePoShortageAmount([{ qty_ordered: 5, qty_received: 8, harga_satuan: 100 }])
    ).toBe(0);
  });
});

describe("PO status close transitions", () => {
  it("normalizes legacy partial alias", () => {
    expect(normalizePOStatus("partial")).toBe("partially_received");
  });

  it("allows closing a partially received PO", () => {
    expect(canTransition("partially_received", "closed")).toBe(true);
    expect(canTransition("partial", "closed")).toBe(true);
    expect(canTransition("sent", "closed")).toBe(false);
  });
});
