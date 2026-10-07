import { describe, expect, it } from "vitest";
import { computeCustomizationPrice, defaultCustomizationSelection, toPrice } from "./customization-price";

// Bentuk data persis seperti dari API: base_price string (kolom numeric),
// price_adjustment angka (lewat JSON relasi).
const icedLight = {
  base_price: "25000.00",
  variants: [],
  modifiers: [
    { modifier_group: { name: "Pilihan Biji Kopi", modifiers: [{ id: "m-beans", name: "Special Beans", price_adjustment: 10000 }] } },
    { modifier_group: { name: "Tambahan Espresso", modifiers: [{ id: "m-shot", name: "Extra Shot Espresso", price_adjustment: 10000 }] } },
    { modifier_group: { name: "Pilihan Susu", modifiers: [{ id: "m-oat", name: "Oat Milk", price_adjustment: "5000.00" }] } },
  ],
};

describe("computeCustomizationPrice", () => {
  it("regresi: base_price string + add-on angka dijumlah, bukan digabung teks", () => {
    const r = computeCustomizationPrice(icedLight, { selectedModifiers: { "Tambahan Espresso": ["m-shot"] } });
    expect(r.unitPrice).toBe(35000);
    expect(r.modifierAdj).toBe(10000);
    expect(r.modifierNames).toEqual(["Extra Shot Espresso"]);
    // bukti bug lama
    expect(("25000.00" as unknown as number) + 0 + 10000).toBe("25000.00010000");
  });

  it("beberapa add-on sekaligus, termasuk price_adjustment string", () => {
    const r = computeCustomizationPrice(icedLight, {
      selectedModifiers: { "Pilihan Biji Kopi": ["m-beans"], "Tambahan Espresso": ["m-shot"], "Pilihan Susu": ["m-oat"] },
    });
    expect(r.unitPrice).toBe(50000);
  });

  it("tanpa pilihan = harga dasar sebagai angka", () => {
    const r = computeCustomizationPrice(icedLight, null);
    expect(r.unitPrice).toBe(25000);
    expect(typeof r.unitPrice).toBe("number");
  });

  it("varian ikut dihitung", () => {
    const r = computeCustomizationPrice(
      { base_price: 20000, variants: [{ id: "v-l", name: "Large", price_adjustment: "3000.00" }] },
      { selectedVariant: "v-l" }
    );
    expect(r).toMatchObject({ variantName: "Large", variantAdj: 3000, unitPrice: 23000 });
  });

  it("id modifier yang tak dikenal diabaikan", () => {
    expect(computeCustomizationPrice(icedLight, { selectedModifiers: { "Pilihan Susu": ["hilang"] } }).unitPrice).toBe(25000);
  });
});

describe("toPrice", () => {
  it("nilai kosong/rusak = 0", () => {
    expect(toPrice(null)).toBe(0);
    expect(toPrice(undefined)).toBe(0);
    expect(toPrice("abc")).toBe(0);
    expect(toPrice("12.5")).toBe(12.5);
  });
});

describe("defaultCustomizationSelection", () => {
  it("add-on opsional (min_selection 0) tidak terpilih otomatis", () => {
    const withMin = {
      ...icedLight,
      modifiers: icedLight.modifiers.map((g) => ({ modifier_group: { ...g.modifier_group, min_selection: 0 } })),
    };
    const sel = defaultCustomizationSelection(withMin);
    expect(sel.selectedModifiers).toEqual({});
    expect(computeCustomizationPrice(withMin, sel).unitPrice).toBe(25000);
  });

  it("grup wajib (min_selection ≥ 1) diisi opsi pertama; min_selection string juga dikenali", () => {
    const sel = defaultCustomizationSelection({
      base_price: 20000,
      modifiers: [
        { modifier_group: { name: "Suhu", min_selection: "1", modifiers: [{ id: "hot", name: "Hot" }, { id: "ice", name: "Iced" }] } },
        { modifier_group: { name: "Topping", min_selection: 0, modifiers: [{ id: "t1", name: "Boba", price_adjustment: 5000 }] } },
      ],
    });
    expect(sel.selectedModifiers).toEqual({ Suhu: ["hot"] });
  });

  it("varian default = yang pertama; tanpa varian = null", () => {
    expect(defaultCustomizationSelection({ base_price: 1, variants: [{ id: "s", name: "S" }, { id: "l", name: "L" }] }).selectedVariant).toBe("s");
    expect(defaultCustomizationSelection({ base_price: 1 }).selectedVariant).toBeNull();
  });
});
