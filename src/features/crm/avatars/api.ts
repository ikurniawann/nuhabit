import type { Avatar, AvatarsListParams, AvatarsListResult, SaveAvatarPayload } from "./types";
import { parseCrmResponse } from "../http";

export type * from "./types";

export function buildAvatarPayload(avatar: Avatar, overrides: Partial<Avatar> = {}): SaveAvatarPayload {
  const next = { ...avatar, ...overrides };
  return {
    code: next.code,
    name: next.name,
    rarity: next.rarity,
    image_url: next.image_url,
    thumbnail_url: next.thumbnail_url || null,
    required_tier_id: next.required_tier_id || null,
    xp_cost: Math.max(0, Number(next.xp_cost) || 0),
    stock_total: next.stock_total == null ? null : Math.max(0, Number(next.stock_total) || 0),
    stock_redeemed: Math.max(0, Number(next.stock_redeemed) || 0),
    starts_at: null,
    ends_at: null,
    is_active: next.is_active,
    metadata: {},
  };
}

export async function listAvatars(params: AvatarsListParams = {}): Promise<AvatarsListResult> {
  const sp = new URLSearchParams();
  if (params.rarity && params.rarity !== "all") {
    sp.set("rarity", params.rarity);
  }

  const [avatarsResponse, tiersResponse] = await Promise.all([
    fetch(`/api/crm/avatars${sp.toString() ? `?${sp.toString()}` : ""}`, { cache: "no-store" }),
    fetch("/api/crm/tiers", { cache: "no-store" }),
  ]);

  const [avatarsJson, tiersJson] = await Promise.all([
    parseCrmResponse<{ data: Avatar[] }>(avatarsResponse, "Gagal memuat avatar"),
    parseCrmResponse<{ data: AvatarsListResult["tiers"] }>(tiersResponse, "Gagal memuat tier"),
  ]);

  return {
    avatars: avatarsJson.data ?? [],
    tiers: tiersJson.data ?? [],
  };
}

export async function saveAvatar(payload: SaveAvatarPayload): Promise<void> {
  const response = await fetch("/api/crm/avatars", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await parseCrmResponse(response, "Gagal menyimpan avatar");
}

export async function deleteAvatar(id: string): Promise<void> {
  const response = await fetch(`/api/crm/avatars?id=${id}`, { method: "DELETE" });
  await parseCrmResponse(response, "Gagal hapus avatar");
}
