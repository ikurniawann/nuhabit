import type { SaveWallpaperPayload, Tier, Wallpaper, WallpapersListResult } from "./types";
import { parseCrmResponse } from "../http";

export type * from "./types";

export function buildWallpaperPayload(
  wallpaper: Wallpaper,
  overrides: Partial<Wallpaper> = {}
): SaveWallpaperPayload {
  const next = { ...wallpaper, ...overrides };
  return {
    id: next.id,
    code: next.code,
    name: next.name,
    rarity: next.rarity,
    image_url: next.image_url,
    thumbnail_url: next.thumbnail_url || null,
    min_lifetime_xp: next.min_lifetime_xp == null ? null : Math.max(0, Number(next.min_lifetime_xp) || 0),
    required_tier_id: next.required_tier_id || null,
    stock_total: next.stock_total == null ? null : Math.max(1, Number(next.stock_total) || 1),
    is_active: next.is_active,
    starts_at: next.starts_at || null,
    ends_at: next.ends_at || null,
  };
}

export async function listWallpapers(): Promise<WallpapersListResult> {
  const [wallpapersResponse, tiersResponse] = await Promise.all([
    fetch("/api/crm/wallpapers", { cache: "no-store" }),
    fetch("/api/crm/tiers", { cache: "no-store" }),
  ]);

  const [wallpapersJson, tiersJson] = await Promise.all([
    parseCrmResponse<{ data: Wallpaper[] }>(wallpapersResponse, "Gagal memuat wallpaper"),
    parseCrmResponse<{ data: Tier[] }>(tiersResponse, "Gagal memuat tier"),
  ]);

  return {
    wallpapers: wallpapersJson.data ?? [],
    tiers: tiersJson.data ?? [],
  };
}

export async function saveWallpaper(payload: SaveWallpaperPayload): Promise<void> {
  const response = await fetch("/api/crm/wallpapers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await parseCrmResponse(response, "Gagal menyimpan wallpaper");
}

export async function deleteWallpaper(id: string): Promise<{ message?: string }> {
  const response = await fetch(`/api/crm/wallpapers?id=${id}`, { method: "DELETE" });
  return parseCrmResponse<{ message?: string }>(response, "Gagal hapus wallpaper");
}
