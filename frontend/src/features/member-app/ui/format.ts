import { zoneName, zoneSuffix } from '@/lib/timezone';

export function formatIdr(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/*
 * Dates read in the device zone. A class or PT time passes its branch zone
 * (`timezone` from the API): the time is then the branch's wall clock, with
 * "WITA" or "WIT" added outside WIB.
 */
const inZone = (timeZone?: string) => (timeZone ? { timeZone: zoneName(timeZone) } : {});
const suffix = (timeZone?: string) => (timeZone ? zoneSuffix(timeZone) : '');

export function formatDayTime(iso: string, timeZone?: string): string {
  return (
    new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      ...inZone(timeZone),
    }) + suffix(timeZone)
  );
}

export function formatDay(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...inZone(timeZone),
  });
}

export function formatTime(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', ...inZone(timeZone) }) + suffix(timeZone);
}

// ── Athlete formatting ────────────────────────────────────────────────────────
export type Units = 'METRIC' | 'IMPERIAL';
const KM_PER_MI = 1.60934;

export function formatDistanceM(meters: number, units: Units = 'METRIC'): string {
  if (units === 'IMPERIAL') {
    const mi = meters / 1000 / KM_PER_MI;
    return `${mi >= 10 ? mi.toFixed(1) : mi.toFixed(2)} mi`;
  }
  const km = meters / 1000;
  return `${km >= 10 ? km.toFixed(1) : km.toFixed(2)} km`;
}

export { formatDuration } from '@/lib/gym/hyrox';

export function formatPace(secPerKm: number | null, units: Units = 'METRIC'): string {
  if (secPerKm === null || !Number.isFinite(secPerKm)) return '-';
  const sec = units === 'IMPERIAL' ? secPerKm * KM_PER_MI : secPerKm;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')} /${units === 'IMPERIAL' ? 'mi' : 'km'}`;
}

export function formatSpeedKmh(distanceM: number, movingSec: number, units: Units = 'METRIC'): string {
  if (movingSec <= 0) return '-';
  const kmh = distanceM / 1000 / (movingSec / 3600);
  if (units === 'IMPERIAL') return `${(kmh / KM_PER_MI).toFixed(1)} mph`;
  return `${kmh.toFixed(1)} km/h`;
}
