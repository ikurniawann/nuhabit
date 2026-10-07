import { describe, expect, it } from "vitest";
import {
  evaluateOfferRules,
  expandCategoryTargets,
  offerCapReason,
  offerSkipReason,
  type OfferCartLine,
  type OfferEvalRule,
} from "./offer-evaluate";

const LATTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAKE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const COFFEE_CAT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const cart: OfferCartLine[] = [
  { productId: LATTE, quantity: 2, unitPrice: 40_000 },
  { productId: CAKE, quantity: 1, unitPrice: 30_000 },
];

const volume = (patch: Partial<OfferEvalRule> = {}): OfferEvalRule => ({
  id: "vol",
  offer_type: "volume",
  name: "Volume 10%",
  volume_basis: "qty",
  volume_min: 1,
  discount_type: "percent",
  discount_value: 10,
  items: [],
  ...patch,
});

const bundle = (patch: Partial<OfferEvalRule> = {}): OfferEvalRule => ({
  id: "bundle",
  offer_type: "bundle",
  name: "Latte + Cake",
  bundle_price: 55_000,
  items: [
    { role: "component", product_id: LATTE, qty: 1 },
    { role: "component", product_id: CAKE, qty: 1 },
  ],
  ...patch,
});

const bogo = (patch: Partial<OfferEvalRule> = {}): OfferEvalRule => ({
  id: "bogo",
  offer_type: "bxgy",
  name: "Latte B1G1",
  buy_qty: 1,
  get_qty: 1,
  get_mode: "same_as_buy",
  items: [{ role: "buy", product_id: LATTE, qty: 1 }],
  ...patch,
});

describe("stacking — eksklusif vs gabungan (port promotions.go)", () => {
  it("non-eksklusif digabung", () => {
    // bundle 70k→55k = 15k; volume 10% dari 110k = 11k
    const result = evaluateOfferRules(cart, [bundle(), volume()]);
    expect(result.applied.map((a) => a.rule_id).sort()).toEqual(["bundle", "vol"]);
    expect(result.offer_discount).toBe(26_000);
  });

  it("eksklusif kalah bila gabungan lain lebih hemat", () => {
    const result = evaluateOfferRules(cart, [
      bundle(),
      volume(),
      volume({ id: "ex", name: "Eksklusif 20%", discount_value: 20, is_exclusive: true }),
    ]);
    // eksklusif 22k < gabungan 26k
    expect(result.applied.map((a) => a.rule_id).sort()).toEqual(["bundle", "vol"]);
    expect(result.offer_discount).toBe(26_000);
  });

  it("eksklusif menang sendirian bila lebih hemat dan memblok yang lain", () => {
    const result = evaluateOfferRules(cart, [
      bundle(),
      volume(),
      volume({ id: "ex", name: "Eksklusif 30%", discount_value: 30, is_exclusive: true }),
    ]);
    expect(result.applied.map((a) => a.rule_id)).toEqual(["ex"]);
    expect(result.offer_discount).toBe(33_000);
  });

  it("seri = eksklusif menang", () => {
    const result = evaluateOfferRules(cart, [
      volume({ id: "a", discount_type: "fixed", discount_value: 10_000 }),
      volume({ id: "ex", discount_type: "fixed", discount_value: 10_000, is_exclusive: true }),
    ]);
    expect(result.applied.map((a) => a.rule_id)).toEqual(["ex"]);
  });

  it("di antara eksklusif, prioritas tertinggi dipilih lebih dulu", () => {
    const result = evaluateOfferRules(cart, [
      volume({ id: "big", discount_value: 30, is_exclusive: true, priority: 0 }),
      volume({ id: "vip", discount_value: 20, is_exclusive: true, priority: 5 }),
    ]);
    expect(result.applied.map((a) => a.rule_id)).toEqual(["vip"]);
    expect(result.offer_discount).toBe(22_000);
  });

  it("eksklusif tanpa diskon tidak memblok apa pun", () => {
    const result = evaluateOfferRules(cart, [
      volume(),
      volume({ id: "ex", volume_min: 99, is_exclusive: true }),
    ]);
    expect(result.applied.map((a) => a.rule_id)).toEqual(["vol"]);
  });
});

describe("prioritas di kelompok gabungan", () => {
  it("default (prioritas sama) = diskon terbesar dulu, perilaku lama", () => {
    // bogo (40k) dan bundle (15k) berebut 1 latte kedua → bogo menang
    const result = evaluateOfferRules(cart, [bundle(), bogo()]);
    expect(result.applied.map((a) => a.rule_id)).toEqual(["bogo"]);
    expect(result.offer_discount).toBe(40_000);
  });

  it("prioritas lebih tinggi memesan qty lebih dulu walau diskonnya lebih kecil", () => {
    const result = evaluateOfferRules(cart, [bundle({ priority: 10 }), bogo()]);
    expect(result.applied.map((a) => a.rule_id)).toEqual(["bundle"]);
    expect(result.offer_discount).toBe(15_000);
  });

  it("dua volume: hanya volume terbaik yang dipakai", () => {
    const result = evaluateOfferRules(cart, [
      volume({ id: "v5", discount_value: 5 }),
      volume({ id: "v10", discount_value: 10 }),
    ]);
    expect(result.applied.map((a) => a.rule_id)).toEqual(["v10"]);
  });

  it("total diskon tidak pernah melebihi subtotal", () => {
    const result = evaluateOfferRules(
      [{ productId: LATTE, quantity: 1, unitPrice: 10_000 }],
      [
        volume({ id: "a", discount_type: "fixed", discount_value: 8_000 }),
        bogo({ id: "b", get_mode: "specific_products", items: [
          { role: "buy", product_id: LATTE, qty: 1 },
          { role: "get", product_id: LATTE, qty: 1 },
        ] }),
      ]
    );
    expect(result.offer_discount).toBeLessThanOrEqual(10_000);
  });
});

