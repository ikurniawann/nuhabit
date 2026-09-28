import { describe, expect, it } from "vitest";
import {
  absoluteImageUrl,
  buildGobizCatalog,
  modifierSelectionRule,
  priceCatalogForChannel,
  variantCategoryId,
} from "./catalog";

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

describe("priceCatalogForChannel (harga GoFood)", () => {
  const rule = {
    code: "gofood",
    name: "GoFood",
    markupPercent: 20,
    roundingStep: 1000 as const,
    roundingMode: "up" as const,
    isActive: true,
  };
  const products = [
    {
      id: "p-latte",
      name: "Iced Latte",
      price: 28000,
      inStock: true,
      variants: [
        { id: "v-reg", name: "Regular", priceAdjustment: 0 },
        { id: "v-oat", name: "Oat", priceAdjustment: 5000 },
      ],
    },
    { id: "p-black", name: "Iced Black", price: 25000, inStock: true, variants: [] },
  ];

  it("markup + pembulatan; harga manual menang; varian ikut markup; data asli tidak diubah", () => {
    const priced = priceCatalogForChannel(products, rule, new Map([["p-black", 29000]]));
    // 28.000 × 1,2 = 33.600 → 34.000
    expect(priced[0].price).toBe(34000);
    expect(priced[0].variants.map((v) => v.priceAdjustment)).toEqual([0, 6000]);
    expect(priced[1].price).toBe(29000);
    expect(products[0].price).toBe(28000);

    const { payload } = buildGobizCatalog(priced, { appUrl, requestId: "r-1" });
    const items = payload.menus.flatMap((menu) => menu.menu_items);
    expect(items.find((item) => item.external_id === "p-latte")?.price).toBe(34000);
    expect(payload.variant_categories[0].variants.map((v) => v.price)).toEqual([0, 6000]);
  });

  it("channel nonaktif → harga dasar, harga manual diabaikan", () => {
    const priced = priceCatalogForChannel(products, { ...rule, isActive: false }, new Map([["p-black", 29000]]));
    expect(priced.map((p) => p.price)).toEqual([28000, 25000]);
    expect(priced[0].variants[1].priceAdjustment).toBe(5000);
  });
});

describe("add-on (grup modifier POS) di katalog GoFood", () => {
  const shot = {
    id: "g-shot",
    name: "Tambahan Espresso",
    minSelection: 0,
    maxSelection: 1,
    modifiers: [{ id: "m-shot", name: "Extra Shot Espresso", priceAdjustment: 10000 }],
  };
  const milk = {
    id: "g-milk",
    name: "Pilihan Susu",
    minSelection: 0,
    maxSelection: 1,
    modifiers: [{ id: "m-oat", name: "Oat Milk", priceAdjustment: 5000 }],
  };
  const products = [
    { id: "p-latte", name: "Iced Latte", price: 28000, inStock: true, variants: [], modifierGroups: [shot, milk] },
    { id: "p-espresso", name: "Espresso", price: 15000, inStock: true, variants: [], modifierGroups: [shot] },
    { id: "p-black", name: "Hot Black", price: 20000, inStock: true, variants: [], modifierGroups: [] },
  ];

  it("grup jadi variant category bersama (dikirim sekali), item merujuk grupnya; opsional min 0", () => {
    const { payload, stats } = buildGobizCatalog(products, { appUrl, requestId: "r" });
    expect(payload.variant_categories).toEqual([
      {
        external_id: "mg:g-shot",
        internal_name: "Add-on — Tambahan Espresso",
        name: "Tambahan Espresso",
        rules: { selection: { min_quantity: 0, max_quantity: 1 } },
        variants: [{ external_id: "m-shot", name: "Extra Shot Espresso", price: 10000, in_stock: true }],
      },
      {
        external_id: "mg:g-milk",
        internal_name: "Add-on — Pilihan Susu",
        name: "Pilihan Susu",
        rules: { selection: { min_quantity: 0, max_quantity: 1 } },
        variants: [{ external_id: "m-oat", name: "Oat Milk", price: 5000, in_stock: true }],
      },
    ]);
    expect(stats.variantCategories).toBe(2);
    const items = payload.menus.flatMap((menu) => menu.menu_items);
    expect(items.find((i) => i.external_id === "p-latte")?.variant_category_external_ids).toEqual(["mg:g-shot", "mg:g-milk"]);
    expect(items.find((i) => i.external_id === "p-espresso")?.variant_category_external_ids).toEqual(["mg:g-shot"]);
    expect(items.find((i) => i.external_id === "p-black")).not.toHaveProperty("variant_category_external_ids");
  });

  it("varian produk + add-on: kategori varian dulu, lalu add-on", () => {
    const { payload } = buildGobizCatalog(
      [{ ...products[1], variants: [{ id: "v-s", name: "Single", priceAdjustment: 0, groupName: "Ukuran" }] }],
      { appUrl, requestId: "r" }
    );
    expect(payload.menus[0].menu_items[0].variant_category_external_ids).toEqual([variantCategoryId("p-espresso"), "mg:g-shot"]);
  });

  it("harga add-on ikut markup GoFood (+20%, bulat Rp1.000 ke atas)", () => {
    const rule = { code: "gofood", name: "GoFood", markupPercent: 20, roundingStep: 1000 as const, roundingMode: "up" as const, isActive: true };
    const { payload } = buildGobizCatalog(priceCatalogForChannel(products, rule, new Map()), { appUrl, requestId: "r" });
    expect(payload.variant_categories.map((c) => c.variants[0].price)).toEqual([12000, 6000]);
    expect(products[0].modifierGroups[0].modifiers[0].priceAdjustment).toBe(10000);
  });

  it("grup tanpa opsi aktif dilewati; aturan pilih aman", () => {
    const { payload } = buildGobizCatalog(
      [{ ...products[2], modifierGroups: [{ ...milk, id: "g-kosong", modifiers: [] }] }],
      { appUrl, requestId: "r" }
    );
    expect(payload.variant_categories).toEqual([]);
    const two = { ...milk, modifiers: [milk.modifiers[0], { id: "m-almond", name: "Almond", priceAdjustment: 6000 }] };
    expect(modifierSelectionRule({ ...two, minSelection: 1, maxSelection: 5 })).toEqual({ min_quantity: 1, max_quantity: 2 });
    expect(modifierSelectionRule({ ...two, minSelection: 3, maxSelection: 0 })).toEqual({ min_quantity: 1, max_quantity: 1 });
  });
});
