/**
 * Tarif menginap (owner 2026-09-06). Perhitungan murni: malam menginap,
 * tarif weekday/weekend, penimpaan kalender musim, dan rincian per malam
 * yang di-snapshot ke reservasi.
 *
 * Konvensi: tarif WEEKEND berlaku untuk malam Jumat & Sabtu (tamu menginap
 * dan check-out esok harinya) — praktik umum resort di Indonesia.
 */

export interface RoomTypeRate {
  id: string;
  name: string;
  rate_weekday: number;
  rate_weekend: number;
  extra_bed_rate?: number;
}

export interface RateSeason {
  room_type_id: string | null;
  label: string;
  start_date: string;
  end_date: string;
  rate?: number | null;
  surcharge_percent?: number | null;
}

export interface NightRate {
  date: string;
  rate: number;
  weekend: boolean;
  season: string | null;
}

/** Jumlah malam antara check-in dan check-out (YYYY-MM-DD). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Daftar tanggal malam menginap (check-out tidak termasuk). */
export function eachNight(checkIn: string, checkOut: string): string[] {
  const total = nightsBetween(checkIn, checkOut);
  const out: string[] = [];
  for (let i = 0; i < total; i += 1) {
    out.push(new Date(Date.parse(`${checkIn}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** Malam akhir pekan: Jumat (5) & Sabtu (6). */
export function isWeekendNight(date: string): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 5 || dow === 6;
}

function seasonFor(seasons: readonly RateSeason[], roomTypeId: string, date: string): RateSeason | null {
  // Musim khusus tipe kamar menang atas musim "semua tipe".
  const matches = seasons.filter(
    (s) => (s.room_type_id === null || s.room_type_id === roomTypeId) && date >= s.start_date && date <= s.end_date
  );
  if (matches.length === 0) return null;
  return matches.sort((a, b) => (a.room_type_id === null ? 1 : 0) - (b.room_type_id === null ? 1 : 0))[0];
}

/** Tarif satu malam: dasar weekday/weekend, lalu ditimpa musim bila ada. */
export function nightlyRate(type: RoomTypeRate, date: string, seasons: readonly RateSeason[] = []): NightRate {
  const weekend = isWeekendNight(date);
  const base = weekend ? Number(type.rate_weekend) || Number(type.rate_weekday) || 0 : Number(type.rate_weekday) || 0;
  const season = seasonFor(seasons, type.id, date);
  let rate = base;
  if (season) {
    if (season.rate != null) rate = Number(season.rate) || 0;
    else if (season.surcharge_percent != null) rate = base * (1 + Number(season.surcharge_percent) / 100);
  }
  return { date, rate: Math.round(rate), weekend, season: season?.label ?? null };
}

export interface StayQuote {
  nights: number;
  breakdown: NightRate[];
  room_subtotal: number;
  extra_bed_total: number;
  subtotal: number;
}

/** Total menginap satu kamar: tarif per malam + extra bed per malam. */
export function quoteStay(input: {
  type: RoomTypeRate;
  checkIn: string;
  checkOut: string;
  extraBed?: number;
  seasons?: readonly RateSeason[];
}): StayQuote {
  const breakdown = eachNight(input.checkIn, input.checkOut).map((d) =>
    nightlyRate(input.type, d, input.seasons ?? [])
  );
  const roomSubtotal = breakdown.reduce((s, n) => s + n.rate, 0);
  const extraBed = Math.max(0, Math.floor(input.extraBed ?? 0));
  const extraBedTotal = extraBed * (Number(input.type.extra_bed_rate) || 0) * breakdown.length;
  return {
    nights: breakdown.length,
    breakdown,
    room_subtotal: roomSubtotal,
    extra_bed_total: extraBedTotal,
    subtotal: roomSubtotal + extraBedTotal,
  };
}

/** Pure: dua rentang menginap bertabrakan (check-out = check-in tidak bentrok). */
export function stayOverlaps(
  a: { check_in: string; check_out: string },
  b: { check_in: string; check_out: string }
): boolean {
  return a.check_in < b.check_out && b.check_in < a.check_out;
}
