import { describe, expect, it } from "vitest";
import {
  buildOfferPayload,
  emptyOfferForm,
  formatOfferWindow,
  numberFromApi,
  offerFormFromRule,
  offerFormReducer,
  offerLimitBadges,
  summarizeOffer,
  type OfferForm,
} from "./offer-form";
import type { OfferRule } from "./types";

const rule = (over: Partial<OfferRule> = {}): OfferRule => ({
  id: "r1", offer_type: "volume", name: "Hemat", description: null, valid_from: null, valid_until: null,
  is_active: true, bundle_price: null, buy_qty: null, get_qty: null, get_mode: null, volume_basis: "qty",
  volume_min: "5.00", discount_type: "percent", discount_value: "3.00", created_at: "2026-10-01",
  used_count: 0, items: [], sales_channels: null, max_uses: null, max_uses_per_member: null,
  is_exclusive: false, priority: 0, unlock_code: null, ...over,
});

const withItems = (form: OfferForm, ...items: Array<[OfferForm["items"][number]["role"], string]>) =>
  items.reduce(
    (state, [role, productId], i) => {
      const key = `${role}-${i}`;
      const added = offerFormReducer(state, { type: "addItem", role, key });
      return offerFormReducer(added, { type: "patchItem", key, patch: { product_id: productId } });
    },
    form
  );

describe("offer form", () => {
  it("numberFromApi membulatkan angka DB dan mengosongkan nol/invalid", () => {
    expect(numberFromApi("1000.00")).toBe("1000");
    expect(numberFromApi(0)).toBe("");
    expect(numberFromApi("abc")).toBe("");
    expect(numberFromApi(null)).toBe("");
  });

  it("form BXGY baru mulai beli 1 gratis 1", () => {
    expect(emptyOfferForm("bxgy")).toMatchObject({ buy_qty: "1", get_qty: "1", get_mode: "same_as_buy" });
    expect(emptyOfferForm("bundle")).toMatchObject({ buy_qty: "", get_qty: "" });
  });

  it("reducer: tambah, ubah, hapus item dan patch batas", () => {
    let form = withItems(emptyOfferForm("bundle"), ["component", "p1"], ["component", "p2"]);
    form = offerFormReducer(form, { type: "removeItem", key: "component-0" });
    form = offerFormReducer(form, { type: "patchLimits", patch: { priority: "5" } });
    expect(form.items.map((i) => i.product_id)).toEqual(["p2"]);
    expect(form.limits.priority).toBe("5");
  });

  it("payload BXGY 'item sama' tidak mengirim item gratis; item kosong dibuang", () => {
    const form = withItems(emptyOfferForm("bxgy"), ["buy", "p1"], ["get", "p2"], ["buy", ""]);
    const same = buildOfferPayload("bxgy", form);
    expect(same.items.map((i) => [i.role, i.product_id])).toEqual([["buy", "p1"]]);
    const specific = buildOfferPayload("bxgy", { ...form, get_mode: "specific_products" });
    expect(specific.items.map((i) => i.role)).toEqual(["buy", "get"]);
    expect(specific).toMatchObject({ buy_qty: 1, get_qty: 1, bundle_price: null, volume_min: null });
  });

  it("payload volume: hanya item eligible, angka dari teks berformat", () => {
    const form = withItems({ ...emptyOfferForm("volume"), volume_min: "5", discount_value: "3.000" }, ["eligible", "p1"], ["component", "p2"]);
    const payload = buildOfferPayload("volume", form);
    expect(payload.items.map((i) => i.role)).toEqual(["eligible"]);
    expect(payload).toMatchObject({ volume_min: 5, discount_value: 3000, discount_type: "percent", get_mode: null });
  });

  it("round-trip dari aturan tersimpan", () => {
    const form = offerFormFromRule(rule({ items: [{ id: "i1", role: "eligible", product_id: null, category_id: "c1", qty: "1", sort_order: 0 }] }));
    expect(form.items[0]).toMatchObject({ key: "i1", kind: "category", category_id: "c1", qty: "1" });
    expect(form.volume_min).toBe("5");
  });

  it("ringkasan tabel, periode, dan lencana batas", () => {
    expect(summarizeOffer(rule())).toBe("min qty 5 → 3%");
    expect(summarizeOffer(rule({ volume_basis: "spend", volume_min: "100000", discount_type: "fixed", discount_value: "3000" })))
      .toBe("min belanja 100.000 → Rp3.000");
    expect(summarizeOffer(rule({ offer_type: "bxgy", buy_qty: 2, get_qty: 1, get_mode: "specific_products" })))
      .toBe("Beli 2 gratis 1 (item spesifik)");
    expect(formatOfferWindow({ valid_from: "2026-10-01", valid_until: null })).toBe("2026-10-01 s/d …");
    expect(offerLimitBadges(rule({ is_exclusive: true, max_uses: 2, used_count: 2, sales_channels: ["pos", "gofood"] })))
      .toEqual([
        { label: "Eksklusif", variant: "ink" },
        { label: "Kuota 2/2", variant: "warning" },
        { label: "Kasir, GoFood", variant: "muted" },
      ]);
  });
});
