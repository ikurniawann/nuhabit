/**
 * Wallpaper desktop Arkiv OS yang diunggah admin — disimpan sebagai JSON di
 * configuration.app_settings (key `desktop_wallpapers`), berkasnya di bucket
 * publik `desktop-wallpapers`. Helper murni tanpa DB/FS supaya mudah diuji.
 */

import type { CSSProperties } from "react";
import { brandName } from "@/lib/branding";

export const DESKTOP_WALLPAPERS_SETTING_KEY = "desktop_wallpapers";
export const DESKTOP_WALLPAPER_BUCKET = "desktop-wallpapers";
export const DESKTOP_WALLPAPER_MAX_BYTES = 8 * 1024 * 1024;
export const DESKTOP_WALLPAPER_MAX_ITEMS = 24;
export const DESKTOP_WALLPAPER_NAME_MAX = 60;

/** Wallpaper bawaan maupun unggahan memakai bentuk yang sama. */
export interface WallpaperItem {
  id: string;
  name: string;
  /** Path gambar ("/…") atau nilai CSS background (mis. linear-gradient). */
  src: string;
  custom?: boolean;
}

/**
 * Kunci localStorage pilihan wallpaper — dibaca desktop DAN halaman login.
 * Login berjalan sebelum ada sesi, jadi localStorage satu-satunya sinyal
 * pilihan user di perangkat itu (preferensi server butuh user terautentikasi).
 */
export const WALLPAPER_STORAGE_KEY = "arkiv-wallpaper";

/**
 * Wallpaper bawaan. Id-nya stabil karena itulah nilai yang tersimpan di
 * localStorage/user_desktop_prefs — mengganti id akan mereset pilihan user.
 */
export const BUILTIN_WALLPAPERS: WallpaperItem[] = [
  // NüHabit graphic language (DESIGN.md §5): sapuan "Nü" besar, outline, dan pattern.
  { id: "arkiv", name: `${brandName()} Forest`, src: "/brand/wallpaper-forest.webp" },
  { id: "pink", name: "Lime Strokes", src: "/brand/wallpaper-ink.webp" },
  { id: "midnight", name: "Nü Pattern", src: "/brand/wallpaper-pattern.webp" },
  { id: "glass", name: "Everglade", src: "linear-gradient(135deg,#131a1c,#00281a 52%,#203b32)" },
];

export const DEFAULT_WALLPAPER: WallpaperItem = BUILTIN_WALLPAPERS[0];

/** Path gambar dipasang sebagai backgroundImage; selain itu nilai background CSS. */
export function wallpaperBackgroundStyle(src: string): CSSProperties {
  return src.startsWith("/") ? { backgroundImage: `url('${src}')` } : { background: src };
}

/** Resolve id tersimpan ke wallpaper; fallback ke bawaan pertama. */
export function resolveWallpaper(
  id: string | null | undefined,
  extra: WallpaperItem[] = []
): WallpaperItem {
  if (!id) return DEFAULT_WALLPAPER;
  return [...BUILTIN_WALLPAPERS, ...extra].find((item) => item.id === id) ?? DEFAULT_WALLPAPER;
}

export interface DesktopWallpaper {
  id: string;
  name: string;
  /** URL publik gambar (/api/files/desktop-wallpapers/…). */
  src: string;
  created_at: string;
  created_by?: string | null;
}

export function parseDesktopWallpapers(raw: string | null | undefined): DesktopWallpaper[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is DesktopWallpaper =>
          !!item &&
          typeof item === "object" &&
          typeof (item as DesktopWallpaper).id === "string" &&
          typeof (item as DesktopWallpaper).src === "string" &&
          typeof (item as DesktopWallpaper).name === "string"
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        src: item.src,
        created_at: typeof item.created_at === "string" ? item.created_at : new Date(0).toISOString(),
        created_by: item.created_by ?? null,
      }));
  } catch {
    return [];
  }
}

export function serializeDesktopWallpapers(items: DesktopWallpaper[]): string {
  return JSON.stringify(items);
}

/** Nama tampilan: dari input admin, atau nama berkas tanpa ekstensi. */
export function normalizeWallpaperName(input: string | null | undefined, fileName: string): string {
  const fromInput = (input ?? "").trim();
  if (fromInput) return fromInput.slice(0, DESKTOP_WALLPAPER_NAME_MAX);
  const base = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  return (base || "Wallpaper").slice(0, DESKTOP_WALLPAPER_NAME_MAX);
}

export function addDesktopWallpaper(
  items: DesktopWallpaper[],
  next: DesktopWallpaper
): { ok: true; items: DesktopWallpaper[] } | { ok: false; error: string } {
  if (items.length >= DESKTOP_WALLPAPER_MAX_ITEMS) {
    return { ok: false, error: `Maksimal ${DESKTOP_WALLPAPER_MAX_ITEMS} wallpaper — hapus yang lama dulu` };
  }
  if (items.some((item) => item.id === next.id)) {
    return { ok: false, error: "ID wallpaper sudah dipakai" };
  }
  return { ok: true, items: [next, ...items] };
}

export function removeDesktopWallpaper(
  items: DesktopWallpaper[],
  id: string
): { items: DesktopWallpaper[]; removed: DesktopWallpaper | null } {
  const removed = items.find((item) => item.id === id) ?? null;
  return { items: items.filter((item) => item.id !== id), removed };
}
