import { describe, expect, it } from "vitest";
import {
  buildReceiptItemLines,
  groupCartItemsByStallName,
  receiptDocumentLabel,
} from "./receipt-layout";

describe("groupCartItemsByStallName", () => {
  it("groups items under warehouse_name and keeps stall order", () => {
    const groups = groupCartItemsByStallName([
      { name: "Americano", warehouse_id: "w-a", warehouse_name: "Kopi Nusantara" },
      { name: "Croissant", warehouse_id: "w-b", warehouse_name: "Bakery" },
      { name: "Latte", warehouse_id: "w-a", warehouse_name: "Kopi Nusantara" },
    ]);
    expect(groups.map((group) => group.stallName)).toEqual(["Kopi Nusantara", "Bakery"]);
    expect(groups[0]?.items.map((item) => item.name)).toEqual(["Americano", "Latte"]);
    expect(groups[1]?.items.map((item) => item.name)).toEqual(["Croissant"]);
  });

  it("falls back to Stall when warehouse_name is missing", () => {
    const groups = groupCartItemsByStallName([
      { name: "Item", warehouse_id: "w-a" },
    ]);
    expect(groups[0]?.stallName).toBe("Stall");
  });

  it("keeps separate sections when names are missing but stall ids differ", () => {
    const groups = groupCartItemsByStallName([
      { name: "A", warehouse_id: "w-a" },
      { name: "B", warehouse_id: "w-b" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.items.map((item) => item.name)).toEqual(["A"]);
    expect(groups[1]?.items.map((item) => item.name)).toEqual(["B"]);
  });
});

describe("receiptDocumentLabel", () => {
  it("prefers full checkout_number over sliced order number", () => {
    expect(
      receiptDocumentLabel({
        checkoutNumber: "CHK-20260815-0001",
        orderNumber: "POS-999",
        orderId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      })
    ).toBe("Checkout #CHK-20260815-0001");
  });

  it("keeps Order # for a single-stall sale", () => {
    expect(
      receiptDocumentLabel({
        orderNumber: "POS-12345678",
        orderId: "ord-1",
      })
    ).toBe("Order #12345678");
  });
});

describe("buildReceiptItemLines", () => {
  it("cart campuran: tanpa header '--- Stall ---', cukup label [Stall] per item", () => {
    const lines = buildReceiptItemLines([
      { name: "Americano", quantity: 1, warehouse_name: "Kopi Nusantara" },
      { name: "Croissant", quantity: 2, warehouse_name: "Bakery" },
    ]);
    expect(lines.map((line) => line.text)).toEqual([
      "1x Americano",
      "  [Kopi Nusantara]",
      "2x Croissant",
      "  [Bakery]",
    ]);
  });

  it("label [Stall] disembunyikan bila sama dengan stall di header struk", () => {
    const lines = buildReceiptItemLines(
      [
        { name: "Americano", quantity: 1, warehouse_name: "Kopi Nusantara" },
        { name: "Latte", quantity: 1, warehouse_name: "Kopi Nusantara" },
      ],
      { headerStallName: "Kopi Nusantara" }
    );
    expect(lines.map((line) => line.text)).toEqual(["1x Americano", "1x Latte"]);
  });
});

