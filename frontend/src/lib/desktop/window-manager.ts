/**
 * Manajer jendela Arkiv OS — helper murni (tanpa React/DOM) supaya perilaku
 * "seperti desktop sungguhan" bisa diuji: urutan fokus, minimize, snap ke
 * tepi, siklus jendela, pintasan papan ketik, dan ingatan posisi/ukuran.
 */

export type WindowGeometry = { left: number; top: number; width: number; height: number };
export type Viewport = { width: number; height: number };

/** Ruang yang dipakai menubar (atas) dan dock (bawah). */
export const MENUBAR_H = 44;
export const DOCK_H = 96;
export const MIN_WINDOW_W = 300;
export const MIN_WINDOW_H = 180;
/** Lebar pita di tepi layar yang memicu snap saat jendela diseret ke sana. */
export const SNAP_EDGE_PX = 24;

export type SnapEdge = "left" | "right" | "maximize";

/** Geometri hasil snap: kiri/kanan = setengah layar, maximize = penuh. */
export function snapGeometry(edge: SnapEdge, viewport: Viewport): WindowGeometry {
  const top = MENUBAR_H;
  const height = Math.max(MIN_WINDOW_H, viewport.height - MENUBAR_H - DOCK_H);
  const half = Math.max(MIN_WINDOW_W, Math.floor(viewport.width / 2) - 12);
  if (edge === "left") return { left: 8, top, width: half, height };
  if (edge === "right") return { left: viewport.width - half - 8, top, width: half, height };
  return { left: 8, top, width: Math.max(MIN_WINDOW_W, viewport.width - 16), height };
}

/**
 * Tepi mana yang sedang "disentuh" penunjuk saat menyeret jendela.
 * Atas = maximize (seperti Windows Aero Snap), kiri/kanan = setengah layar.
 */
export function detectSnapEdge(
  pointer: { x: number; y: number },
  viewport: Viewport
): SnapEdge | null {
  if (pointer.y <= SNAP_EDGE_PX && pointer.y >= 0) return "maximize";
  if (pointer.x <= SNAP_EDGE_PX && pointer.x >= 0) return "left";
  if (pointer.x >= viewport.width - SNAP_EDGE_PX && pointer.x <= viewport.width) return "right";
  return null;
}

/** Jaga jendela tetap terlihat: tidak menembus menubar/dock atau keluar layar. */
export function clampGeometry(geo: WindowGeometry, viewport: Viewport): WindowGeometry {
  const width = Math.max(MIN_WINDOW_W, Math.min(geo.width, viewport.width - 16));
  const height = Math.max(MIN_WINDOW_H, Math.min(geo.height, viewport.height - MENUBAR_H - 16));
  return {
    width,
    height,
    left: Math.max(8, Math.min(geo.left, viewport.width - width - 8)),
    // Bilah judul harus selalu bisa diraih kursor.
    top: Math.max(MENUBAR_H, Math.min(geo.top, viewport.height - 56)),
  };
}

/** Jendela berikutnya pada siklus ⌘`/Alt-Tab; urutan terbaru = paling depan. */
export function nextWindowInCycle(
  order: string[],
  currentId: string | null,
  direction: 1 | -1 = 1
): string | null {
  const open = order.filter(Boolean);
  if (open.length === 0) return null;
  if (open.length === 1) return open[0];
  const index = currentId ? open.indexOf(currentId) : open.length - 1;
  if (index < 0) return open[open.length - 1];
  const next = (index + direction + open.length) % open.length;
  return open[next];
}

export type DesktopShortcut =
  | "search"
  | "close-window"
  | "minimize-window"
  | "cycle-next"
  | "cycle-prev"
  | "snap-left"
  | "snap-right"
  | "maximize"
  | "restore"
  | "lock"
  | "today"
  | "dismiss";

