import { describe, expect, it } from "vitest";
import {
  addCartLine,
  cartCount,
  cartLineIssue,
  cartSignature,
  cartSubtotal,
  changeCartQuantity,
  changeCartVariant,
  checkoutFormError,
  filterAndSortProducts,
  groupByCollection,
  parseStoredCart,
  removeCartLine,
} from "./storefront-cart";
import type { CatalogProduct } from "./types";

const tee = { id: "p1", name: "Tee", price: 100_000 };
const sizeL = { id: "s1", name: "L", price: 120_000 };
const sizeXL = { id: "s2", name: "XL", price: 130_000 };

describe("storefront cart", () => {
  it("adds a new line, then raises the quantity for the same product or variant", () => {
    let cart = addCartLine([], tee, sizeL);
    cart = addCartLine(cart, tee, sizeL);
    cart = addCartLine(cart, tee, null);
    expect(cart).toEqual([
      { key: "p1::s1", productId: "p1", skuId: "s1", name: "Tee", variantName: "L", price: 120_000, quantity: 2, preorderUntil: null },
      { key: "p1", productId: "p1", skuId: null, name: "Tee", variantName: null, price: 100_000, quantity: 1, preorderUntil: null },
    ]);
    expect(cartCount(cart)).toBe(3);
    expect(cartSubtotal(cart)).toBe(340_000);
    expect(cartSignature(cart)).toBe("p1::s1:2|p1:1");
  });

  it("drops a line at quantity 0; removes a line directly", () => {
    const cart = addCartLine([], tee, null);
    expect(changeCartQuantity(cart, "p1", -1)).toEqual([]);
    expect(changeCartQuantity(cart, "p1", 2)[0].quantity).toBe(3);
    expect(removeCartLine(cart, "p1")).toEqual([]);
  });

  it("changing the size keeps the quantity and merges into an existing variant", () => {
    let cart = addCartLine([], tee, sizeL, 3);
    cart = changeCartVariant(cart, "p1::s1", tee, sizeXL);
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ key: "p1::s2", variantName: "XL", price: 130_000, quantity: 3 });

    cart = addCartLine(cart, tee, sizeL, 2);
    cart = changeCartVariant(cart, "p1::s1", tee, sizeXL);
    expect(cart).toEqual([expect.objectContaining({ key: "p1::s2", quantity: 5 })]);

    expect(changeCartVariant(cart, "missing", tee, sizeL)).toBe(cart);
    expect(changeCartVariant(cart, "p1::s2", tee, sizeXL)).toBe(cart);
  });

  it("a pre-order line carries the expected date", () => {
    const jacket = { id: "p2", name: "Jacket", price: 250_000, preorder: true, preorderUntil: "2026-11-01" };
    expect(addCartLine([], jacket, null)[0].preorderUntil).toBe("2026-11-01");
    expect(addCartLine([], jacket, { ...sizeL, preorder: false })[0].preorderUntil).toBeNull();
    expect(addCartLine([], jacket, { ...sizeL, preorder: true })[0].preorderUntil).toBe("2026-11-01");
  });

  it("stored cart: old format, new format and corrupt data", () => {
    expect(parseStoredCart(null)).toEqual({ lines: [], note: "" });
    expect(parseStoredCart("{broken")).toEqual({ lines: [], note: "" });
    expect(parseStoredCart('{"a":1}')).toEqual({ lines: [], note: "" });
    const legacy = addCartLine([], tee, null).map(({ preorderUntil: _drop, ...line }) => line);
    expect(parseStoredCart(JSON.stringify(legacy)).lines[0]).toMatchObject({ key: "p1", preorderUntil: null });
    const stored = { lines: addCartLine([], tee, sizeL), note: "Gift wrap" };
    expect(parseStoredCart(JSON.stringify(stored))).toEqual(stored);
    expect(parseStoredCart('{"lines":[{"key":1}],"note":5}')).toEqual({ lines: [], note: "" });
  });
});

