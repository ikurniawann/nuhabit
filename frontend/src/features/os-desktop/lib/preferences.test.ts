import { describe, expect, it } from "vitest";
import { BUILTIN_WALLPAPERS, DEFAULT_WALLPAPER, type WallpaperItem } from "@/lib/desktop/wallpapers";
import { MONITOR_KEYS } from "@/lib/desktop/widgets";
import { DEFAULT_DESKTOP_PREFERENCES } from "@/lib/desktop/preferences";
import {
  DEFAULT_WIDGET_VISIBILITY,
  moveWidget,
  parseLocalPrefs,
  reorderWidget,
  resolveDesktopPrefs,
  toDesktopPreferences,
} from "./preferences";

const custom: WallpaperItem = { id: "upload-1", name: "Toko", src: "/api/files/x.webp", custom: true };
const all = [...BUILTIN_WALLPAPERS, custom];
const local = parseLocalPrefs({ wallpaper: "midnight", visibility: null, order: null, sound: null });

describe("parseLocalPrefs", () => {
  it("default saat storage kosong", () => {
    const prefs = parseLocalPrefs({ wallpaper: null, visibility: null, order: null, sound: null });
    expect(prefs).toEqual({ wallpaperId: null, visibility: DEFAULT_WIDGET_VISIBILITY, order: MONITOR_KEYS, soundEnabled: false });
  });

  it("menggabung visibilitas tersimpan di atas default dan menormalkan urutan", () => {
    const prefs = parseLocalPrefs({
      wallpaper: "glass",
      visibility: JSON.stringify({ calendar: true, omzet: false }),
      order: JSON.stringify(["stok", "asing", "omzet"]),
      sound: "true",
    });
    expect(prefs.visibility).toEqual({ ...DEFAULT_WIDGET_VISIBILITY, calendar: true, omzet: false });
    expect(prefs.order.slice(0, 2)).toEqual(["stok", "omzet"]);
    expect(prefs.order).toHaveLength(MONITOR_KEYS.length);
    expect(prefs.soundEnabled).toBe(true);
  });

  it("JSON rusak jatuh ke default, bukan melempar", () => {
    const prefs = parseLocalPrefs({ wallpaper: null, visibility: "{rusak", order: "[", sound: "false" });
    expect(prefs.visibility).toEqual(DEFAULT_WIDGET_VISIBILITY);
    expect(prefs.order).toEqual(MONITOR_KEYS);
  });
});

describe("resolveDesktopPrefs", () => {
  it("tanpa server & pilihan sesi: pakai lokal", () => {
    const resolved = resolveDesktopPrefs(local, null, {}, all);
    expect(resolved.wallpaper.id).toBe("midnight");
    expect(resolved.soundEnabled).toBe(false);
  });

  it("server menimpa lokal; pilihan sesi menimpa server", () => {
    const server = {
      ...DEFAULT_DESKTOP_PREFERENCES,
      wallpaper: "glass",
      widgetVisibility: { promo: false },
      widgetOrder: ["member"],
      soundEnabled: true,
    };
    const fromServer = resolveDesktopPrefs(local, server, {}, all);
    expect(fromServer.wallpaper.id).toBe("glass");
    expect(fromServer.visibility.promo).toBe(false);
    expect(fromServer.order[0]).toBe("member");
    expect(fromServer.soundEnabled).toBe(true);

    const chosen = resolveDesktopPrefs(local, server, { wallpaperId: "upload-1", soundEnabled: false, visibility: { promo: true } }, all);
    expect(chosen.wallpaper).toBe(custom);
    expect(chosen.soundEnabled).toBe(false);
    expect(chosen.visibility.promo).toBe(true);
  });

  it("id wallpaper yang belum dikenal dilewati (unggahan belum termuat)", () => {
    const resolved = resolveDesktopPrefs({ ...local, wallpaperId: "upload-1" }, null, {}, BUILTIN_WALLPAPERS);
    expect(resolved.wallpaper).toBe(DEFAULT_WALLPAPER);
    expect(resolveDesktopPrefs({ ...local, wallpaperId: "upload-1" }, null, {}, all).wallpaper).toBe(custom);
  });

  it("urutan server kosong tidak menghapus urutan lokal", () => {
    const resolved = resolveDesktopPrefs({ ...local, order: ["tim", ...MONITOR_KEYS.filter((k) => k !== "tim")] }, DEFAULT_DESKTOP_PREFERENCES, {}, all);
    expect(resolved.order[0]).toBe("tim");
  });

  it("toDesktopPreferences menyimpan id wallpaper", () => {
    const payload = toDesktopPreferences(resolveDesktopPrefs(local, null, {}, all));
    expect(payload).toMatchObject({ wallpaper: "midnight", soundEnabled: false, period: null });
  });
});

describe("moveWidget / reorderWidget", () => {
  const order = MONITOR_KEYS;

  it("menggeser satu langkah", () => {
    expect(moveWidget(order, order[1], -1)?.slice(0, 2)).toEqual([order[1], order[0]]);
    expect(moveWidget(order, order[0], 1)?.slice(0, 2)).toEqual([order[1], order[0]]);
  });

  it("di ujung daftar → null", () => {
    expect(moveWidget(order, order[0], -1)).toBeNull();
    expect(moveWidget(order, order[order.length - 1], 1)).toBeNull();
  });

  it("drag & drop memindahkan ke posisi baru", () => {
    expect(reorderWidget(order, 0, 2)?.slice(0, 3)).toEqual([order[1], order[2], order[0]]);
    expect(reorderWidget(order, 1, 1)).toBeNull();
    expect(reorderWidget(order, -1, 2)).toBeNull();
    expect(reorderWidget(order, 0, order.length)).toBeNull();
  });
});
