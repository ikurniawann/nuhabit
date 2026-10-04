import type { AvailabilityType } from "@/lib/resort/types";

/** Pilihan kamar per tipe di form reservasi baru. */
export type RoomPicks = Record<string, { qty: number; extraBed: number }>;

/** Baris kamar terpilih + subtotal (tarif menginap + extra bed per malam) × jumlah unit. */
export function pickedLines(types: readonly AvailabilityType[], picks: RoomPicks) {
  return types.flatMap((type) => {
    const pick = picks[type.id];
    if (!pick?.qty) return [];
    const perRoom = type.quote.room_subtotal + pick.extraBed * (type.extra_bed_rate || 0) * type.quote.nights;
    return [{ type, qty: pick.qty, extraBed: pick.extraBed, subtotal: perRoom * pick.qty }];
  });
}

/** Total setelah diskon, tidak pernah negatif. */
export const reservationTotal = (lines: readonly { subtotal: number }[], discount: number) =>
  Math.max(0, lines.reduce((sum, line) => sum + line.subtotal, 0) - discount);

/** "05/10 (WE) Rp1.200.000" untuk rincian tarif per malam. */
export const nightLabel = (night: { date: string; weekend: boolean }) =>
  `${night.date.slice(8)}/${night.date.slice(5, 7)}${night.weekend ? " (WE)" : ""}`;
