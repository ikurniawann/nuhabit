import { describe, expect, it } from "vitest";
import { summarizePoDelivery, type PoDeliveryRow } from "@/lib/purchasing/po-queries";
import { attachPosSkus, groupBy } from "@/lib/purchasing/po-form-data";
import { holdsOnOrderQty, openQty } from "@/lib/purchasing/po-lifecycle";
import { remainingSchedulable } from "@/lib/purchasing/po-payment-terms";

const delivery = (overrides: Partial<PoDeliveryRow>): PoDeliveryRow => ({
  id: "d",
  nomor_resi: null,
  no_surat_jalan: null,
  status: "delivered",
  created_at: "2026-10-01T00:00:00Z",
  ...overrides,
});

describe("summarizePoDelivery", () => {
  it("prefers the open delivery, numbering from the latest when none is open", () => {
    expect(
      summarizePoDelivery([
        delivery({ id: "latest", status: "delivered", no_surat_jalan: "SJ-9" }),
        delivery({ id: "open", status: "in_transit", nomor_resi: "RESI-1" }),
      ])
    ).toEqual({ active_delivery_id: "open", active_delivery_number: "RESI-1", active_delivery_status: "in_transit" });

    expect(summarizePoDelivery([delivery({ id: "latest", no_surat_jalan: "SJ-9" })])).toEqual({
      active_delivery_id: null,
      active_delivery_number: "SJ-9",
      active_delivery_status: "delivered",
    });
  });

  it("returns nulls without deliveries", () => {
    expect(summarizePoDelivery([])).toEqual({
      active_delivery_id: null,
      active_delivery_number: null,
      active_delivery_status: null,
    });
  });
});

describe("PO form helpers", () => {
  it("groups rows and keeps order", () => {
    const groups = groupBy([{ k: "a", n: 1 }, { k: "b", n: 2 }, { k: "a", n: 3 }], (row) => row.k);
    expect(groups.get("a")?.map((row) => row.n)).toEqual([1, 3]);
  });

  it("attaches POS SKUs to merchandise products only", () => {
    const sku = { id: "sku-1", product_id: "pos-1", sku: "KAOS-M", name: "M" };
    expect(
      attachPosSkus([{ id: "p1" }, { id: "p2" }], [{ id: "pos-1", source_product_id: "p1" }], [sku])
    ).toEqual([
      { id: "p1", pos_skus: [sku] },
      { id: "p2", pos_skus: [] },
    ]);
  });
});

describe("PO on-order rules", () => {
  it("open qty never goes negative", () => {
    expect(openQty({ qty_ordered: "10", qty_received: "4" })).toBe(6);
    expect(openQty({ qty_ordered: 3, qty_received: 5 })).toBe(0);
  });

  it("only sent / partially received POs hold on-order qty", () => {
    expect(["sent", "partial", "partially_received"].every(holdsOnOrderQty)).toBe(true);
    expect(["draft", "approved", "received"].some(holdsOnOrderQty)).toBe(false);
  });

  it("schedulable amount subtracts active terms", () => {
    expect(remainingSchedulable(1_000_000, ["400000", 250_000, null])).toBe(350_000);
    expect(remainingSchedulable(100, [150])).toBe(0);
  });
});
