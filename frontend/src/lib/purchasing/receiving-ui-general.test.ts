import { describe, expect, it } from "vitest";
import { buildGeneralGrnItems, buildGeneralReceiveLines, totalGeneralReceived } from "./receiving-ui-general";

const lines = buildGeneralReceiveLines([
  { id: "poi-1", supply_item_id: "s-1", satuan_id: "u-1", qty_ordered: 10, qty_received: 4, supply_item: { kode: "ATK-1", nama: "Kertas", stockable: true } },
  { id: "poi-2", supply_item_id: "s-2", qty_ordered: "3", qty_received: "3" },
  { id: "poi-3", supply_item_id: null, qty_ordered: 1 },
]);

describe("buildGeneralReceiveLines", () => {
  it("skips items without a supply item and defaults qty to the remaining", () => {
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kode: "ATK-1", stockable: true, remaining: 6, qtyDiterima: "6", satuanId: "u-1" });
    expect(lines[1]).toMatchObject({ nama: "Item", remaining: 0, qtyDiterima: "0" });
    expect(totalGeneralReceived(lines)).toBe(6);
  });
});

describe("buildGeneralGrnItems", () => {
  it("sends only lines with qty", () => {
    expect(buildGeneralGrnItems(lines)).toEqual({
      items: [{ purchase_order_item_id: "poi-1", supply_item_id: "s-1", satuan_id: "u-1", qty_diterima: 6, qty_ditolak: 0 }],
    });
  });
  it("rejects qty above the remaining and an empty receipt", () => {
    expect(buildGeneralGrnItems([{ ...lines[0], qtyDiterima: "7" }])).toEqual({ error: "Qty Kertas melebihi sisa PO (maks 6)" });
    expect(buildGeneralGrnItems([{ ...lines[0], qtyDiterima: "" }])).toEqual({ error: "Isi minimal satu qty diterima" });
  });
});