describe("kuota", () => {
  it("kuota total habis → dilewati", () => {
    const rule = volume({ max_uses: 100, used_count: 100 });
    expect(offerSkipReason(rule)).toBe("kuota-habis");
    expect(evaluateOfferRules(cart, [rule]).applied).toEqual([]);
  });

  it("kuota total belum habis → dipakai", () => {
    expect(evaluateOfferRules(cart, [volume({ max_uses: 100, used_count: 99 })]).applied).toHaveLength(1);
  });

  it("kuota per member", () => {
    expect(offerCapReason({ max_uses_per_member: 1, member_used_count: 1 })).toBe("limit-member");
    expect(offerCapReason({ max_uses_per_member: 2, member_used_count: 1 })).toBeNull();
  });

  it("tanpa member, pemakaian member dihitung 0 (pola promotions.go)", () => {
    expect(offerSkipReason(volume({ max_uses_per_member: 1 }))).toBeNull();
  });

  it("kuota total dicek sebelum kuota member", () => {
    expect(
      offerCapReason({ max_uses: 1, used_count: 1, max_uses_per_member: 1, member_used_count: 1 })
    ).toBe("kuota-habis");
  });
});

describe("channel", () => {
  it("channel kosong = semua channel", () => {
    expect(offerSkipReason(volume({ sales_channels: [] }), { channel: "gofood" })).toBeNull();
    expect(offerSkipReason(volume({ sales_channels: null }), { channel: "pos" })).toBeNull();
  });

  it("channel tidak terdaftar dilewati", () => {
    const rule = volume({ sales_channels: ["self_order"] });
    expect(offerSkipReason(rule, { channel: "pos" })).toBe("channel");
    expect(evaluateOfferRules(cart, [rule], { channel: "pos" }).applied).toEqual([]);
    expect(evaluateOfferRules(cart, [rule], { channel: "self_order" }).applied).toHaveLength(1);
  });
});

describe("penawaran ber-kode", () => {
  const coded = volume({ id: "kode", requires_code: true, discount_value: 15 });

  it("tidak aktif tanpa kode", () => {
    expect(offerSkipReason(coded)).toBe("kode");
    expect(evaluateOfferRules(cart, [coded]).offer_discount).toBe(0);
  });

  it("aktif setelah kode dibuka kasir", () => {
    const result = evaluateOfferRules(cart, [coded], { unlockedRuleIds: ["kode"] });
    expect(result.applied.map((a) => a.rule_id)).toEqual(["kode"]);
    expect(result.offer_discount).toBe(16_500);
  });

  it("membuka satu kode tidak membuka penawaran ber-kode lain", () => {
    const other = volume({ id: "lain", requires_code: true });
    const result = evaluateOfferRules(cart, [coded, other], { unlockedRuleIds: ["kode"] });
    expect(result.applied.map((a) => a.rule_id)).toEqual(["kode"]);
  });

  it("penawaran ber-kode tetap tunduk pada aturan eksklusif", () => {
    const result = evaluateOfferRules(
      cart,
      [volume({ id: "ex", discount_value: 50, is_exclusive: true }), coded],
      { unlockedRuleIds: ["kode"] }
    );
    expect(result.applied.map((a) => a.rule_id)).toEqual(["ex"]);
  });
});

describe("target kategori", () => {
  const byCategory = new Map([[COFFEE_CAT, [LATTE, TEA]]]);

  it("volume per kategori hanya menghitung item kategori itu", () => {
    const [rule] = expandCategoryTargets(
      [volume({ items: [{ role: "eligible", product_id: "", category_id: COFFEE_CAT, qty: 1 }] })],
      byCategory
    );
    // latte 2×40k = 80k → 10% = 8k (cake tidak ikut)
    expect(evaluateOfferRules(cart, [rule!]).offer_discount).toBe(8_000);
  });

  it("BXGY dgn pool beli berupa kategori", () => {
    const [rule] = expandCategoryTargets(
      [bogo({ items: [{ role: "buy", product_id: "", category_id: COFFEE_CAT, qty: 1 }] })],
      byCategory
    );
    const result = evaluateOfferRules(
      [
        { productId: LATTE, quantity: 1, unitPrice: 40_000 },
        { productId: TEA, quantity: 1, unitPrice: 25_000 },
      ],
      [rule!]
    );
    // gratis yang termurah dari pool kategori
    expect(result.offer_discount).toBe(25_000);
  });

  it("kategori kosong tidak jatuh ke 'semua item'", () => {
    const [rule] = expandCategoryTargets(
      [volume({ items: [{ role: "eligible", product_id: "", category_id: "kosong", qty: 1 }] })],
      byCategory
    );
    expect(evaluateOfferRules(cart, [rule!]).offer_discount).toBe(0);
  });

  it("produk dan kategori digabung tanpa duplikat", () => {
    const [rule] = expandCategoryTargets(
      [
        volume({
          items: [
            { role: "eligible", product_id: LATTE, qty: 1 },
            { role: "eligible", product_id: "", category_id: COFFEE_CAT, qty: 1 },
          ],
        }),
      ],
      byCategory
    );
    expect(rule!.items.map((i) => i.product_id)).toEqual([LATTE, TEA]);
  });

  it("aturan tanpa kategori dikembalikan apa adanya", () => {
    const original = bundle();
    expect(expandCategoryTargets([original], byCategory)[0]).toBe(original);
  });
});
