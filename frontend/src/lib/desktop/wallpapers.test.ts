import { describe, expect, it } from "vitest";
import {
  DESKTOP_WALLPAPER_MAX_ITEMS,
  addDesktopWallpaper,
  normalizeWallpaperName,
  parseDesktopWallpapers,
  removeDesktopWallpaper,
  serializeDesktopWallpapers,
  type DesktopWallpaper,
} from "@/lib/desktop/wallpapers";

const wp = (id: string): DesktopWallpaper => ({
  id,
  name: `WP ${id}`,
  src: `/api/files/desktop-wallpapers/${id}.jpg`,
  created_at: "2026-09-17T00:00:00.000Z",
  created_by: null,
});

describe("parseDesktopWallpapers", () => {
  it("kosong / rusak / bukan array → []", () => {
    expect(parseDesktopWallpapers(null)).toEqual([]);
    expect(parseDesktopWallpapers("{bukan json")).toEqual([]);
    expect(parseDesktopWallpapers('{"id":"x"}')).toEqual([]);
  });
  it("membuang entri tanpa id/src/name, sisanya utuh setelah bolak-balik", () => {
    const raw = serializeDesktopWallpapers([wp("a")]);
    const withJunk = raw.replace("]", ',{"id":"b"},null,"str"]');
    expect(parseDesktopWallpapers(withJunk)).toEqual([wp("a")]);
  });
});

describe("normalizeWallpaperName", () => {
  it("pakai input admin bila ada, kalau tidak dari nama berkas", () => {
    expect(normalizeWallpaperName("  Pantai Sore ", "x.jpg")).toBe("Pantai Sore");
    expect(normalizeWallpaperName("", "kopi_pagi-hari.PNG")).toBe("kopi pagi hari");
    expect(normalizeWallpaperName(undefined, ".jpg")).toBe("Wallpaper");
  });
});

describe("add / remove", () => {
  it("wallpaper baru di depan, id ganda ditolak, ada batas jumlah", () => {
    const r1 = addDesktopWallpaper([wp("a")], wp("b"));
    expect(r1.ok && r1.items.map((i) => i.id)).toEqual(["b", "a"]);
    expect(addDesktopWallpaper([wp("a")], wp("a")).ok).toBe(false);
    const full = Array.from({ length: DESKTOP_WALLPAPER_MAX_ITEMS }, (_, i) => wp(String(i)));
    expect(addDesktopWallpaper(full, wp("z")).ok).toBe(false);
  });
  it("remove mengembalikan item yang dihapus untuk dibersihkan berkasnya", () => {
    const { items, removed } = removeDesktopWallpaper([wp("a"), wp("b")], "a");
    expect(items.map((i) => i.id)).toEqual(["b"]);
    expect(removed?.id).toBe("a");
    expect(removeDesktopWallpaper(items, "zzz").removed).toBeNull();
  });
});
