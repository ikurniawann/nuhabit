import { describe, expect, it } from "vitest";
import { buildGrnHeaderUpdate, hasReceivedQtyChange } from "./grn-update";

const NOW = "2026-10-04T00:00:00.000Z";

function item(overrides: Record<string, unknown> = {}) {
  return {
    raw_material_id: "rm-1",
    purchase_order_item_id: "poi-1",
    qty_diterima: 5,
    qty_ditolak: 0,
    kondisi: "baik" as const,
    ...overrides,
  };
}

describe("hasReceivedQtyChange", () => {
  it("compares against stored qty, treating numeric strings as numbers", () => {
    const stored = new Map([["poi-1", { qty_diterima: "5.0000" }]]);
    expect(hasReceivedQtyChange([item()], stored)).toBe(false);
    expect(hasReceivedQtyChange([item({ qty_diterima: 6 })], stored)).toBe(true);
    expect(hasReceivedQtyChange([item({ purchase_order_item_id: "poi-2" })], stored)).toBe(true);
  });
});

describe("buildGrnHeaderUpdate", () => {
  it("keeps only the given header fields when no items are sent", () => {
    expect(
      buildGrnHeaderUpdate({
        input: { status: "received", catatan: "" },
        userId: "u1",
        currentStatus: "pending",
        qtyChanged: false,
        now: NOW,
      })
    ).toEqual({ updated_by: "u1", updated_at: NOW, status: "received", catatan: "" });
  });

  it("recomputes totals and status from items", () => {
    const update = buildGrnHeaderUpdate({
      input: { status: "received", items: [item({ qty_diterima: 0, qty_ditolak: 3 })] },
      userId: "u1",
      currentStatus: "pending",
      qtyChanged: true,
      now: NOW,
    });
    expect(update).toMatchObject({ total_item_diterima: 0, total_item_ditolak: 3, status: "rejected" });
  });

  it("reopens QC (pending) when qty changes on a GRN that left pending", () => {
    const update = buildGrnHeaderUpdate({
      input: { items: [item({ qty_diterima: 0, qty_ditolak: 3 })] },
      userId: "u1",
      currentStatus: "received",
      qtyChanged: true,
      now: NOW,
    });
    expect(update.status).toBe("pending");
  });
});