export interface ShortcutEventLike {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * Pintasan sengaja MENGHINDARI kombinasi yang dirampas browser (⌘W menutup
 * tab, ⌘M mengecilkan jendela browser, ⌘Tab berpindah aplikasi OS): dipakai
 * varian +Shift dan ⌘` yang bebas, jadi pintasan benar-benar sampai ke sini.
 */
export function matchDesktopShortcut(event: ShortcutEventLike): DesktopShortcut | null {
  const mod = Boolean(event.metaKey || event.ctrlKey);
  if (event.key === "Escape") return "dismiss";
  if (!mod) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  if (key === "k" && !event.shiftKey) return "search";
  if (key === "w" && event.shiftKey) return "close-window";
  if (key === "m" && event.shiftKey) return "minimize-window";
  if (key === "l" && event.shiftKey) return "lock";
  if (key === "j" && event.shiftKey) return "today";
  if (event.code === "Backquote" || key === "`" || key === "~") {
    return event.shiftKey ? "cycle-prev" : "cycle-next";
  }
  if (key === "ArrowLeft") return "snap-left";
  if (key === "ArrowRight") return "snap-right";
  if (key === "ArrowUp") return "maximize";
  if (key === "ArrowDown") return "restore";
  return null;
}

export const SHORTCUT_HINTS: Array<{ combo: string; label: string }> = [
  { combo: "⌘/Ctrl + K", label: "Cari apa saja (Spotlight)" },
  { combo: "⌘/Ctrl + ⇧ + W", label: "Tutup jendela aktif" },
  { combo: "⌘/Ctrl + ⇧ + M", label: "Kecilkan ke dock" },
  { combo: "⌘/Ctrl + `", label: "Pindah jendela berikutnya" },
  { combo: "⌘/Ctrl + ←/→", label: "Tempel setengah layar" },
  { combo: "⌘/Ctrl + ↑/↓", label: "Layar penuh / pulihkan" },
  { combo: "⌘/Ctrl + ⇧ + J", label: "Panel Hari Ini" },
  { combo: "⌘/Ctrl + ⇧ + L", label: "Kunci layar" },
  { combo: "Esc", label: "Tutup panel teratas" },
];

/* ── Ingatan posisi & ukuran jendela ───────────────────────────────── */

export type GeometryMap = Record<string, WindowGeometry>;

function isGeometry(value: unknown): value is WindowGeometry {
  if (!value || typeof value !== "object") return false;
  const geo = value as Record<string, unknown>;
  return (["left", "top", "width", "height"] as const).every(
    (key) => typeof geo[key] === "number" && Number.isFinite(geo[key] as number)
  );
}

export function parseGeometryMap(raw: string | null | undefined): GeometryMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: GeometryMap = {};
    for (const [id, geo] of Object.entries(parsed as Record<string, unknown>)) {
      if (isGeometry(geo)) out[id] = geo;
    }
    return out;
  } catch {
    return {};
  }
}

/** Simpan hanya 24 jendela terakhir supaya penyimpanan tidak menggelembung. */
export function rememberGeometry(
  map: GeometryMap,
  id: string,
  geo: WindowGeometry,
  limit = 24
): GeometryMap {
  const next: GeometryMap = { ...map, [id]: geo };
  const keys = Object.keys(next);
  if (keys.length <= limit) return next;
  const drop = keys.slice(0, keys.length - limit);
  for (const key of drop) {
    if (key !== id) delete next[key];
  }
  return next;
}

/**
 * Geometri tersimpan hanya dipakai bila masih masuk akal di layar sekarang
 * (mis. pernah dibuka di monitor lebar, sekarang di laptop kecil).
 */
export function restoreGeometry(
  map: GeometryMap,
  id: string,
  viewport: Viewport
): WindowGeometry | null {
  const saved = map[id];
  if (!saved) return null;
  if (saved.width > viewport.width || saved.height > viewport.height - MENUBAR_H) return null;
  return clampGeometry(saved, viewport);
}
