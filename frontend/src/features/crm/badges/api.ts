import type { Badge, BadgesListResult, SaveBadgePayload } from "./types";
import { parseCrmResponse } from "../http";

export type * from "./types";

export function buildBadgePayload(badge: Badge, overrides: Partial<Badge> = {}): SaveBadgePayload {
  const next = { ...badge, ...overrides };
  const threshold = Number(next.threshold);
  return {
    id: next.id,
    code: next.code,
    name: next.name,
    image_url: next.image_url || null,
    metric: next.metric,
    min_lifetime_xp: Math.max(0, Number(next.min_lifetime_xp) || 0),
    threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : null,
    bonus_xp: Math.max(0, Number(next.bonus_xp) || 0),
    is_active: next.is_active,
  };
}

export async function listBadges(): Promise<BadgesListResult> {
  const response = await fetch("/api/crm/badges", { cache: "no-store" });
  const json = await parseCrmResponse<{ data: Badge[] }>(response, "Gagal memuat badge");
  return { badges: json.data ?? [] };
}

export async function saveBadge(payload: SaveBadgePayload): Promise<void> {
  const response = await fetch("/api/crm/badges", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await parseCrmResponse(response, "Gagal menyimpan badge");
}

export async function deleteBadge(id: string): Promise<{ message?: string }> {
  const response = await fetch(`/api/crm/badges?id=${id}`, { method: "DELETE" });
  return parseCrmResponse<{ message?: string }>(response, "Gagal hapus badge");
}
