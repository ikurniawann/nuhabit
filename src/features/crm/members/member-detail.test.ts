import { describe, expect, it } from "vitest";
import {
  activeTiersOf,
  avatarStockLeft,
  buildAvatarActivity,
  editFormFromMember,
  findActiveAvatar,
  grantableAvatars,
  isCrmProfileReady,
  tierName,
  toUpdateMemberPayload,
  xpToTierRule,
} from "./member-detail";
import type { CrmAvatar, CrmAvatarInventory, CrmMember, CrmTier } from "./types";

const member = (patch: Partial<CrmMember> = {}): CrmMember => ({
  id: "m1",
  customer_id: "c1",
  member_code: "M-001",
  tier: { code: "gold", name: "Gold", min_lifetime_xp: 1000 },
  lifetime_xp: 400,
  loyalty_score: 0,
  status: "active",
  customer: {
    id: "c1",
    name: "Sari",
    phone: "0812",
    email: "sari@x.id",
    membership_tier: "silver",
    ark_coin_balance: 0,
    total_xp: 400,
    total_spent: 0,
    visit_count: 0,
    is_active: true,
    is_kol: true,
    kol_monthly_limit_idr: 500000,
  },
  ...patch,
});

const avatar = (id: string, patch: Partial<CrmAvatar> = {}): CrmAvatar => ({
  id,
  code: id,
  name: id.toUpperCase(),
  rarity: "rare",
  image_url: `/${id}.png`,
  thumbnail_url: null,
  required_tier_id: null,
  xp_cost: 0,
  stock_total: null,
  stock_redeemed: 0,
  is_active: true,
  required_tier: null,
  ...patch,
});

const owned = (id: string, avatarId: string, patch: Partial<CrmAvatarInventory> = {}): CrmAvatarInventory => ({
  id,
  member_id: "m1",
  avatar_id: avatarId,
  redemption_id: null,
  acquisition_source: "manual",
  is_equipped: false,
  acquired_at: "2026-01-01T00:00:00Z",
  metadata: null,
  avatar: avatar(avatarId),
  ...patch,
});

const tiers: CrmTier[] = [
  { id: "t1", code: "silver", name: "Silver", rank: 1, is_active: true },
  { id: "t2", code: "gold", name: "Gold", rank: 2, is_active: true },
  { id: "t3", code: "old", name: "Old", rank: 3, is_active: false },
];

describe("member detail helpers", () => {
  it("names the tier from member tier, customer tier, then Regular", () => {
    expect(tierName(member())).toBe("Gold");
    expect(tierName(member({ tier: null }))).toBe("silver");
    expect(tierName(member({ tier: null, customer: null }))).toBe("Regular");
  });

  it("treats pos- ids as not enrolled", () => {
    expect(isCrmProfileReady(member())).toBe(true);
    expect(isCrmProfileReady(member({ id: "pos-c1" }))).toBe(false);
  });

  it("keeps only active tiers", () => {
    expect(activeTiersOf(tiers).map((t) => t.code)).toEqual(["silver", "gold"]);
  });

  it("prefers the equipped avatar, then the member's active_avatar_id", () => {
    const inventory = [owned("i1", "a"), owned("i2", "b")];
    expect(findActiveAvatar(member({ active_avatar_id: "b" }), inventory)?.id).toBe("i2");
    inventory[0].is_equipped = true;
    expect(findActiveAvatar(member({ active_avatar_id: "b" }), inventory)?.id).toBe("i1");
    expect(findActiveAvatar(member(), [])).toBeNull();
  });

  it("lists active, unowned avatars sorted by name", () => {
    const list = grantableAvatars(
      [avatar("c"), avatar("a"), avatar("b", { is_active: false }), avatar("d")],
      [owned("i1", "d")]
    );
    expect(list.map((a) => a.id)).toEqual(["a", "c"]);
  });

  it("computes remaining stock, null when unlimited", () => {
    expect(avatarStockLeft(null)).toBeNull();
    expect(avatarStockLeft(avatar("a"))).toBeNull();
    expect(avatarStockLeft(avatar("a", { stock_total: 5, stock_redeemed: 2 }))).toBe(3);
    expect(avatarStockLeft(avatar("a", { stock_total: 1, stock_redeemed: 4 }))).toBe(0);
  });

  it("builds avatar activity newest first with tones and the active entry", () => {
    const activity = buildAvatarActivity([
      owned("i1", "a", { acquisition_source: "redemption", acquired_at: "2026-01-01T00:00:00Z", metadata: { xp_cost: 1500 } }),
      owned("i2", "b", { acquisition_source: "campaign", acquired_at: "2026-02-01T00:00:00Z", is_equipped: true }),
    ]);
    expect(activity.map((a) => a.id)).toEqual(["active-i2", "acquired-i2", "acquired-i1"]);
    expect(activity[1]).toMatchObject({ title: "Campaign grant: B", tone: "amber" });
    expect(activity[2]).toMatchObject({ tone: "emerald", detail: "rare · 1.500 XP" });
  });

  it("caps avatar activity at 12 rows", () => {
    const many = Array.from({ length: 20 }, (_, i) => owned(`i${i}`, `a${i}`));
    expect(buildAvatarActivity(many)).toHaveLength(12);
  });

  it("computes XP still needed for the tier rule", () => {
    expect(xpToTierRule(member())).toBe(600);
    expect(xpToTierRule(member({ lifetime_xp: 5000 }))).toBe(0);
    expect(xpToTierRule(member({ tier: null }))).toBe(0);
  });

  it("round-trips the edit form into the update payload", () => {
    const form = editFormFromMember(member(), activeTiersOf(tiers));
    expect(form).toEqual({
      name: "Sari",
      phone: "0812",
      email: "sari@x.id",
      tierId: "t2",
      status: "active",
      customerActive: true,
      isKol: true,
      kolLimit: "500000",
    });
    expect(toUpdateMemberPayload(form, true)).toEqual({
      customer: {
        name: "Sari",
        phone: "0812",
        email: "sari@x.id",
        is_active: true,
        is_kol: true,
        kol_monthly_limit_idr: 500000,
      },
      member: { tier_id: "t2", status: "active" },
    });
  });

  it("drops the member block for non-enrolled customers and blanks to null", () => {
    const payload = toUpdateMemberPayload(
      { name: "A", phone: "", email: "", tierId: "", status: "active", customerActive: false, isKol: false, kolLimit: "9" },
      false
    );
    expect(payload).toEqual({
      customer: { name: "A", phone: null, email: null, is_active: false, is_kol: false, kol_monthly_limit_idr: null },
      member: undefined,
    });
  });
});
