// Resolver kapasitas harian venue (EPIC-031): kuota VENUE-WIDE per tanggal,
// dihitung per ORANG. Default di ticket_settings.daily_capacity (NULL =
// unlimited), override per rentang tanggal di ticket_capacity_dates.
// Fungsi murni tanpa DB agar mudah diuji — pemanggil menyuplai data yang
// sudah ter-scope venue (pola pricing.ts).

import { isValidCalendarDate } from "./pricing";

/** Baris ticket_capacity_dates yang relevan utk resolusi (ter-scope venue). */
export interface CapacityDateRange {
  start_date: string; // YYYY-MM-DD inklusif
  end_date: string; // YYYY-MM-DD inklusif
  capacity: number; // 0 = tanggal tutup (online + walk-in)
  is_active: boolean;
}

/**
 * Status booking yang MEMEGANG kuota (keputusan desain #2 EPIC-031):
 * menunggu-bayar = reservasi sementara (lepas otomatis saat kedaluwarsa),
 * terbayar & digunakan = kursi terpakai. kedaluwarsa/dibatalkan/hangus
 * TIDAK dihitung — pelepasan kuota menumpang jalur status existing.
 */
export const CAPACITY_HOLDING_BOOKING_STATUSES = [
  "menunggu-bayar",
  "terbayar",
  "digunakan",
] as const;

/**
 * Kapasitas efektif satu tanggal: override rentang aktif menang atas
 * default venue; overlap antar override → kapasitas TERKECIL menang
 * (konservatif — beda dari high-season yang "ada rentang = high").
 * null = unlimited (tanpa batas, perilaku sebelum EPIC-031).
 */
export function resolveDailyCapacity(
  date: string,
  venueDefault: number | null,
  overrides: readonly CapacityDateRange[]
): number | null {
  if (!isValidCalendarDate(date)) {
    throw new Error(`Tanggal tidak valid: ${date}`);
  }
  const matching = overrides.filter(
    (r) => r.is_active && r.start_date <= date && date <= r.end_date
  );
  if (matching.length === 0) return venueDefault;
  return Math.min(...matching.map((r) => r.capacity));
}

/**
 * `used + additional` melebihi kapasitas? Unlimited (null) tidak pernah
 * melebihi. Dipanggil DI BAWAH advisory lock dengan `used` hasil hitung
 * live (jangan percaya state — hitung ulang).
 */
export function isCapacityExceeded(
  capacity: number | null,
  used: number,
  additional: number
): boolean {
  if (capacity === null) return false;
  return used + additional > capacity;
}

// ── Timed-entry slot (Fase D) ─────────────────────────────────────────

export type SlotWindowStatus = "ok" | "terlalu-awal" | "terlambat";

/** "HH:MM" / "HH:MM:SS" → menit sejak 00:00 (detik diabaikan). */
const minutesOfDay = (time: string): number => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Validasi jam masuk terhadap jendela slot ± grace (inklusif di kedua
 * ujung): boleh masuk dari `start - grace` s/d `end + grace`. Dipakai saat
 * REDEEM loket (gelang baru ada setelah redeem — titik kontrol masuk utk
 * booking ber-slot).
 */
export function slotWindowStatus(
  now: string,
  slotStart: string,
  slotEnd: string,
  graceMinutes: number
): SlotWindowStatus {
  const nowMin = minutesOfDay(now);
  if (nowMin < minutesOfDay(slotStart) - graceMinutes) return "terlalu-awal";
  if (nowMin > minutesOfDay(slotEnd) + graceMinutes) return "terlambat";
  return "ok";
}
