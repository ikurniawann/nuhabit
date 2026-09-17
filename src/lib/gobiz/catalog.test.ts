import { describe, expect, it } from "vitest";
import { absoluteImageUrl, buildGobizCatalog, variantCategoryId } from "./catalog";

const appUrl = "https://poskopi.reddie.id";

describe("buildGobizCatalog", () => {
  it("mengelompokkan item per kategori, external_id = id produk, varian jadi variant_category min1/max1", () => {
    const { payload, stats } = buildGobizCatalog(
      [
        {
          id: "p-kopi",
          name: "Es Kopi Susu",
          description: "  Signature  ",
          price: 25000,
          image: "/products/kopi-susu.png",
          inStock: true,
          categoryName: "Kopi",
          variants: [
            { id: "v-ice", name: "Ice", priceAdjustment: 0, groupName: "Suhu" },
            { id: "v-oat", name: "Oat", priceAdjustment: 8000, groupName: "Suhu" },
          ],
        },
        {
          id: "p-teh",
          name: "Es Teh",
          price: 12000,
          inStock: false,
          categoryName: "Non-Kopi",
          variants: [],
        },
      ],
      { appUrl, requestId: "req-1" }
    );

    expect(payload.request_id).toBe("req-1");
    expect(payload.menus.map((menu) => menu.name)).toEqual(["Kopi", "Non-Kopi"]);
    const kopi = payload.menus[0].menu_items[0];
    expect(kopi).toEqual({
      external_id: "p-kopi",
      name: "Es Kopi Susu",
      description: "Signature",
      in_stock: true,
      price: 25000,
      image: "https://poskopi.reddie.id/products/kopi-susu.png",
      variant_category_external_ids: [variantCategoryId("p-kopi")],
    });
    expect(payload.variant_categories).toEqual([
      {
        external_id: "vc:p-kopi",
        internal_name: "Es Kopi Susu — Suhu",
        name: "Suhu",
        rules: { selection: { min_quantity: 1, max_quantity: 1 } },
        variants: [
          { external_id: "v-ice", name: "Ice", price: 0, in_stock: true },
          { external_id: "v-oat", name: "Oat", price: 8000, in_stock: true },
        ],
      },
    ]);
    const teh = payload.menus[1].menu_items[0];
    expect(teh.in_stock).toBe(false);
    expect(teh.image).toBeUndefined();
    expect(teh.variant_category_external_ids).toBeUndefined();
    expect(stats).toMatchObject({ menus: 2, items: 2, variantCategories: 1, skipped: [] });
  });

  it("produk harga 0 / nama kosong dilewati & dilaporkan; kategori kosong → 'Menu'; nama dipotong 150", () => {
    const longName = "x".repeat(200);
    const { payload, stats } = buildGobizCatalog(
      [
        { id: "a", name: "Gratis", price: 0, inStock: true, variants: [] },
        { id: "b", name: "   ", price: 1000, inStock: true, variants: [] },
        { id: "c", name: longName, price: 1000.4, inStock: true, categoryName: null, variants: [] },
      ],
      { appUrl, requestId: "r" }
    );
    expect(stats.skipped.map((s) => s.id)).toEqual(["a", "b"]);
    expect(payload.menus).toHaveLength(1);
    expect(payload.menus[0].name).toBe("Menu");
    expect(payload.menus[0].menu_items[0].name).toHaveLength(150);
    expect(payload.menus[0].menu_items[0].price).toBe(1000);
  });

  it("penyesuaian varian negatif dinolkan (GoBiz hanya menambah harga)", () => {
    const { payload } = buildGobizCatalog(
      [
        {
          id: "p",
          name: "Ayam",
          price: 30000,
          inStock: true,
          variants: [{ id: "v", name: "Tanpa nasi", priceAdjustment: -5000 }],
        },
      ],
      { appUrl, requestId: "r" }
    );
    expect(payload.variant_categories[0].variants[0].price).toBe(0);
    expect(payload.variant_categories[0].name).toBe("Pilihan");
  });
});

describe("absoluteImageUrl", () => {
  it("path relatif → absolut dgn appUrl; URL absolut dibiarkan; kosong → undefined", () => {
    expect(absoluteImageUrl("/products/a.png", "https://x.id/")).toBe("https://x.id/products/a.png");
    expect(absoluteImageUrl("products/a.png", "https://x.id")).toBe("https://x.id/products/a.png");
    expect(absoluteImageUrl("https://cdn/x.jpg", "https://x.id")).toBe("https://cdn/x.jpg");
    expect(absoluteImageUrl("", "https://x.id")).toBeUndefined();
    expect(absoluteImageUrl("/a.png", "")).toBeUndefined();
  });
});
