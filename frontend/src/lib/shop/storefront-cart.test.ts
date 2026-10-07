import { describe, expect, it } from "vitest";
import {
  addCartLine,
  cartCount,
  cartSignature,
  cartSubtotal,
  changeCartQuantity,
  changeCartVariant,
  checkoutFormError,
  groupByCollection,
  parseStoredCart,
  removeCartLine,
} from "./storefront-cart";
import type { CatalogProduct } from "./types";

const kaos = { id: "p1", name: "Kaos", price: 100_000 };
const sizeL = { id: "s1", name: "L", price: 120_000 };
const sizeXL = { id: "s2", name: "XL", price: 130_000 };

describe("storefront cart", () => {
  it("menambah baris baru lalu menaikkan qty untuk produk/varian yang sama", () => {
    let cart = addCartLine([], kaos, sizeL);
    cart = addCartLine(cart, kaos, sizeL);
    cart = addCartLine(cart, kaos, null);
    expect(cart).toEqual([
      { key: "p1::s1", productId: "p1", skuId: "s1", name: "Kaos", variantName: "L", price: 120_000, quantity: 2, preorderUntil: null },
      { key: "p1", productId: "p1", skuId: null, name: "Kaos", variantName: null, price: 100_000, quantity: 1, preorderUntil: null },
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

  it("ganti ukuran mempertahankan qty dan menggabung ke varian yang sudah ada", () => {
    let cart = addCartLine([], kaos, sizeL, 3);
    cart = changeCartVariant(cart, "p1::s1", kaos, sizeXL);
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ key: "p1::s2", variantName: "XL", price: 130_000, quantity: 3 });

    cart = addCartLine(cart, kaos, sizeL, 2);
    cart = changeCartVariant(cart, "p1::s1", kaos, sizeXL);
    expect(cart).toEqual([expect.objectContaining({ key: "p1::s2", quantity: 5 })]);

    expect(changeCartVariant(cart, "tidak-ada", kaos, sizeL)).toBe(cart);
    expect(changeCartVariant(cart, "p1::s2", kaos, sizeXL)).toBe(cart);
  });

  it("baris pre-order membawa tanggal perkiraan", () => {
    const jaket = { id: "p2", name: "Jaket", price: 250_000, preorder: true, preorderUntil: "2026-11-01" };
    expect(addCartLine([], jaket, null)[0].preorderUntil).toBe("2026-11-01");
    expect(addCartLine([], jaket, { ...sizeL, preorder: false })[0].preorderUntil).toBeNull();
    expect(addCartLine([], jaket, { ...sizeL, preorder: true })[0].preorderUntil).toBe("2026-11-01");
  });

  it("keranjang tersimpan: format lama, format baru, dan data korup", () => {
    expect(parseStoredCart(null)).toEqual({ lines: [], note: "" });
    expect(parseStoredCart("{rusak")).toEqual({ lines: [], note: "" });
    expect(parseStoredCart('{"a":1}')).toEqual({ lines: [], note: "" });
    const legacy = addCartLine([], kaos, null).map(({ preorderUntil: _drop, ...line }) => line);
    expect(parseStoredCart(JSON.stringify(legacy)).lines[0]).toMatchObject({ key: "p1", preorderUntil: null });
    const stored = { lines: addCartLine([], kaos, sizeL), note: "Bungkus kado" };
    expect(parseStoredCart(JSON.stringify(stored))).toEqual(stored);
    expect(parseStoredCart('{"lines":[{"key":1}],"note":5}')).toEqual({ lines: [], note: "" });
  });
});

describe("groupByCollection", () => {
  const product = (id: string, collection: { id: string; name: string } | null): CatalogProduct => ({
    id, name: id, description: null, longDescription: null, imageUrl: null, images: [], price: 1,
    weightGram: null, stock: 1, collection, preorderUntil: null, preorder: false, skus: [],
  });
  const atasan = { id: "c1", name: "Atasan" };
  const aksesori = { id: "c2", name: "Aksesori" };

  it("mengikuti urutan koleksi, melewati koleksi kosong, dan menaruh sisanya di Lainnya", () => {
    const groups = groupByCollection(
      [product("a", aksesori), product("b", atasan), product("c", null), product("d", atasan)],
      [atasan, { id: "c9", name: "Kosong" }, aksesori]
    );
    expect(groups.map((g) => [g.name, g.products.map((p) => p.id)])).toEqual([
      ["Atasan", ["b", "d"]],
      ["Aksesori", ["a"]],
      ["Lainnya", ["c"]],
    ]);
  });

  it("satu koleksi saja menghasilkan satu grup", () => {
    expect(groupByCollection([product("a", atasan)], [atasan])).toHaveLength(1);
    expect(groupByCollection([product("a", null)], [])).toEqual([
      { id: "lainnya", name: "Lainnya", products: [product("a", null)] },
    ]);
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
