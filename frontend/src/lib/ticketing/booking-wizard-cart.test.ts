import { describe, expect, it } from "vitest";
import {
  applyQtyChange,
  buildBookingPayload,
  buildCart,
  bundleContentsLabel,
  bundleSaving,
  bundleStandaloneTotal,
  cartAmount,
  cartPersons,
  defaultGuestName,
  flattenGuestUnits,
  isCustomerValid,
  isSlotRequirementUnmet,
  minVariantPrice,
  payableAmount,
  personsPerUnit,
  variantLabelOf,
  type CatalogProduct,
  type CatalogVariant,
} from "./booking-wizard-cart";

const member = (label: string, weight: number | null) => ({
  component_variant_id: `cv-${label}`,
  member_label: label,
  weight_price: weight,
});

const dewasa: CatalogVariant = { variant_id: "v-dw", variant_name: "Dewasa", price: 50_000, season_kind: "regular" };
const anak: CatalogVariant = { variant_id: "v-ak", variant_name: "Anak", price: 30_000, season_kind: "regular" };
const single: CatalogProduct = {
  ticket_product_id: "p-single",
  code: "TKT",
  name: "Tiket Masuk",
  description: null,
  thumbnail_url: null,
  product_kind: "single",
  variants: [dewasa, anak],
};
const paketVariant: CatalogVariant = {
  variant_id: "v-pk",
  variant_name: "Paket",
  price: 120_000,
  season_kind: "high",
  members: [member("Dewasa", 50_000), member("Dewasa", 50_000), member("Anak", 30_000)],
};
const bundle: CatalogProduct = {
  ticket_product_id: "p-bundle",
  code: "PKT",
  name: "Paket Keluarga",
  description: null,
  thumbnail_url: null,
  product_kind: "bundle",
  variants: [paketVariant],
};
const catalog = [single, bundle];

describe("harga & label varian", () => {
  it("personsPerUnit: paket = jumlah anggota, satuan = 1", () => {
    expect(personsPerUnit(dewasa)).toBe(1);
    expect(personsPerUnit(paketVariant)).toBe(3);
  });
  it("bundleStandaloneTotal null bila bobot bolong atau bukan paket", () => {
    expect(bundleStandaloneTotal(paketVariant)).toBe(130_000);
    expect(bundleStandaloneTotal(dewasa)).toBeNull();
    expect(bundleStandaloneTotal({ ...paketVariant, members: [member("A", null)] })).toBeNull();
  });
  it("bundleSaving hanya bila harga paket lebih murah", () => {
    expect(bundleSaving(paketVariant)).toEqual({ standalone: 130_000, saving: 10_000 });
    expect(bundleSaving({ ...paketVariant, price: 130_000 })).toBeNull();
  });
  it("bundleContentsLabel menghitung anggota per label", () => {
    expect(bundleContentsLabel(paketVariant)).toBe("2× Dewasa, 1× Anak");
  });
  it("variantLabelOf & minVariantPrice", () => {
    expect(variantLabelOf(bundle, paketVariant)).toBe("Paket (3 orang)");
    expect(variantLabelOf(single, anak)).toBe("Anak");
    expect(minVariantPrice(single)).toBe(30_000);
    expect(minVariantPrice({ ...single, variants: [] })).toBe(0);
  });
});

describe("keranjang", () => {
  it("buildCart membuang qty 0 dan varian tak dikenal", () => {
    const cart = buildCart(catalog, { "v-dw": 2, "v-ak": 0, "v-x": 3 });
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ product: single, variant: dewasa, qty: 2 });
  });
  it("total orang & rupiah menghitung paket per anggota", () => {
    const cart = buildCart(catalog, { "v-pk": 2 });
    expect(cartPersons(cart)).toBe(6);
    expect(cartAmount(cart)).toBe(240_000);
  });
  it("payableAmount tidak negatif dan dibulatkan 2 desimal", () => {
    expect(payableAmount(100_000, 25_000)).toBe(75_000);
    expect(payableAmount(10_000, 25_000)).toBe(0);
    expect(payableAmount(100.005, 0.001)).toBe(100);
  });
});

