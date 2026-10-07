import { describe, expect, it } from "vitest";
import { validateOfferRule, type OfferRuleInput } from "./offer-rules";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const CAT = "33333333-3333-4333-8333-333333333333";

const volume = (patch: Partial<OfferRuleInput> = {}): OfferRuleInput => ({
  offer_type: "volume",
  name: "Volume",
  volume_basis: "qty",
  volume_min: 2,
  discount_type: "percent",
  discount_value: 10,
  items: [],
  ...patch,
});

describe("validateOfferRule — target kategori", () => {
  it("baris boleh kategori untuk volume & BXGY", () => {
    expect(
      validateOfferRule(volume({ items: [{ role: "eligible", category_id: CAT }] }))
    ).toBeNull();
    expect(
      validateOfferRule({
        offer_type: "bxgy",
        name: "BOGO kopi",
        buy_qty: 1,
        get_qty: 1,
        items: [{ role: "buy", category_id: CAT }],
      })
    ).toBeNull();
  });

  it("baris wajib tepat satu dari produk / kategori", () => {
    expect(validateOfferRule(volume({ items: [{ role: "eligible" }] }))).toMatch(/produk ATAU kategori/);
    expect(
      validateOfferRule(volume({ items: [{ role: "eligible", product_id: A, category_id: CAT }] }))
    ).toMatch(/produk ATAU kategori/);
  });

  it("komponen bundling tidak boleh kategori", () => {
    expect(
      validateOfferRule({
        offer_type: "bundle",
        name: "Paket",
        bundle_price: 50_000,
        items: [
          { role: "component", product_id: A, qty: 1 },
          { role: "component", category_id: CAT, qty: 1 },
        ],
      })
    ).toMatch(/bukan kategori/);
  });
});

describe("validateOfferRule — batas & penggabungan", () => {
  it("menerima batas lengkap", () => {
    expect(
      validateOfferRule(
        volume({
          sales_channels: ["pos", "self_order"],
          max_uses: 100,
          max_uses_per_member: 1,
          is_exclusive: true,
          priority: 10,
          unlock_code: "NGOPI-HEMAT",
          items: [{ role: "eligible", product_id: B }],
        })
      )
    ).toBeNull();
  });

  it("channel tidak dikenal ditolak", () => {
    expect(validateOfferRule(volume({ sales_channels: ["tokopedia"] }))).toMatch(/Channel/);
  });

  it("kuota wajib bilangan bulat > 0", () => {
    expect(validateOfferRule(volume({ max_uses: 0 }))).toMatch(/Kuota total/);
    expect(validateOfferRule(volume({ max_uses_per_member: 1.5 }))).toMatch(/per member/);
  });

  it("prioritas 0–1000", () => {
    expect(validateOfferRule(volume({ priority: -1 }))).toMatch(/Prioritas/);
    expect(validateOfferRule(volume({ priority: 1001 }))).toMatch(/Prioritas/);
  });

  it("format kode pembuka", () => {
    expect(validateOfferRule(volume({ unlock_code: "AB" }))).toMatch(/Kode pembuka/);
    expect(validateOfferRule(volume({ unlock_code: "KODE SPASI" }))).toMatch(/Kode pembuka/);
    expect(validateOfferRule(volume({ unlock_code: "  " }))).toBeNull();
  });
});