describe("groupByCollection", () => {
  const product = (id: string, collection: { id: string; name: string } | null): CatalogProduct => ({
    id, name: id, description: null, longDescription: null, imageUrl: null, images: [], price: 1,
    weightGram: null, stock: 1, collection, preorderUntil: null, preorder: false, skus: [],
  });
  const tops = { id: "c1", name: "Tops" };
  const accessories = { id: "c2", name: "Accessories" };

  it("follows the collection order, skips empty collections and puts the rest under Other", () => {
    const groups = groupByCollection(
      [product("a", accessories), product("b", tops), product("c", null), product("d", tops)],
      [tops, { id: "c9", name: "Empty" }, accessories]
    );
    expect(groups.map((g) => [g.name, g.products.map((p) => p.id)])).toEqual([
      ["Tops", ["b", "d"]],
      ["Accessories", ["a"]],
      ["Other", ["c"]],
    ]);
  });

  it("a single collection yields a single group", () => {
    expect(groupByCollection([product("a", tops)], [tops])).toHaveLength(1);
    expect(groupByCollection([product("a", null)], [])).toEqual([
      { id: "other", name: "Other", products: [product("a", null)] },
    ]);
  });

  it("searches names, collections and sizes, and sorts by available variant price", () => {
    const cap = product("Cap", accessories);
    cap.price = 90_000;
    const shirt = product("Training Shirt", tops);
    shirt.price = 150_000;
    shirt.skus = [
      { id: "sold", sku: "S", name: "Small", price: 80_000, stock: 0, preorder: false },
      { id: "medium", sku: "M", name: "Medium", price: 120_000, stock: 2, preorder: false },
    ];
    expect(filterAndSortProducts([shirt, cap], "medium", false, "featured")).toEqual([shirt]);
    expect(filterAndSortProducts([shirt, cap], "accessories", false, "featured")).toEqual([cap]);
    expect(filterAndSortProducts([shirt, cap], "", false, "price-asc")).toEqual([cap, shirt]);
    expect(filterAndSortProducts([shirt, cap], "", false, "price-desc")).toEqual([shirt, cap]);
    cap.stock = 0;
    expect(filterAndSortProducts([shirt, cap], "", true, "featured")).toEqual([shirt]);
  });

  it("flags saved cart lines when stock, variants or prices change", () => {
    const shirt = product("Training Shirt", tops);
    shirt.id = "p1";
    shirt.name = "Tee";
    shirt.skus = [{ ...sizeL, sku: "L", stock: 2, preorder: false }];
    const line = addCartLine([], tee, sizeL, 2)[0];
    expect(cartLineIssue(line, [shirt])).toBeNull();
    expect(cartLineIssue({ ...line, quantity: 3 }, [shirt])).toBe("Only 2 available");
    expect(cartLineIssue({ ...line, price: 100_000 }, [shirt])).toMatch(/Price changed/);
    expect(cartLineIssue(line, [])).toMatch(/no longer available/);
    shirt.skus = [];
    expect(cartLineIssue(line, [shirt])).toMatch(/size is no longer available/);
  });
});

describe("checkoutFormError", () => {
  const ok = { name: "Budi", phone: "0812-3456-789", address: "Jl. Melati No. 10", hasArea: true, hasRate: true };

  it("passes when everything is filled in", () => {
    expect(checkoutFormError(ok)).toBeNull();
  });

  it("returns the first error in form order", () => {
    expect(checkoutFormError({ ...ok, name: " B " })).toBe("Recipient name is required");
    expect(checkoutFormError({ ...ok, phone: "0812-34" })).toBe("Enter a valid WhatsApp number");
    expect(checkoutFormError({ ...ok, email: "not-an-email" })).toBe("Enter a valid email address or leave it blank");
    expect(checkoutFormError({ ...ok, hasArea: false, address: "" })).toBe("Choose a destination area first");
    expect(checkoutFormError({ ...ok, address: "Jl. Mawar" })).toBe("Full address must be at least 10 characters");
    expect(checkoutFormError({ ...ok, hasRate: false })).toBe("Choose a courier first");
  });
});
