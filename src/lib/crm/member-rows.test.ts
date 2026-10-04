import { describe, expect, it } from "vitest";
import { normalizeCustomer, profileFields, syntheticMemberBase } from "./member-rows";

const customer = {
  id: "c0ffee00-0000-4000-8000-000000000001",
  name: null,
  phone: null,
  email: null,
  membership_tier: null,
  ark_coin_balance: "15000",
  total_xp: "120",
  total_spent: null,
  visit_count: "3",
  is_active: null,
};

describe("member-rows", () => {
  it("normalizeCustomer mengisi default dan angka", () => {
    expect(normalizeCustomer(customer)).toEqual({
      id: customer.id,
      name: "",
      phone: "",
      email: "",
      membership_tier: "regular",
      ark_coin_balance: 15000,
      total_xp: 120,
      total_spent: 0,
      visit_count: 3,
      is_active: true,
    });
  });

  it("member sintetis memakai id pos- dan kode dari telepon atau potongan id", () => {
    expect(syntheticMemberBase(normalizeCustomer(customer))).toMatchObject({
      id: `pos-${customer.id}`,
      member_code: "c0ffee00",
      tier: { code: "regular", name: "regular" },
      lifetime_xp: 120,
    });
    expect(syntheticMemberBase(normalizeCustomer({ ...customer, phone: "0812" })).member_code).toBe("0812");
  });

  it("profileFields menormalkan angka dan metadata kosong", () => {
    const fields = profileFields({
      id: "m1",
      customer_id: "c1",
      member_code: "ARK-1",
      tier_id: "t1",
      lifetime_xp: "50",
      loyalty_score: "50",
      active_avatar_id: null,
      joined_at: "2026-01-01",
      last_activity_at: null,
      status: "active",
      metadata: null as unknown as Record<string, unknown>,
    });
    expect(fields).toMatchObject({ lifetime_xp: 50, loyalty_score: 50, tier: null, metadata: {} });
  });
});
