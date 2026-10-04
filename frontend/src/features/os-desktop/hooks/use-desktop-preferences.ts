"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { normalizeDesktopPreferences, writeLocalPreferences, type DesktopPreferences } from "@/lib/desktop/preferences";
import { BUILTIN_WALLPAPERS, DEFAULT_WALLPAPER, type WallpaperItem } from "@/lib/desktop/wallpapers";
import type { MonitorWidgetKey } from "@/lib/desktop/widgets";
import { STORAGE_KEYS, readStorage, writeStorage } from "@/lib/storage-keys";
import {
  parseLocalPrefs,
  resolveDesktopPrefs,
  toDesktopPreferences,
  type PrefOverrides,
  type WidgetVisibility,
} from "../lib/preferences";
import { useCustomWallpapers } from "./use-wallpapers";

const SAVE_DELAY_MS = 900; // menggeser urutan widget tidak boleh jadi badai request

function readLocalDesktopPrefs() {
  return parseLocalPrefs({
    wallpaper: readStorage(STORAGE_KEYS.wallpaper),
    visibility: readStorage(STORAGE_KEYS.widgetVisibility),
    order: readStorage(STORAGE_KEYS.widgetOrder),
    sound: readStorage(STORAGE_KEYS.soundEnabled),
  });
}

/**
 * Wallpaper, widget, dan suara desktop. Preferensi ikut AKUN: server jadi
 * sumber kebenaran, localStorage tinggal cache supaya render pertama tidak
 * berkedip saat ganti perangkat. Setiap perubahan disimpan ke keduanya.
 */
export function useDesktopPreferences(isLoggedIn: boolean) {
  const [local] = useState(readLocalDesktopPrefs);
  const [overrides, setOverrides] = useState<PrefOverrides>({});
  const saveTimer = useRef<number | undefined>(undefined);
  const customWallpapers = useCustomWallpapers();
  const wallpapers = useMemo(() => [...BUILTIN_WALLPAPERS, ...customWallpapers], [customWallpapers]);

  const server = useQuery({
    queryKey: ["os-desktop", "preferences"],
    queryFn: async (): Promise<DesktopPreferences | null> => {
      const res = await fetch("/api/desktop/preferences");
      const json = res.ok ? await res.json() : null;
      return json?.data ? normalizeDesktopPreferences(json.data) : null;
    },
    enabled: isLoggedIn,
    staleTime: Infinity,
    retry: false,
  });
  const serverPrefs = server.data ?? null;
  // Server tak terjangkau tetap "siap": pilihan lokal tetap disimpan.
  const canSync = isLoggedIn && (server.isSuccess || server.isError);

  const prefs = resolveDesktopPrefs(local, serverPrefs, overrides, wallpapers);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const update = (patch: PrefOverrides) => {
    const next = {
      ...overrides,
      ...patch,
      visibility: patch.visibility ? { ...overrides.visibility, ...patch.visibility } : overrides.visibility,
    };
    setOverrides(next);
    if (!canSync) return;
    const payload = toDesktopPreferences(resolveDesktopPrefs(local, serverPrefs, next, wallpapers));
    writeLocalPreferences(payload);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void fetch("/api/desktop/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }, SAVE_DELAY_MS);
  };

  return {
    ...prefs,
    wallpapers,
    selectWallpaper: (item: WallpaperItem) => {
      writeStorage(STORAGE_KEYS.wallpaper, item.id);
      update({ wallpaperId: item.id });
    },
    /** Wallpaper unggahan dihapus: bila sedang dipakai, kembali ke bawaan pertama. */
    forgetWallpaper: (id: string) => {
      if (prefs.wallpaper.id !== id) return;
      writeStorage(STORAGE_KEYS.wallpaper, DEFAULT_WALLPAPER.id);
      update({ wallpaperId: DEFAULT_WALLPAPER.id });
    },
    setWidgetVisible: (key: keyof WidgetVisibility, value: boolean) => {
      writeStorage(STORAGE_KEYS.widgetVisibility, JSON.stringify({ ...prefs.visibility, [key]: value }));
      update({ visibility: { [key]: value } });
    },
    setWidgetOrder: (order: MonitorWidgetKey[]) => {
      writeStorage(STORAGE_KEYS.widgetOrder, JSON.stringify(order));
      update({ order });
    },
    setSoundEnabled: (value: boolean) => {
      writeStorage(STORAGE_KEYS.soundEnabled, String(value));
      update({ soundEnabled: value });
    },
  };
}
