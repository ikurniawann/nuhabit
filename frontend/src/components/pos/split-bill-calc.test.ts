import { describe, expect, it } from "vitest";

import {
  buildEqualSplits,
  buildPerItemSplits,
  countUnassignedQty,
  guestLabel,
  normalizeAssignments,
  resizeLabels,
} from "./split-bill-calc";

describe("guestLabel", () => {
  it("returns Guest N (1-based)", () => {
    expect(guestLabel(0)).toBe("Guest 1");
    expect(guestLabel(2)).toBe("Guest 3");
  });
});

describe("buildEqualSplits", () => {
  it("splits total with remainder on the last guest", () => {
    const splits = buildEqualSplits({
      count: 3,
      total: 100,
      taxAmount: 10,
      discountAmount: 0,
      labels: [],
    });

    expect(splits.map((s) => s.total)).toEqual([33, 33, 34]);
    expect(splits[0].label).toBe("Guest 1");
    expect(splits.reduce((sum, s) => sum + s.total, 0)).toBe(100);
  });

  it("uses custom labels when provided", () => {
    const splits = buildEqualSplits({
      count: 2,
      total: 50,
      taxAmount: 0,
      discountAmount: 0,
      labels: ["Alice", ""],
    });
    expect(splits[0].label).toBe("Alice");
    expect(splits[1].label).toBe("Guest 2");
  });
});

describe("buildPerItemSplits", () => {
  const items = [
    { id: "a", name: "Tea", productId: "p1", price: 10, quantity: 2 },
    { id: "b", name: "Cake", productId: "p2", price: 20, quantity: 1 },
  ];

  it("assigns subtotals and proportional tax", () => {
    const splits = buildPerItemSplits({
      count: 2,
      cartItems: items,
      assignments: {
        a: [2, 0],
        b: [0, 1],
      },
      taxAmount: 3,
      discountAmount: 0,
      labels: [],
    });

    expect(splits[0].subtotal).toBe(20);
    expect(splits[1].subtotal).toBe(20);
    expect(splits[0].tax + splits[1].tax).toBe(3);
  });
});

describe("countUnassignedQty", () => {
  it("counts remaining quantities", () => {
    expect(
      countUnassignedQty(
        [{ id: "a", quantity: 3 }],
        { a: [1, 1] }
      )
    ).toBe(1);
  });

  it("is zero when fully assigned", () => {
    expect(
      countUnassignedQty(
        [{ id: "a", quantity: 2 }],
        { a: [1, 1] }
      )
    ).toBe(0);
  });
});

describe("normalizeAssignments / resizeLabels", () => {
  it("menyesuaikan panjang, item belum dibagi jatuh ke tamu pertama", () => {
    const items = [
      { id: "a", quantity: 3 },
      { id: "b", quantity: 1 },
    ];
    expect(normalizeAssignments({}, items, 2)).toEqual({ a: [3, 0], b: [1, 0] });
    expect(normalizeAssignments({ a: [1, 1, 1], b: [0, 1] }, items, 2)).toEqual({ a: [1, 1], b: [0, 1] });
    expect(normalizeAssignments({ a: [0, 0, 3] }, items, 2)).toEqual({ a: [3, 0], b: [1, 0] });
    expect(resizeLabels(["Ana"], 3)).toEqual(["Ana", "", ""]);
    expect(resizeLabels(["Ana", "Budi", "Cici"], 2)).toEqual(["Ana", "Budi"]);
  });
});
