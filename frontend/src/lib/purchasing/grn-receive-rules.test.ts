import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/auth";
import {
  findPoItemForLine,
  grnCreatedMessage,
  grnLineKey,
  normalizeQcOnItem,
  remainingPoQty,
  resolveInitialGrnStatus,
  statusFromLines,
  validateAdditionalReceive,
  validateReceiveLines,
  type PoItemForReceive,
} from "./grn-receive-rules";

const poItems: PoItemForReceive[] = [
  { id: "poi-rm", raw_material_id: "rm-1", qty_ordered: 10, qty_received: 4, raw_material: { nama: "Gula" } },
  { id: "poi-p1", product_id: "prod-1", pos_sku_id: "sku-1", qty_ordered: 5, qty_received: 0 },
  { id: "poi-p2", product_id: "prod-1", pos_sku_id: "sku-2", qty_ordered: 5, qty_received: 0 },
  { id: "poi-sup", supply_item_id: "sup-1", qty_ordered: "3", qty_received: null },
];

function line(overrides: Record<string, unknown>) {
  return { qty_diterima: 0, qty_ditolak: 0, ...overrides };
}

describe("grnLineKey", () => {
  it("prefers the PO line, then the item id", () => {
    expect(grnLineKey({ purchase_order_item_id: "poi", raw_material_id: "rm" })).toBe("poi");
    expect(grnLineKey({ product_id: "p" })).toBe("p");
    expect(grnLineKey({ supply_item_id: "s" })).toBe("s");
    expect(grnLineKey({})).toBe("");
  });
});

describe("normalizeQcOnItem", () => {
  it("defaults accepted to received and rejected to the remainder", () => {
    expect(normalizeQcOnItem({ qty_diterima: 5 })).toMatchObject({ qty_accepted: 5, qty_rejected: 0 });
    expect(normalizeQcOnItem({ qty_diterima: 5, qty_accepted: 3 })).toMatchObject({
      qty_accepted: 3,
      qty_rejected: 2,
    });
    expect(normalizeQcOnItem({ qty_diterima: 5, qty_accepted: 3, qty_rejected: 1 })).toMatchObject({
      qty_accepted: 3,
      qty_rejected: 1,
    });
  });
});

describe("remainingPoQty", () => {
  it("never goes below zero and accepts numeric strings", () => {
    expect(remainingPoQty(poItems[0])).toBe(6);
    expect(remainingPoQty(poItems[3])).toBe(3);
    expect(remainingPoQty({ id: "x", qty_ordered: 1, qty_received: 4 })).toBe(0);
  });
});

describe("findPoItemForLine", () => {
  it("matches by PO line, raw material or supply item", () => {
    expect(findPoItemForLine({ purchase_order_item_id: "poi-p2" }, poItems).id).toBe("poi-p2");
    expect(findPoItemForLine({ raw_material_id: "rm-1" }, poItems).id).toBe("poi-rm");
    expect(findPoItemForLine({ supply_item_id: "sup-1" }, poItems).id).toBe("poi-sup");
  });

  it("rejects an ambiguous variant product without a PO line", () => {
    expect(() => findPoItemForLine({ product_id: "prod-1" }, poItems)).toThrow(
      "Item PO ber-varian harus dirujuk lewat purchase_order_item_id"
    );
  });

  it("throws a 400 when nothing matches", () => {
    try {
      findPoItemForLine({ raw_material_id: "missing" }, poItems);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
    }
  });
});

describe("validateReceiveLines", () => {
  it("returns the PO line SKU for product lines and null otherwise", () => {
    const skus = validateReceiveLines(
      [
        line({ raw_material_id: "rm-1", qty_diterima: 6 }),
        line({ purchase_order_item_id: "poi-p2", product_id: "prod-1", qty_diterima: 5 }),
      ],
      poItems
    );
    expect(skus).toEqual([null, "sku-2"]);
  });

  it("sums received + rejected across lines that share a PO line", () => {
    expect(() =>
      validateReceiveLines(
        [
          line({ raw_material_id: "rm-1", qty_diterima: 4 }),
          line({ raw_material_id: "rm-1", qty_diterima: 2, qty_ditolak: 1 }),
        ],
        poItems
      )
    ).toThrow("Qty Gula melebihi sisa PO. Maksimal 6, tetapi diinput 7 (diterima + ditolak).");
  });

  it("rejects a SKU that differs from the PO line", () => {
    expect(() =>
      validateReceiveLines(
        [line({ purchase_order_item_id: "poi-p1", product_id: "prod-1", pos_sku_id: "sku-2", qty_diterima: 1 })],
        poItems
      )
    ).toThrow(ApiError);
  });
});

describe("validateAdditionalReceive", () => {
  it("only checks the increase over what was already stored", () => {
    const existing = new Map([["poi-rm", { qty_diterima: "4", qty_ditolak: 0 }]]);
    expect(() =>
      validateAdditionalReceive(
        [{ purchase_order_item_id: "poi-rm", raw_material_id: "rm-1", qty_diterima: 10, qty_ditolak: 0 }],
        poItems,
        existing
      )
    ).not.toThrow();
    expect(() =>
      validateAdditionalReceive(
        [{ purchase_order_item_id: "poi-rm", raw_material_id: "rm-1", qty_diterima: 10.5, qty_ditolak: 0 }],
        poItems,
        existing
      )
    ).toThrow("Maksimal 6 untuk penerimaan tambahan, tetapi diinput 6,5");
  });
});

describe("statusFromLines", () => {
  it("rejected when nothing was accepted but something was refused", () => {
    expect(statusFromLines([{ qty_diterima: 0, qty_ditolak: 2 }])).toBe("rejected");
  });
  it("pending when anything was received", () => {
    expect(statusFromLines([{ qty_diterima: 1, qty_ditolak: 2 }])).toBe("pending");
  });
  it("undefined when every line is zero", () => {
    expect(statusFromLines([{ qty_diterima: 0, qty_ditolak: 0 }])).toBeUndefined();
  });
});

describe("resolveInitialGrnStatus", () => {
  it("general is received immediately, RM/product wait for QC", () => {
    const totals = { total_diterima: 3, total_ditolak: 0 };
    expect(resolveInitialGrnStatus("general", totals)).toBe("received");
    expect(resolveInitialGrnStatus("raw_material", totals)).toBe("pending");
    expect(resolveInitialGrnStatus("product", totals)).toBe("pending");
  });
  it("all rejected at the door is rejected for every module", () => {
    expect(resolveInitialGrnStatus("general", { total_diterima: 0, total_ditolak: 2 })).toBe("rejected");
  });
});

describe("grnCreatedMessage", () => {
  it("describes the outcome and appends the accounting note", () => {
    expect(
      grnCreatedMessage({ grnNumber: "GRN-1", status: "rejected", moduleType: "raw_material", accountingNote: null })
    ).toBe("GRN GRN-1 berhasil dibuat — semua item ditolak");
    expect(
      grnCreatedMessage({ grnNumber: "GRN-1", status: "received", moduleType: "general", accountingNote: "jurnal" })
    ).toBe("GRN GRN-1 berhasil dibuat (jurnal)");
    expect(
      grnCreatedMessage({ grnNumber: "GRN-1", status: "received", moduleType: "product", accountingNote: null })
    ).toBe("GRN GRN-1 berhasil dibuat — QC selesai dan stok sudah diperbarui");
  });
});
