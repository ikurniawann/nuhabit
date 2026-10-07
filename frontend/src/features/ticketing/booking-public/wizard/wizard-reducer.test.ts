import { describe, expect, it } from "vitest";
import type { CatalogProduct, CatalogVariant } from "@/lib/ticketing/booking-wizard-cart";
import { initialWizardState, wizardReducer, type WizardState } from "./wizard-reducer";

const dewasa: CatalogVariant = { variant_id: "v-dw", variant_name: "Dewasa", price: 50_000, season_kind: "regular" };
const single: CatalogProduct = {
  ticket_product_id: "p1",
  code: "T",
  name: "Tiket",
  description: null,
  thumbnail_url: null,
  product_kind: "single",
  variants: [dewasa],
};
const vip: CatalogVariant = { variant_id: "v-vip", variant_name: "VIP", price: 90_000, season_kind: "regular" };
const other: CatalogProduct = { ...single, ticket_product_id: "p2", variants: [vip] };

const promo = { code: "HEMAT", discount: 10_000, campaign_name: "Hemat" };
const base = initialWizardState("2026-10-04");

describe("wizardReducer langkah", () => {
  it("next/back berhenti di ujung urutan", () => {
    const s1 = wizardReducer(base, { type: "back" });
    expect(s1.step).toBe("pilih");
    const s2 = wizardReducer(wizardReducer(base, { type: "next" }), { type: "next" });
    expect(s2.step).toBe("ringkasan");
    expect(wizardReducer(s2, { type: "next" }).step).toBe("ringkasan");
    expect(wizardReducer(s2, { type: "back" }).step).toBe("pemesan");
  });
});

describe("wizardReducer tanggal", () => {
  it("pickDate menutup kalender dan membuang pilihan, slot, promo", () => {
    const dirty: WizardState = {
      ...base,
      calendarOpen: true,
      selectedProductId: "p1",
      qty: { "v-dw": 2 },
      guestNames: { "v-dw": ["A"] },
      selectedSlotId: "s1",
      promo,
      promoError: "x",
      customerName: "Budi",
    };
    const next = wizardReducer(dirty, { type: "pickDate", date: "2026-10-10" });
    expect(next).toMatchObject({
      visitDate: "2026-10-10",
      calendarOpen: false,
      selectedProductId: null,
      qty: {},
      guestNames: {},
      selectedSlotId: null,
      promo: null,
      promoError: null,
      customerName: "Budi",
    });
  });
});

describe("wizardReducer qty", () => {
  it("ganti produk mereset nama rombongan dan promo", () => {
    const s = { ...base, selectedProductId: "p1", qty: { "v-dw": 2 }, guestNames: { "v-dw": ["A"] }, promo };
    const next = wizardReducer(s, { type: "changeQty", product: other, variant: vip, delta: 1 });
    expect(next).toMatchObject({ selectedProductId: "p2", qty: { "v-vip": 1 }, guestNames: {}, promo: null });
  });

  it("qty produk yang sama mempertahankan nama tapi membuang promo", () => {
    const s = { ...base, selectedProductId: "p1", qty: { "v-dw": 2 }, guestNames: { "v-dw": ["A"] }, promo };
    const next = wizardReducer(s, { type: "changeQty", product: single, variant: dewasa, delta: -1 });
    expect(next.qty).toEqual({ "v-dw": 1 });
    expect(next.guestNames).toEqual({ "v-dw": ["A"] });
    expect(next.promo).toBeNull();
  });

  it("perubahan yang ditolak mengembalikan state yang sama", () => {
    const s = { ...base, selectedProductId: "p1", qty: { "v-dw": 20 }, promo };
    expect(wizardReducer(s, { type: "changeQty", product: single, variant: dewasa, delta: 1 })).toBe(s);
  });
});

describe("wizardReducer pemesan", () => {
  it("setText & setGuestName", () => {
    const s1 = wizardReducer(base, { type: "setText", field: "customerName", value: "Budi" });
    expect(s1.customerName).toBe("Budi");
    const s2 = wizardReducer(s1, { type: "setGuestName", variantId: "v-dw", unitIndex: 2, value: "Ani" });
    expect(s2.guestNames["v-dw"][2]).toBe("Ani");
    expect(s2.guestNames["v-dw"]).toHaveLength(3);
  });

  it("mematikan hadiah mengosongkan data penerima", () => {
    const s = { ...base, isGift: true, giftName: "Sari", giftPhone: "0812" };
    expect(wizardReducer(s, { type: "setGift", isGift: false })).toMatchObject({
      isGift: false,
      giftName: "",
      giftPhone: "",
    });
    expect(wizardReducer(base, { type: "setGift", isGift: true }).isGift).toBe(true);
  });
});

describe("wizardReducer promo", () => {
  it("input di-uppercase dan menghapus pesan error", () => {
    const s = wizardReducer({ ...base, promoError: "x" }, { type: "setPromoInput", value: "hemat" });
    expect(s).toMatchObject({ promoInput: "HEMAT", promoError: null });
  });

  it("promoApplied mengosongkan input; promoRejected melepas promo", () => {
    const applied = wizardReducer({ ...base, promoInput: "HEMAT" }, { type: "promoApplied", promo });
    expect(applied).toMatchObject({ promo, promoInput: "" });
    const rejected = wizardReducer(applied, { type: "promoRejected", message: "Kuota habis" });
    expect(rejected).toMatchObject({ promo: null, promoError: "Kuota habis" });
    expect(wizardReducer(rejected, { type: "clearPromo" })).toMatchObject({ promo: null, promoError: null });
  });
});
