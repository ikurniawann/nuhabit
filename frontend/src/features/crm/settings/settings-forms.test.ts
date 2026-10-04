import { describe, expect, it } from "vitest";
import {
  EMPTY_RULE_FORM,
  filterProducts,
  ruleFormToPayload,
  ruleToForm,
  tierFormToPayload,
  tierToForm,
  topupSettingsPayload,
} from "./settings-forms";
import type { CrmTierConfig, CrmXpRuleConfig, PosProductXp } from "./types";

const tier: CrmTierConfig = {
  code: "gold",
  name: "Gold",
  rank: 2,
  min_lifetime_xp: 1000,
  min_total_spend: 250000,
  xp_multiplier: 1.5,
  discount_percent: 10,
  display_color: "#FFD700",
  is_active: true,
};

const rule: CrmXpRuleConfig = {
  code: "pos-order",
  name: "XP per belanja",
  source_channel: "pos",
  source_type: "order_amount",
  xp_mode: "per_amount",
  xp_value: 1,
  amount_step: 1000,
  min_amount: 0,
  max_xp_per_event: null,
  tier_multiplier_enabled: true,
  priority: 100,
  is_active: true,
};

describe("settings forms", () => {
  it("round-trips a tier and keeps fields the form does not edit", () => {
    const form = tierToForm(tier);
    expect(form).toEqual({
      code: "gold",
      name: "Gold",
      rank: 2,
      min_lifetime_xp: "1000",
      discount_percent: "10",
      xp_multiplier: "1.5",
      is_active: true,
    });
    expect(tierFormToPayload({ ...form, name: "  Gold+ " }, tier)).toEqual({ ...tier, name: "Gold+" });
  });

  it("falls back to safe tier defaults for blank inputs", () => {
    const payload = tierFormToPayload(
      { code: "x", name: "X", rank: 0, min_lifetime_xp: "", discount_percent: "", xp_multiplier: "", is_active: false },
      undefined
    );
    expect(payload).toMatchObject({ min_lifetime_xp: 0, min_total_spend: 0, xp_multiplier: 1, discount_percent: 0 });
    expect(payload.display_color).toBeUndefined();
  });

  it("round-trips an XP rule", () => {
    const form = ruleToForm(rule);
    expect(form.max_xp_per_event).toBe("");
    expect(ruleFormToPayload(form)).toEqual(rule);
  });

  it("normalises a new rule code and parses the max cap", () => {
    const payload = ruleFormToPayload({ ...EMPTY_RULE_FORM, code: "  POS-New ", name: " Baru ", max_xp_per_event: "50" });
    expect(payload).toMatchObject({ code: "pos-new", name: "Baru", max_xp_per_event: 50, amount_step: 1000 });
  });

  it("clamps topup bonus and floors free XP", () => {
    expect(topupSettingsPayload("150", "12.7")).toEqual({ topup_bonus_percent: 100, profile_completion_free_xp: 12 });
    expect(topupSettingsPayload("-5", "abc")).toEqual({ topup_bonus_percent: 0, profile_completion_free_xp: 0 });
  });

  it("filters products by name, SKU, or category", () => {
    const products: PosProductXp[] = [
      { id: "1", sku: "KOP-01", name: "Kopi Susu", base_price: 20000, xp: 0, category: { name: "Minuman" } },
      { id: "2", sku: "ROT-01", name: "Roti", base_price: 15000, xp: 5, category: null },
    ];
    expect(filterProducts(products, "")).toHaveLength(2);
    expect(filterProducts(products, "rot").map((p) => p.id)).toEqual(["2"]);
    expect(filterProducts(products, "minum").map((p) => p.id)).toEqual(["1"]);
    expect(filterProducts(products, "KOP").map((p) => p.id)).toEqual(["1"]);
  });
});
