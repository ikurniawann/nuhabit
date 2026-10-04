/**
 * Nama kunci localStorage. Kunci lama (arkiv-*, bcd-*) dibaca sekali saat
 * kunci baru masih kosong, lalu dipindah ke nama `nuhabit.` supaya pilihan
 * pengguna tidak hilang setelah penggantian nama.
 */

export interface StorageKey {
  readonly key: string;
  readonly legacy: string;
}

export const STORAGE_KEYS = {
  widgetVisibility: { key: "nuhabit.desktop.widget-visibility", legacy: "arkiv-widget-visibility" },
  widgetOrder: { key: "nuhabit.desktop.widget-order", legacy: "arkiv-widget-order" },
  soundEnabled: { key: "nuhabit.desktop.sound-enabled", legacy: "arkiv-sound-enabled" },
  wallpaper: { key: "nuhabit.desktop.wallpaper", legacy: "arkiv-wallpaper" },
  desktopPeriod: { key: "nuhabit.desktop.period", legacy: "arkiv-desktop-period" },
  desktopPrefs: { key: "nuhabit.desktop.prefs", legacy: "arkiv-desktop-prefs" },
  windowGeometry: { key: "nuhabit.desktop.window-geometry", legacy: "arkiv-window-geometry" },
  aiSession: { key: "nuhabit.assistant.session", legacy: "arkiv-ai-session" },
  // Pilihan model Do. Bila default model berpindah, ganti `key` (mis. akhiran
  // -v2) supaya semua browser kembali sekali ke default baru.
  aiSettings: { key: "nuhabit.assistant.settings", legacy: "arkiv-ai-assistant-settings-v2" },
  activityLogs: { key: "nuhabit.activity-logs", legacy: "arkivos_activity_logs" },
  tableOrderGuest: { key: "nuhabit.table-order.guest", legacy: "bcd-table-order-guest" },
  memberLang: { key: "nuhabit.member.lang", legacy: "bcd-member-lang" },
} as const satisfies Record<string, StorageKey>;

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // akses storage diblokir (mode privat / iframe sandbox)
  }
}

/** Baca kunci baru; bila kosong, ambil nilai kunci lama dan pindahkan. */
export function readStorage(def: StorageKey, storage: Storage | null = browserStorage()): string | null {
  if (!storage) return null;
  try {
    const current = storage.getItem(def.key);
    if (current !== null) return current;
    const legacy = storage.getItem(def.legacy);
    if (legacy === null) return null;
    try {
      storage.setItem(def.key, legacy);
      storage.removeItem(def.legacy);
    } catch {
      // Kuota penuh: nilai lama tetap dipakai, migrasi dicoba lagi lain kali.
    }
    return legacy;
  } catch {
    return null;
  }
}

export function writeStorage(def: StorageKey, value: string, storage: Storage | null = browserStorage()): void {
  try {
    storage?.setItem(def.key, value);
  } catch {
    // Mode privat / kuota penuh: pilihan berlaku untuk halaman ini saja.
  }
}

export function removeStorage(def: StorageKey, storage: Storage | null = browserStorage()): void {
  try {
    storage?.removeItem(def.key);
    storage?.removeItem(def.legacy);
  } catch {
    // abaikan: storage tidak bisa diakses
  }
}

/** Untuk kode yang membaca storage sendiri: migrasikan dulu, lalu pakai nama baru. */
export function migrateStorageKey(def: StorageKey, storage: Storage | null = browserStorage()): string {
  readStorage(def, storage);
  return def.key;
}
