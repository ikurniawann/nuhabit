import { describe, expect, it } from "vitest";
import { firstFormErrorMessage, prLineSubtotal, prLinesTotal } from "./pr-ui-form";

describe("firstFormErrorMessage", () => {
  it("returns a top-level message", () => {
    expect(firstFormErrorMessage({ department_id: { message: "Departemen wajib diisi" } })).toBe(
      "Departemen wajib diisi"
    );
  });
  it("walks into field arrays", () => {
    const errors = { items: [undefined, { qty: { message: "Qty minimal 1" } }] };
    expect(firstFormErrorMessage(errors)).toBe("Qty minimal 1");
  });
  it("returns null when nothing has a message", () => {
    expect(firstFormErrorMessage({ items: [{}] })).toBeNull();
    expect(firstFormErrorMessage(null)).toBeNull();
  });
});

describe("PR line totals", () => {
  it("multiplies qty by estimated price, treating blanks as 0", () => {
    expect(prLineSubtotal({ qty: 3, estimated_price: 2500 })).toBe(7500);
    expect(prLineSubtotal({ qty: 3 })).toBe(0);
    expect(prLineSubtotal(undefined)).toBe(0);
  });
  it("sums all lines", () => {
    expect(prLinesTotal([{ qty: 2, estimated_price: 1000 }, { qty: 1, estimated_price: 500 }])).toBe(2500);
    expect(prLinesTotal(undefined)).toBe(0);
  });
});
