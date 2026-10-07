import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESKTOP_PREFERENCES,
  mergeDesktopPreferences,
  normalizeDesktopPreferences,
} from "@/lib/desktop/preferences";

describe("normalizeDesktopPreferences", () => {
  it("input sampah → nilai bawaan", () => {
    expect(normalizeDesktopPreferences(null)).toEqual(DEFAULT_DESKTOP_PREFERENCES);
    expect(normalizeDesktopPreferences("teks")).toEqual(DEFAULT_DESKTOP_PREFERENCES);
    expect(normalizeDesktopPreferences([1, 2])).toEqual(DEFAULT_DESKTOP_PREFERENCES);
  });

  it("membuang key widget asing & urutan ganda", () => {
    const prefs = normalizeDesktopPreferences({
      wallpaper: "wp-1",
      widgetVisibility: { omzet: true, widget_hantu: true, stok: "ya" },
      widgetOrder: ["stok", "stok", "widget_hantu", "omzet"],
      soundEnabled: true,
      period: "bulan-berjalan",
    });
    expect(prefs.widgetVisibility).toEqual({ omzet: true });
    expect(prefs.widgetOrder).toEqual(["stok", "omzet"]);
    expect(prefs.wallpaper).toBe("wp-1");
    expect(prefs.soundEnabled).toBe(true);
  });

  it("wallpaper kosong dianggap belum diatur", () => {
    expect(normalizeDesktopPreferences({ wallpaper: "" }).wallpaper).toBeNull();
  });
});

describe("mergeDesktopPreferences", () => {
  const local = normalizeDesktopPreferences({
    wallpaper: "lokal",
    widgetVisibility: { omzet: false },
    widgetOrder: ["omzet", "stok"],
    soundEnabled: true,
    period: "hari-ini",
  });

  it("tanpa data server, pilihan perangkat dipakai apa adanya", () => {
    expect(mergeDesktopPreferences(null, local)).toEqual(local);
  });

  it("server menang untuk bagian yang memang tersimpan di sana", () => {
    const merged = mergeDesktopPreferences(
      normalizeDesktopPreferences({ wallpaper: "server", soundEnabled: false }),
      local
    );
    expect(merged.wallpaper).toBe("server");
    expect(merged.soundEnabled).toBe(false);
    // Bagian yang KOSONG di server tidak menghapus pilihan lokal.
    expect(merged.widgetOrder).toEqual(["omzet", "stok"]);
    expect(merged.widgetVisibility).toEqual({ omzet: false });
  });

  it("dua-duanya kosong → bawaan", () => {
    expect(mergeDesktopPreferences(null, null)).toEqual(DEFAULT_DESKTOP_PREFERENCES);
  });
});
