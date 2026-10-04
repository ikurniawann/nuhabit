import type { DesktopPreferences } from "@/lib/desktop/preferences";
import { DEFAULT_WALLPAPER, type WallpaperItem } from "@/lib/desktop/wallpapers";
import { normalizeWidgetOrder, type MonitorWidgetKey } from "@/lib/desktop/widgets";

/**
 * Preferensi tampilan desktop: tiga lapis yang ditimpa berurutan.
 * 1. lokal (localStorage perangkat ini) — render pertama tanpa berkedip,
 * 2. server (akun) — sumber kebenaran begitu termuat,
 * 3. pilihan pengguna di sesi ini — selalu menang.
 */

export type WidgetVisibility = { calendar: boolean } & Record<MonitorWidgetKey, boolean>;

export const DEFAULT_WIDGET_VISIBILITY: WidgetVisibility = {
  calendar: false,
  omzet: true,
  promo: true,
  tamu: true,
  pulsa: true,
  tim: true,
  keputusan: true,
  stok: true,
  member: true,
};

export interface LocalDesktopPrefs {
  wallpaperId: string | null;
  visibility: WidgetVisibility;
  order: MonitorWidgetKey[];
  soundEnabled: boolean;
}

export interface PrefOverrides {
  wallpaperId?: string;
  visibility?: Partial<WidgetVisibility>;
  order?: MonitorWidgetKey[];
  soundEnabled?: boolean;
}

export interface ResolvedDesktopPrefs {
  wallpaper: WallpaperItem;
  visibility: WidgetVisibility;
  order: MonitorWidgetKey[];
  soundEnabled: boolean;
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseLocalPrefs(raw: {
  wallpaper: string | null;
  visibility: string | null;
  order: string | null;
  sound: string | null;
}): LocalDesktopPrefs {
  const visibility = parseJson(raw.visibility);
  return {
    wallpaperId: raw.wallpaper,
    visibility: {
      ...DEFAULT_WIDGET_VISIBILITY,
      ...(visibility && typeof visibility === "object" && !Array.isArray(visibility) ? visibility : {}),
    },
    order: normalizeWidgetOrder(parseJson(raw.order)),
    soundEnabled: raw.sound === "true",
  };
}

export function resolveDesktopPrefs(
  local: LocalDesktopPrefs,
  server: DesktopPreferences | null,
  overrides: PrefOverrides,
  wallpapers: WallpaperItem[]
): ResolvedDesktopPrefs {
  // Id yang tidak (atau belum) ada di daftar dilewati: wallpaper unggahan
  // baru dikenali setelah daftarnya termuat.
  const wallpaper =
    [overrides.wallpaperId, server?.wallpaper, local.wallpaperId]
      .map((id) => (id ? wallpapers.find((item) => item.id === id) : undefined))
      .find(Boolean) ?? DEFAULT_WALLPAPER;
  return {
    wallpaper,
    visibility: {
      ...local.visibility,
      ...(server?.widgetVisibility ?? {}),
      ...overrides.visibility,
    } as WidgetVisibility,
    order:
      overrides.order ??
      (server && server.widgetOrder.length > 0 ? normalizeWidgetOrder(server.widgetOrder) : local.order),
    soundEnabled: overrides.soundEnabled ?? server?.soundEnabled ?? local.soundEnabled,
  };
}

/** Bentuk yang disimpan ke /api/desktop/preferences dan cache lokalnya. */
export function toDesktopPreferences(prefs: ResolvedDesktopPrefs): DesktopPreferences {
  return {
    wallpaper: prefs.wallpaper.id,
    widgetVisibility: prefs.visibility,
    widgetOrder: prefs.order,
    soundEnabled: prefs.soundEnabled,
    period: null,
  };
}

/** Geser satu langkah ke atas/bawah; di ujung daftar tidak berubah (null). */
export function moveWidget(
  order: MonitorWidgetKey[],
  key: MonitorWidgetKey,
  direction: -1 | 1
): MonitorWidgetKey[] | null {
  const index = order.indexOf(key);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return null;
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Pindah satu widget ke posisi baru (drag & drop); indeks tak valid → null. */
export function reorderWidget(order: MonitorWidgetKey[], from: number, to: number): MonitorWidgetKey[] | null {
  if (from === to || from < 0 || to < 0) return null;
  if (from >= order.length || to >= order.length) return null;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
