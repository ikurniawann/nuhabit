/**
 * Preferensi desktop NüHabit OS per PENGGUNA (bukan per perangkat).
 *
 * Sebelumnya semuanya di localStorage, jadi ganti laptop = mulai dari nol.
 * Sekarang disimpan di configuration.user_desktop_prefs dan localStorage
 * hanya jadi cache supaya render pertama tidak berkedip.
 */

import { MONITOR_WIDGETS, type MonitorWidgetKey } from "@/lib/desktop/widgets";
import { STORAGE_KEYS, writeStorage } from "@/lib/storage-keys";


export interface DesktopPreferences {
  /** id wallpaper terpilih (bawaan atau unggahan). */
  wallpaper: string | null;
  widgetVisibility: Record<string, boolean>;
  widgetOrder: string[];
  soundEnabled: boolean;
  /** Periode papan monitor: hari-ini / bulan-berjalan / dst. */
  period: string | null;
}

export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  wallpaper: null,
  widgetVisibility: {},
  widgetOrder: [],
  soundEnabled: false,
  period: null,
};

// "calendar" bukan kartu monitor tapi ikut disimpan sebagai preferensi widget.
const WIDGET_KEYS: string[] = [...MONITOR_WIDGETS.map((w) => w.key as MonitorWidgetKey), "calendar"];

function asBoolRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    // Key widget asing dibuang: versi lama bisa menyimpan widget yang sudah tiada.
    if (typeof val === "boolean" && WIDGET_KEYS.includes(key)) out[key] = val;
  }
  return out;
}

export function normalizeDesktopPreferences(raw: unknown): DesktopPreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_DESKTOP_PREFERENCES };
  }
  const value = raw as Record<string, unknown>;
  const order = Array.isArray(value.widgetOrder)
    ? [...new Set(value.widgetOrder.filter((k): k is string => typeof k === "string" && WIDGET_KEYS.includes(k)))]
    : [];
  return {
    wallpaper: typeof value.wallpaper === "string" && value.wallpaper ? value.wallpaper : null,
    widgetVisibility: asBoolRecord(value.widgetVisibility),
    widgetOrder: order,
    soundEnabled: value.soundEnabled === true,
    period: typeof value.period === "string" && value.period ? value.period : null,
  };
}

/**
 * Server adalah sumber kebenaran, TAPI hanya untuk bagian yang benar-benar
 * pernah disimpan di sana — kalau tidak, akun baru akan menghapus pilihan
 * yang baru saja dibuat pengguna di perangkat ini.
 */
export function mergeDesktopPreferences(
  server: DesktopPreferences | null,
  local: DesktopPreferences | null
): DesktopPreferences {
  const base = local ? normalizeDesktopPreferences(local) : { ...DEFAULT_DESKTOP_PREFERENCES };
  if (!server) return base;
  const remote = normalizeDesktopPreferences(server);
  return {
    wallpaper: remote.wallpaper ?? base.wallpaper,
    widgetVisibility:
      Object.keys(remote.widgetVisibility).length > 0 ? remote.widgetVisibility : base.widgetVisibility,
    widgetOrder: remote.widgetOrder.length > 0 ? remote.widgetOrder : base.widgetOrder,
    soundEnabled: remote.soundEnabled,
    period: remote.period ?? base.period,
  };
}

/** Cache lokal; penyimpanan terkunci tidak apa-apa karena server tetap menyimpan. */
export function writeLocalPreferences(prefs: DesktopPreferences) {
  writeStorage(STORAGE_KEYS.desktopPrefs, JSON.stringify(prefs));
}