describe("applyQtyChange", () => {
  const empty = { selectedProductId: null, qty: {} };

  it("menambah varian produk lain mereset pilihan (1 produk / transaksi)", () => {
    const first = applyQtyChange(empty, single, dewasa, 1);
    expect(first).toEqual({ selectedProductId: "p-single", qty: { "v-dw": 1 } });
    const switched = applyQtyChange({ ...first, qty: { "v-dw": 4 } }, bundle, paketVariant, 1);
    expect(switched).toEqual({ selectedProductId: "p-bundle", qty: { "v-pk": 1 } });
  });

  it("mengurangi tidak pernah di bawah nol", () => {
    const state = { selectedProductId: "p-single", qty: { "v-dw": 1 } };
    expect(applyQtyChange(state, single, dewasa, -1).qty).toEqual({ "v-dw": 0 });
    const zero = { ...state, qty: { "v-dw": 0 } };
    expect(applyQtyChange(zero, single, dewasa, -1)).toBe(zero);
  });

  it("menolak melewati 20 orang dengan mengembalikan objek yang sama", () => {
    const full = { selectedProductId: "p-single", qty: { "v-dw": 15, "v-ak": 5 } };
    expect(applyQtyChange(full, single, anak, 1)).toBe(full);
    const paket = { selectedProductId: "p-bundle", qty: { "v-pk": 6 } };
    expect(applyQtyChange(paket, bundle, paketVariant, 1)).toBe(paket);
    expect(applyQtyChange({ ...paket, qty: { "v-pk": 5 } }, bundle, paketVariant, 1).qty).toEqual({ "v-pk": 6 });
  });
});

describe("rombongan", () => {
  it("flattenGuestUnits mengikuti urutan server item → qty → anggota", () => {
    const units = flattenGuestUnits(buildCart(catalog, { "v-pk": 2 }));
    expect(units.map((u) => [u.unitIndex, u.position])).toEqual([
      [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6],
    ]);
    expect(units[2].label).toBe("Paket Keluarga · Anak");
    const satuan = flattenGuestUnits(buildCart(catalog, { "v-dw": 2, "v-ak": 1 }));
    expect(satuan.map((u) => `${u.variantId}:${u.unitIndex}:${u.position}`)).toEqual([
      "v-dw:0:1", "v-dw:1:2", "v-ak:0:3",
    ]);
    expect(satuan[2].label).toBe("Tiket Masuk — Anak");
  });

  it("defaultGuestName: posisi 1 = pemesan, sisanya Group", () => {
    expect(defaultGuestName(" Budi ", 1)).toBe("Budi");
    expect(defaultGuestName("Budi", 3)).toBe("Group Budi - 3");
    expect(defaultGuestName("", 2)).toBe("Group Anda - 2");
  });
});

describe("validasi", () => {
  const base = { customerName: "Budi", customerPhone: "0812-3456-78", isGift: false, giftName: "", giftPhone: "" };

  it("isCustomerValid mengecek nama, digit WA, dan data hadiah", () => {
    expect(isCustomerValid(base)).toBe(true);
    expect(isCustomerValid({ ...base, customerName: " B " })).toBe(false);
    expect(isCustomerValid({ ...base, customerPhone: "0812-345" })).toBe(false);
    expect(isCustomerValid({ ...base, isGift: true })).toBe(false);
    expect(isCustomerValid({ ...base, isGift: true, giftName: "Sari", giftPhone: "081234567" })).toBe(true);
  });

  it("isSlotRequirementUnmet hanya untuk venue ber-slot", () => {
    const slots = [
      { slot_id: "s1", status: "available" },
      { slot_id: "s2", status: "sold_out" },
    ];
    expect(isSlotRequirementUnmet([], null)).toBe(false);
    expect(isSlotRequirementUnmet(slots, null)).toBe(true);
    expect(isSlotRequirementUnmet(slots, "s2")).toBe(true);
    expect(isSlotRequirementUnmet(slots, "s1")).toBe(false);
  });
});

describe("buildBookingPayload", () => {
  it("menyusun body POST dengan nama kosong → null dan field opsional", () => {
    const cart = buildCart(catalog, { "v-pk": 1 });
    const payload = buildBookingPayload({
      visitDate: "2026-10-10",
      customerName: " Budi ",
      customerPhone: " 0812345678 ",
      isGift: true,
      giftName: " Sari ",
      giftPhone: "0898765432 ",
      selectedSlotId: "s1",
      promoCode: "HEMAT",
      cart,
      guestNames: { "v-pk": ["", " Ani "] },
    });
    expect(payload).toEqual({
      visit_date: "2026-10-10",
      customer_name: "Budi",
      customer_phone: "0812345678",
      slot_id: "s1",
      promo_code: "HEMAT",
      gift_recipient_name: "Sari",
      gift_recipient_phone: "0898765432",
      items: [{ variant_id: "v-pk", qty: 1, guest_names: [null, "Ani", null] }],
    });
  });

  it("tanpa slot, promo, dan hadiah field opsional tidak dikirim", () => {
    const payload = buildBookingPayload({
      visitDate: "2026-10-10",
      customerName: "Budi",
      customerPhone: "0812345678",
      isGift: false,
      giftName: "x",
      giftPhone: "y",
      selectedSlotId: null,
      promoCode: null,
      cart: buildCart(catalog, { "v-dw": 1 }),
      guestNames: {},
    });
    expect(Object.keys(payload)).toEqual(["visit_date", "customer_name", "customer_phone", "items"]);
  });
});
