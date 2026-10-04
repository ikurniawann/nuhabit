import { describe, expect, it } from "vitest";
import {
  addCartLine,
  cartCount,
  cartSignature,
  cartSubtotal,
  changeCartQuantity,
  checkoutFormError,
  parseStoredCart,
  removeCartLine,
} from "./storefront-cart";

const kaos = { id: "p1", name: "Kaos", price: 100_000 };
const sizeL = { id: "s1", name: "L", price: 120_000 };

describe("storefront cart", () => {
  it("menambah baris baru lalu menaikkan qty untuk produk/varian yang sama", () => {
    let cart = addCartLine([], kaos, sizeL);
    cart = addCartLine(cart, kaos, sizeL);
    cart = addCartLine(cart, kaos, null);
    expect(cart).toEqual([
      { key: "p1::s1", productId: "p1", skuId: "s1", name: "Kaos", variantName: "L", price: 120_000, quantity: 2 },
      { key: "p1", productId: "p1", skuId: null, name: "Kaos", variantName: null, price: 100_000, quantity: 1 },
    ]);
    expect(cartCount(cart)).toBe(3);
    expect(cartSubtotal(cart)).toBe(340_000);
    expect(cartSignature(cart)).toBe("p1::s1:2|p1:1");
  });

  it("qty turun ke 0 membuang baris; hapus baris langsung", () => {
    const cart = addCartLine([], kaos, null);
    expect(changeCartQuantity(cart, "p1", -1)).toEqual([]);
    expect(changeCartQuantity(cart, "p1", 2)[0].quantity).toBe(3);
    expect(removeCartLine(cart, "p1")).toEqual([]);
  });

  it("keranjang tersimpan yang korup dibaca kosong", () => {
    expect(parseStoredCart(null)).toEqual([]);
    expect(parseStoredCart("{rusak")).toEqual([]);
    expect(parseStoredCart('{"a":1}')).toEqual([]);
    expect(parseStoredCart(JSON.stringify(addCartLine([], kaos, null)))).toHaveLength(1);
  });
});

describe("checkoutFormError", () => {
  const ok = { name: "Budi", phone: "0812-3456-789", address: "Jl. Melati No. 10", hasArea: true, hasRate: true };

  it("lolos bila semua terisi", () => {
    expect(checkoutFormError(ok)).toBeNull();
  });

  it("mengembalikan galat pertama sesuai urutan form", () => {
    expect(checkoutFormError({ ...ok, name: " B " })).toBe("Nama penerima wajib diisi");
    expect(checkoutFormError({ ...ok, phone: "0812-34" })).toBe("Nomor WA tidak valid");
    expect(checkoutFormError({ ...ok, hasArea: false, address: "" })).toBe("Pilih area tujuan dulu");
    expect(checkoutFormError({ ...ok, address: "Jl. Mawar" })).toBe("Alamat lengkap minimal 10 karakter");
    expect(checkoutFormError({ ...ok, hasRate: false })).toBe("Pilih kurir dulu");
  });
});
