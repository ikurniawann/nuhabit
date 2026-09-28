import { describe, expect, it } from "vitest";
import {
  buildCategories,
  filterProducts,
  groupBySection,
  normalizeTableOrderProduct,
  resolveModifiers,
  resolveVariant,
  unitPriceFor,
  UNCATEGORIZED_ID,
  UNCATEGORIZED_LABEL,
  formatMenuPrice,
} from "./menu";

const baseRow = {
  id: "p1",
  sku: "KOPI-01",
  name: "Kopi Susu Gula Aren",
  description: "  Espresso, susu, gula aren.  ",
  base_price: "28000.00",
  image_url: "",
  xp_points: "28",
  station: "BAR",
  prep_time_minutes: 5,
  min_xp: null,
  category_id: "c-drink",
  category_name: "Minuman",
  variants: [
    { id: "v-ice", name: "Ice", price_adjustment: "0" },
    { id: "v-hot", name: "Hot", price_adjustment: 0 },
    { id: "v-off", name: "Nonaktif", price_adjustment: 5000, is_active: false },
  ],
};

describe("normalizeTableOrderProduct", () => {
  it("memetakan kolom pos_products ke bentuk menu (harga numerik, station lowercase, varian aktif saja)", () => {
    const product = normalizeTableOrderProduct(baseRow);
    expect(product.price).toBe(28000);
    expect(product.xp).toBe(28);
    expect(product.station).toBe("bar");
    expect(product.stationLabel).toBe("Bar");
    expect(product.image).toBeNull();
    expect(product.description).toBe("Espresso, susu, gula aren.");
    expect(product.variants.map((v) => v.id)).toEqual(["v-ice", "v-hot"]);
    expect(product.customizable).toBe(true);
    expect(product.minXp).toBe(0);
  });

  it("menerima varian dalam bentuk string JSON (hasil json_agg) dan default kategori 'Lainnya'", () => {
    const product = normalizeTableOrderProduct({
      ...baseRow,
      category_id: null,
      category_name: null,
      variants: JSON.stringify([{ id: "v1", name: "Regular", price_adjustment: 0 }]),
    });
    expect(product.categoryName).toBe(UNCATEGORIZED_LABEL);
    expect(product.variants).toHaveLength(1);
    expect(product.customizable).toBe(false);
  });

  it("varian JSON rusak → tanpa varian (tidak melempar)", () => {
    const product = normalizeTableOrderProduct({ ...baseRow, variants: "{bukan json" });
    expect(product.variants).toEqual([]);
  });

  it("harga negatif/aneh dinormalkan ke 0", () => {
    const product = normalizeTableOrderProduct({ ...baseRow, base_price: "abc", xp_points: -3 });
    expect(product.price).toBe(0);
    expect(product.xp).toBe(0);
  });
});

describe("resolveVariant / unitPriceFor", () => {
  const product = normalizeTableOrderProduct({
    ...baseRow,
    variants: [
      { id: "reg", name: "Regular", price_adjustment: 0 },
      { id: "lg", name: "Large", price_adjustment: 6000 },
    ],
  });

  it("tanpa pilihan → varian pertama; id tidak dikenal → null (server harus menolak)", () => {
    expect(resolveVariant(product, null)?.id).toBe("reg");
    expect(resolveVariant(product, "lg")?.id).toBe("lg");
    expect(resolveVariant(product, "palsu")).toBeNull();
  });

  it("produk tanpa varian → null dan harga = harga dasar", () => {
    const plain = normalizeTableOrderProduct({ ...baseRow, variants: [] });
    expect(resolveVariant(plain, "apa-saja")).toBeNull();
    expect(unitPriceFor(plain, null)).toBe(28000);
  });

  it("harga satuan = dasar + penyesuaian varian, dibulatkan", () => {
    expect(unitPriceFor(product, resolveVariant(product, "lg"))).toBe(34000);
    expect(unitPriceFor({ price: 10000.4 }, { id: "x", name: "x", priceAdjustment: 0.4 })).toBe(10001);
  });
});

