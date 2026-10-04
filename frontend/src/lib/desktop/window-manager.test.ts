import { describe, expect, it } from "vitest";
import {
  MENUBAR_H,
  clampGeometry,
  detectSnapEdge,
  matchDesktopShortcut,
  nextWindowInCycle,
  parseGeometryMap,
  rememberGeometry,
  restoreGeometry,
  snapGeometry,
  type GeometryMap,
} from "@/lib/desktop/window-manager";

const viewport = { width: 1440, height: 900 };

describe("snapGeometry", () => {
  it("kiri & kanan membagi layar tanpa saling tumpang tindih", () => {
    const left = snapGeometry("left", viewport);
    const right = snapGeometry("right", viewport);
    expect(left.left).toBe(8);
    expect(left.left + left.width).toBeLessThanOrEqual(right.left);
    expect(right.left + right.width).toBeLessThanOrEqual(viewport.width);
  });
  it("maximize menyisakan ruang menubar & dock", () => {
    const max = snapGeometry("maximize", viewport);
    expect(max.top).toBe(MENUBAR_H);
    expect(max.top + max.height).toBeLessThan(viewport.height);
  });
});

describe("detectSnapEdge", () => {
  it("mengenali tepi atas/kiri/kanan, selain itu null", () => {
    expect(detectSnapEdge({ x: 700, y: 3 }, viewport)).toBe("maximize");
    expect(detectSnapEdge({ x: 5, y: 400 }, viewport)).toBe("left");
    expect(detectSnapEdge({ x: 1438, y: 400 }, viewport)).toBe("right");
    expect(detectSnapEdge({ x: 700, y: 400 }, viewport)).toBeNull();
  });
});

describe("clampGeometry", () => {
  it("menarik jendela yang keluar layar kembali ke dalam", () => {
    const geo = clampGeometry({ left: 5000, top: -200, width: 4000, height: 4000 }, viewport);
    expect(geo.left + geo.width).toBeLessThanOrEqual(viewport.width);
    expect(geo.top).toBeGreaterThanOrEqual(MENUBAR_H);
    expect(geo.height).toBeLessThanOrEqual(viewport.height - MENUBAR_H);
  });
  it("bilah judul tidak pernah tenggelam di bawah layar", () => {
    const geo = clampGeometry({ left: 100, top: 100_000, width: 400, height: 300 }, viewport);
    expect(geo.top).toBeLessThanOrEqual(viewport.height - 56);
  });
});

describe("nextWindowInCycle", () => {
  const order = ["Files", "Settings", "Do"];
  it("maju & mundur melingkar dari jendela aktif", () => {
    expect(nextWindowInCycle(order, "Do", 1)).toBe("Files");
    expect(nextWindowInCycle(order, "Files", -1)).toBe("Do");
    expect(nextWindowInCycle(order, "Settings", 1)).toBe("Do");
  });
  it("tanpa jendela aktif → ambil yang paling depan; kosong → null", () => {
    expect(nextWindowInCycle(order, null, 1)).toBe("Files");
    expect(nextWindowInCycle([], null, 1)).toBeNull();
    expect(nextWindowInCycle(["Solo"], "Solo", 1)).toBe("Solo");
  });
});

describe("matchDesktopShortcut", () => {
  it("memakai kombinasi yang tidak dirampas browser", () => {
    expect(matchDesktopShortcut({ key: "w", metaKey: true, shiftKey: true })).toBe("close-window");
    expect(matchDesktopShortcut({ key: "m", ctrlKey: true, shiftKey: true })).toBe("minimize-window");
    // ⌘W / ⌘M polos sengaja TIDAK ditangani (browser menutup tab).
    expect(matchDesktopShortcut({ key: "w", metaKey: true })).toBeNull();
    expect(matchDesktopShortcut({ key: "m", metaKey: true })).toBeNull();
  });
  it("siklus jendela, snap, dan Escape", () => {
    expect(matchDesktopShortcut({ key: "`", code: "Backquote", metaKey: true })).toBe("cycle-next");
    expect(matchDesktopShortcut({ key: "`", code: "Backquote", metaKey: true, shiftKey: true })).toBe("cycle-prev");
    expect(matchDesktopShortcut({ key: "ArrowLeft", ctrlKey: true })).toBe("snap-left");
    expect(matchDesktopShortcut({ key: "ArrowUp", ctrlKey: true })).toBe("maximize");
    expect(matchDesktopShortcut({ key: "Escape" })).toBe("dismiss");
  });
  it("tombol biasa (mengetik) tidak memicu apa pun", () => {
    expect(matchDesktopShortcut({ key: "k" })).toBeNull();
    expect(matchDesktopShortcut({ key: "ArrowLeft" })).toBeNull();
  });
});

describe("ingatan geometri", () => {
  it("parse aman terhadap JSON rusak / entri tidak lengkap", () => {
    expect(parseGeometryMap(null)).toEqual({});
    expect(parseGeometryMap("[]")).toEqual({});
    expect(parseGeometryMap('{"a":{"left":1,"top":2}}')).toEqual({});
    expect(parseGeometryMap('{"a":{"left":1,"top":2,"width":3,"height":4}}')).toEqual({
      a: { left: 1, top: 2, width: 3, height: 4 },
    });
  });
  it("menyimpan dengan batas jumlah, entri terbaru tidak ikut dibuang", () => {
    let map: GeometryMap = {};
    for (let i = 0; i < 30; i++) {
      map = rememberGeometry(map, `w${i}`, { left: i, top: i, width: 400, height: 300 }, 24);
    }
    expect(Object.keys(map)).toHaveLength(24);
    expect(map.w29).toBeDefined();
  });
  it("geometri dari layar lebih besar diabaikan, bukan dipaksakan", () => {
    const map: GeometryMap = {
      big: { left: 10, top: 60, width: 3000, height: 1800 },
      ok: { left: 10, top: 60, width: 600, height: 400 },
    };
    expect(restoreGeometry(map, "big", viewport)).toBeNull();
    expect(restoreGeometry(map, "ok", viewport)).toEqual({ left: 10, top: 60, width: 600, height: 400 });
    expect(restoreGeometry(map, "tidak-ada", viewport)).toBeNull();
  });
});
