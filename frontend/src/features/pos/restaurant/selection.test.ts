import { describe, expect, it } from "vitest";

import {
  billSelection,
  tableSelection,
  isBillSelected,
  isTableSelected,
} from "./selection";

describe("restaurant selection model", () => {
  it("creates an occupied table selection with table and active order ids", () => {
    const selection = tableSelection("table-1", "order-1");

    expect(selection).toEqual({
      type: "table",
      tableId: "table-1",
      orderId: "order-1",
    });
    expect(isTableSelected(selection, "table-1")).toBe(true);
    expect(isBillSelected(selection, "order-1")).toBe(true);
  });

  it("creates a bill selection and does not select unrelated tables", () => {
    const selection = billSelection("order-2", "table-2");

    expect(selection).toEqual({
      type: "bill",
      orderId: "order-2",
      tableId: "table-2",
    });
    expect(isBillSelected(selection, "order-2")).toBe(true);
    expect(isTableSelected(selection, "table-1")).toBe(false);
  });
});
