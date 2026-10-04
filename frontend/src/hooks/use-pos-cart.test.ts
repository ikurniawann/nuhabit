import { describe, expect, it } from "vitest";
import {
  DEFAULT_CART_STATE,
  cartReducer,
  lineDiscountAmount,
  lineGross,
  type PosCartItem,
} from "./use-pos-cart";

const item = (overrides: Partial<PosCartItem> = {}): PosCartItem => ({
  id: "p1",
  productId: "p1",
  name: "Kopi",
  price: 20_000,
  quantity: 1,
  ...overrides,
});

describe("cartReducer", () => {
  it("merges the same product, variant and modifiers into one line", () => {
    let state = cartReducer(DEFAULT_CART_STATE, { type: "ADD_ITEM", item: item({ notes: "panas" }) });
    state = cartReducer(state, { type: "ADD_ITEM", item: item({ id: "dup", quantity: 2 }) });
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ id: "p1", quantity: 3, notes: "panas" });
  });

  it("keeps different variants on separate lines", () => {
    let state = cartReducer(DEFAULT_CART_STATE, { type: "ADD_ITEM", item: item({ variantName: "M" }) });
    state = cartReducer(state, { type: "ADD_ITEM", item: item({ id: "p1-L", variantName: "L" }) });
    expect(state.items).toHaveLength(2);
  });

  it("removes a line when its quantity drops to zero", () => {
    let state = cartReducer(DEFAULT_CART_STATE, { type: "ADD_ITEM", item: item({ quantity: 2 }) });
    state = cartReducer(state, { type: "UPDATE_QTY", id: "p1", delta: -1 });
    expect(state.items[0].quantity).toBe(1);
    state = cartReducer(state, { type: "UPDATE_QTY", id: "p1", delta: -5 });
    expect(state.items).toEqual([]);
  });

  it("CLEAR_CART drops table and customer; CLEAR_ITEMS keeps them", () => {
    const filled = {
      ...DEFAULT_CART_STATE,
      items: [item()],
      selectedTable: "t1",
      selectedCustomerId: "c1",
      notes: "x",
      manual_discount_type: "fixed" as const,
      manual_discount_value: 1_000,
    };
    expect(cartReducer(filled, { type: "CLEAR_CART" })).toMatchObject({
      items: [],
      selectedTable: null,
      selectedCustomerId: null,
      notes: "",
      manual_discount_type: null,
    });
    expect(cartReducer(filled, { type: "CLEAR_ITEMS" })).toMatchObject({
      items: [],
      selectedTable: "t1",
      selectedCustomerId: "c1",
      notes: "",
      manual_discount_value: null,
    });
  });

  it("only dine-in keeps the selected table", () => {
    const withTable = { ...DEFAULT_CART_STATE, selectedTable: "t1" };
    expect(cartReducer(withTable, { type: "SET_ORDER_TYPE", orderType: "dine_in" }).selectedTable).toBe("t1");
    expect(cartReducer(withTable, { type: "SET_ORDER_TYPE", orderType: "takeaway" }).selectedTable).toBeNull();
  });

  it("sets line and manual discounts", () => {
    let state = cartReducer(DEFAULT_CART_STATE, { type: "ADD_ITEM", item: item({ quantity: 2 }) });
    state = cartReducer(state, { type: "SET_ITEM_DISCOUNT", id: "p1", discount_type: "percent", discount_value: 10 });
    expect(lineGross(state.items[0])).toBe(40_000);
    expect(lineDiscountAmount(state.items[0])).toBe(4_000);
    state = cartReducer(state, { type: "SET_MANUAL_DISCOUNT", discount_type: "fixed", discount_value: 500 });
    expect(state).toMatchObject({ manual_discount_type: "fixed", manual_discount_value: 500 });
  });

  it("HYDRATE normalizes stored state", () => {
    const state = cartReducer(DEFAULT_CART_STATE, {
      type: "HYDRATE",
      state: { ...DEFAULT_CART_STATE, items: undefined as never, manual_discount_value: "250" as never },
    });
    expect(state.items).toEqual([]);
    expect(state.manual_discount_value).toBe(250);
    expect(state.includeService).toBe(true);
  });
});
