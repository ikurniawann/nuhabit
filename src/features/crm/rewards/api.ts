import type {
  ClaimMemberOption,
  Redemption,
  RedemptionsListParams,
  Reward,
  RewardsListParams,
  RewardsListResult,
  SaveRewardPayload,
} from "./types";
import { parseCrmResponse } from "../http";

export type * from "./types";

export function buildRewardPayload(reward: Reward, overrides: Partial<Reward> = {}): SaveRewardPayload {
  const next = { ...reward, ...overrides };
  return {
    code: next.code,
    name: next.name,
    reward_type: next.reward_type,
    min_xp: Math.max(0, Number(next.min_xp) || 0),
    required_tier_id: next.required_tier_id || null,
    linked_avatar_id: null,
    stock_total: next.stock_total == null ? null : Math.max(0, Number(next.stock_total) || 0),
    stock_redeemed: Math.max(0, Number(next.stock_redeemed) || 0),
    max_redemptions_per_member: next.max_redemptions_per_member == null
      ? null
      : Math.max(1, Number(next.max_redemptions_per_member) || 1),
    quota_period: next.quota_period ?? "total",
    image_url: next.image_url || null,
    reward_data: next.reward_data ?? {},
    starts_at: next.starts_at ?? null,
    ends_at: next.ends_at ?? null,
    is_active: next.is_active,
  };
}

export async function listRewards(params: RewardsListParams = {}): Promise<RewardsListResult> {
  const sp = new URLSearchParams();
  if (params.reward_type && params.reward_type !== "all") {
    sp.set("reward_type", params.reward_type);
  }

  const [rewardsResponse, tiersResponse] = await Promise.all([
    fetch(`/api/crm/rewards${sp.toString() ? `?${sp.toString()}` : ""}`, { cache: "no-store" }),
    fetch("/api/crm/tiers", { cache: "no-store" }),
  ]);

  const [rewardsJson, tiersJson] = await Promise.all([
    parseCrmResponse<{ data: Reward[] }>(rewardsResponse, "Gagal memuat rewards"),
    parseCrmResponse<{ data: RewardsListResult["tiers"] }>(tiersResponse, "Gagal memuat tiers"),
  ]);

  return {
    rewards: rewardsJson.data ?? [],
    tiers: tiersJson.data ?? [],
  };
}

export async function saveReward(payload: SaveRewardPayload): Promise<void> {
  const response = await fetch("/api/crm/rewards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await parseCrmResponse(response, "Gagal menyimpan reward");
}

export async function deleteReward(id: string): Promise<void> {
  const response = await fetch(`/api/crm/rewards?id=${id}`, { method: "DELETE" });
  await parseCrmResponse(response, "Gagal hapus reward");
}

export async function listRedemptions(params: RedemptionsListParams = {}): Promise<Redemption[]> {
  const sp = new URLSearchParams();
  if (params.status && params.status !== "all") sp.set("status", params.status);

  const response = await fetch(
    `/api/crm/redemptions${sp.toString() ? `?${sp.toString()}` : ""}`,
    { cache: "no-store" }
  );
  const json = await parseCrmResponse<{ data: Redemption[] }>(
    response,
    "Gagal memuat permintaan redeem"
  );
  return json.data ?? [];
}

/** Kandidat member untuk klaim reward di venue oleh kasir/admin. */
export async function searchClaimMembers(term: string): Promise<ClaimMemberOption[]> {
  const sp = new URLSearchParams({ limit: "10" });
  if (term.trim()) sp.set("search", term.trim());

  const response = await fetch(`/api/crm/members?${sp.toString()}`, { cache: "no-store" });
  const json = await parseCrmResponse<{
    data: {
      customer_id: string;
      customer: { name: string; phone: string; total_xp: number } | null;
    }[];
  }>(response, "Gagal mencari member");

  return (json.data ?? [])
    .filter((member) => Boolean(member.customer_id))
    .map((member) => ({
      customer_id: member.customer_id,
      name: member.customer?.name ?? "Member",
      phone: member.customer?.phone ?? "",
      total_xp: Number(member.customer?.total_xp) || 0,
    }));
}

/** Kasir/admin mengklaim reward atas nama member — langsung fulfilled. */
export async function claimRedemption(payload: {
  customer_id: string;
  reward_id: string;
}): Promise<void> {
  const response = await fetch("/api/crm/redemptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await parseCrmResponse(response, "Gagal klaim reward");
}

export async function updateRedemption(payload: {
  id: string;
  action: "approve" | "fulfill" | "cancel";
}): Promise<void> {
  const response = await fetch("/api/crm/redemptions", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await parseCrmResponse(response, "Gagal memperbarui permintaan redeem");
}
