import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { addCartLine, changeCartVariant, makeCartLine } from "@/lib/shop/storefront-cart";
import {
  bindCart,
  clearCart,
  closeCart,
  getCartCount,
  openCart,
  resetCartStore,
  setCartNote,
  updateLines,
  useCart,
  useCartCount,
} from "./cart-store";

const tee = { id: "p1", name: "Tee", price: 100_000 };
const sizeL = { id: "s1", name: "L", price: 120_000 };
const sizeXL = { id: "s2", name: "XL", price: 130_000 };

describe("cart store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetCartStore();
  });

  it("stores lines and the note per slug in localStorage", () => {
    const { result } = renderHook(() => useCart());
    act(() => bindCart("store"));
    act(() => updateLines((lines) => addCartLine(lines, tee, sizeL, 2)));
    act(() => setCartNote("Gift wrap"));
    expect(result.current.lines[0]).toMatchObject({ key: "p1::s1", quantity: 2 });
    expect(JSON.parse(window.localStorage.getItem("shop-cart-store") ?? "")).toEqual({
      lines: result.current.lines,
      note: "Gift wrap",
    });
    expect(window.localStorage.getItem("shop-cart-active")).toBe("store");
    expect(getCartCount()).toBe(2);
  });

  it("changing the size in the cart keeps the quantity", () => {
    act(() => bindCart("store"));
    act(() => updateLines((lines) => addCartLine(lines, tee, sizeL, 3)));
    act(() => updateLines((lines) => changeCartVariant(lines, "p1::s1", tee, sizeXL)));
    const { result } = renderHook(() => useCart());
    expect(result.current.lines).toEqual([expect.objectContaining({ key: "p1::s2", variantName: "XL", quantity: 3 })]);
  });

  it("the badge outside the store page reads the last cart and openCart opens the drawer", () => {
    window.localStorage.setItem("shop-cart-active", "store");
    window.localStorage.setItem("shop-cart-store", JSON.stringify({ lines: [makeCartLine(tee, null, 4)], note: "" }));
    const { result } = renderHook(() => useCartCount());
    expect(result.current).toBe(4);

    const cart = renderHook(() => useCart());
    act(() => openCart());
    expect(cart.result.current.open).toBe(true);
    act(() => closeCart());
    expect(cart.result.current.open).toBe(false);
  });

  it("buy now leaves the stored cart alone", () => {
    act(() => bindCart("store"));
    act(() => updateLines((lines) => addCartLine(lines, tee, sizeL)));
    // Buy Now builds a separate in-memory line; the store does not change.
    const buyNow = [makeCartLine(tee, sizeXL)];
    expect(buyNow[0].key).toBe("p1::s2");
    const { result } = renderHook(() => useCart());
    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0].key).toBe("p1::s1");
    act(() => clearCart());
    expect(result.current.lines).toEqual([]);
    expect(window.localStorage.getItem("shop-cart-store")).toBe(JSON.stringify({ lines: [], note: "" }));
  });
});
