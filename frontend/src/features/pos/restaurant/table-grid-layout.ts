/**
 * Tata letak kursi utk papan meja Restaurant mode grid (owner 2026-10-01:
 * "design meja seperti referensi, lebih rapi"). Murni — diuji tanpa DOM.
 */

/** Meja besar (mis. Office 20 kursi) tetap ringkas: kursi digambar maks segini. */
export const MAX_DRAWN_CHAIRS = 12;

export type ChairLayout = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/**
 * Sebar kursi di sekeliling meja:
 * - 1 → atas; 2 → kiri & kanan; 3 → atas, kiri, kanan; 4 → satu tiap sisi
 * - ≥5 → kiri & kanan satu, sisanya atas/bawah (atas dapat sisa ganjil)
 */
export function chairLayout(capacity: number): ChairLayout {
  const seats = Math.max(1, Math.min(MAX_DRAWN_CHAIRS, Math.floor(Number(capacity)) || 1));
  if (seats === 1) return { top: 1, bottom: 0, left: 0, right: 0 };
  if (seats === 2) return { top: 0, bottom: 0, left: 1, right: 1 };
  if (seats === 3) return { top: 1, bottom: 0, left: 1, right: 1 };
  if (seats === 4) return { top: 1, bottom: 1, left: 1, right: 1 };
  const rest = seats - 2;
  return { top: Math.ceil(rest / 2), bottom: Math.floor(rest / 2), left: 1, right: 1 };
}

export function drawnChairCount(layout: ChairLayout) {
  return layout.top + layout.bottom + layout.left + layout.right;
}

/** Meja panjang (≥3 kursi per sisi) memakai 2 kolom grid. */
export function isWideTable(capacity: number) {
  return chairLayout(capacity).top >= 3;
}

/**
 * Jumlah kursi terisi: jumlah tamu bila tercatat; meja terisi tanpa data tamu
 * → semua kursi; meja kosong/reservasi → 0.
 */
export function seatedChairCount(status: string, guestCount: number | null | undefined, drawn: number) {
  if (status !== "occupied" && status !== "billing") return 0;
  const guests = Math.floor(Number(guestCount) || 0);
  if (guests <= 0) return drawn;
  return Math.min(drawn, guests);
}

export type AreaGroup<T> = { area: string; tables: T[] };

/** Kelompokkan per area (Indoor/Outdoor/VIP…), urut nama area lalu nomor meja. */
export function groupTablesByArea<T extends { area?: string | null }>(
  tables: T[],
  displayName: (table: T) => string
): AreaGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const table of tables) {
    const key = String(table.area ?? "").trim();
    map.set(key, [...(map.get(key) ?? []), table]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([area, list]) => ({
      area,
      tables: [...list].sort((a, b) =>
        displayName(a).localeCompare(displayName(b), undefined, { numeric: true })
      ),
    }));
}
