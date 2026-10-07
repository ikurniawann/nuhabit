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

const kaos = { id: "p1", name: "Kaos", price: 100_000 };
const sizeL = { id: "s1", name: "L", price: 120_000 };
const sizeXL = { id: "s2", name: "XL", price: 130_000 };

describe("cart store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetCartStore();
  });

  it("menyimpan baris dan catatan per slug di localStorage", () => {
    const { result } = renderHook(() => useCart());
    act(() => bindCart("toko"));
    act(() => updateLines((lines) => addCartLine(lines, kaos, sizeL, 2)));
    act(() => setCartNote("Bungkus kado"));
    expect(result.current.lines[0]).toMatchObject({ key: "p1::s1", quantity: 2 });
    expect(JSON.parse(window.localStorage.getItem("shop-cart-toko") ?? "")).toEqual({
      lines: result.current.lines,
      note: "Bungkus kado",
    });
    expect(window.localStorage.getItem("shop-cart-active")).toBe("toko");
    expect(getCartCount()).toBe(2);
  });

  it("ganti ukuran di keranjang mempertahankan qty", () => {
    act(() => bindCart("toko"));
    act(() => updateLines((lines) => addCartLine(lines, kaos, sizeL, 3)));
    act(() => updateLines((lines) => changeCartVariant(lines, "p1::s1", kaos, sizeXL)));
    const { result } = renderHook(() => useCart());
    expect(result.current.lines).toEqual([expect.objectContaining({ key: "p1::s2", variantName: "XL", quantity: 3 })]);
  });

  it("badge di luar halaman toko membaca keranjang terakhir dan openCart membuka drawer", () => {
    window.localStorage.setItem("shop-cart-active", "toko");
    window.localStorage.setItem("shop-cart-toko", JSON.stringify({ lines: [makeCartLine(kaos, null, 4)], note: "" }));
    const { result } = renderHook(() => useCartCount());
    expect(result.current).toBe(4);

    const cart = renderHook(() => useCart());
    act(() => openCart());
    expect(cart.result.current.open).toBe(true);
    act(() => closeCart());
    expect(cart.result.current.open).toBe(false);
  });

  it("buy now tidak menyentuh keranjang tersimpan", () => {
    act(() => bindCart("toko"));
    act(() => updateLines((lines) => addCartLine(lines, kaos, sizeL)));
    // Beli Sekarang membuat baris terpisah di memori; store tidak berubah.
    const buyNow = [makeCartLine(kaos, sizeXL)];
    expect(buyNow[0].key).toBe("p1::s2");
    const { result } = renderHook(() => useCart());
    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0].key).toBe("p1::s1");
    act(() => clearCart());
    expect(result.current.lines).toEqual([]);
    expect(window.localStorage.getItem("shop-cart-toko")).toBe(JSON.stringify({ lines: [], note: "" }));
  });
});