describe("buildCategories / filterProducts / groupBySection", () => {
  const products = [
    normalizeTableOrderProduct({ ...baseRow, id: "a", category_id: "c-drink", category_name: "Minuman" }),
    normalizeTableOrderProduct({ ...baseRow, id: "b", name: "Nasi Goreng", category_id: "c-food", category_name: "Makanan" }),
    normalizeTableOrderProduct({ ...baseRow, id: "c", name: "Roti", category_id: null, category_name: null }),
    normalizeTableOrderProduct({ ...baseRow, id: "d", name: "Teh", category_id: "c-drink", category_name: "Minuman" }),
  ];

  it("kategori mengikuti urutan kemunculan produk dengan hitungan", () => {
    expect(buildCategories(products)).toEqual([
      { id: "c-drink", name: "Minuman", count: 2 },
      { id: "c-food", name: "Makanan", count: 1 },
      { id: UNCATEGORIZED_ID, name: UNCATEGORIZED_LABEL, count: 1 },
    ]);
  });

  it("filter kategori + pencarian bebas huruf besar/kecil", () => {
    expect(filterProducts(products, { categoryId: "c-drink" }).map((p) => p.id)).toEqual(["a", "d"]);
    expect(filterProducts(products, { query: "  NASI " }).map((p) => p.id)).toEqual(["b"]);
    expect(filterProducts(products, { query: "minuman", categoryId: "c-food" })).toEqual([]);
    expect(filterProducts(products, { categoryId: UNCATEGORIZED_ID }).map((p) => p.id)).toEqual(["c"]);
  });

  it("seksi kosong (setelah filter) tidak ikut ditampilkan", () => {
    const categories = buildCategories(products);
    const sections = groupBySection(filterProducts(products, { query: "teh" }), categories);
    expect(sections).toHaveLength(1);
    expect(sections[0].category.id).toBe("c-drink");
    expect(sections[0].products.map((p) => p.id)).toEqual(["d"]);
  });
});

describe("formatMenuPrice", () => {
  it("format id-ID tanpa simbol mata uang seperti referensi daftar menu", () => {
    expect(formatMenuPrice(32500)).toBe("32.500");
    expect(formatMenuPrice(1234567.6)).toBe("1.234.568");
  });
});

describe("add-on (modifier) self-order", () => {
  const row = {
    id: "p1",
    name: "Iced Latte",
    base_price: "25000.00",
    modifier_groups: JSON.stringify([
      { id: "g1", name: "Tambahan Espresso", min_selection: 0, max_selection: 1,
        modifiers: [{ id: "m1", name: "Extra Shot Espresso", price_adjustment: 10000 }, { id: "m2", name: "Double", price_adjustment: "18000" }] },
      { id: "g2", name: "Suhu", min_selection: 1, max_selection: null, modifiers: [{ id: "hot", name: "Hot" }, { id: "ice", name: "Iced" }] },
      { id: "g3", name: "Kosong", modifiers: [] },
    ]),
  };
  const product = normalizeTableOrderProduct(row);

  it("parsing: string JSON, angka string, grup kosong dibuang, max 0/null → 1, produk jadi customizable", () => {
    expect(product.modifierGroups.map((g) => [g.name, g.minSelection, g.maxSelection, g.modifiers.length])).toEqual([
      ["Tambahan Espresso", 0, 1, 2],
      ["Suhu", 1, 1, 2],
    ]);
    expect(product.modifierGroups[0].modifiers[1].priceAdjustment).toBe(18000);
    expect(product.customizable).toBe(true);
  });

  it("valid: harga = dasar + add-on", () => {
    const r = resolveModifiers(product, ["m1", "ice"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.selected.map((m) => [m.name, m.groupName])).toEqual([["Extra Shot Espresso", "Tambahan Espresso"], ["Iced", "Suhu"]]);
      expect(unitPriceFor(product, null, r.selected)).toBe(35000);
    }
  });

  it("ditolak: id asing, ganda, melebihi maks, grup wajib kosong", () => {
    expect(resolveModifiers(product, ["x", "hot"])).toMatchObject({ ok: false });
    expect(resolveModifiers(product, ["hot", "hot"])).toMatchObject({ ok: false, error: expect.stringMatching(/ganda/) });
    expect(resolveModifiers(product, ["m1", "m2", "hot"])).toMatchObject({ ok: false, error: expect.stringMatching(/maksimal 1/) });
    expect(resolveModifiers(product, ["m1"])).toMatchObject({ ok: false, error: expect.stringMatching(/wajib pilih 1/) });
  });

  it("produk tanpa data add-on (cache lama) tidak crash", () => {
    expect(resolveModifiers({ name: "Lama" }, [])).toEqual({ ok: true, selected: [] });
  });
});
