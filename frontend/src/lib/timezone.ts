/**
 * Zona waktu cabang. Setiap cabang menyimpan nama IANA
 * (configuration.branches.timezone); jadwal, jam buka dan laporan cabang
 * dibaca dalam zona itu. Daftarnya sama dengan
 * backend/internal/platform/localtime.Names. Ketiganya tanpa daylight saving,
 * jadi selisih tetap cukup untuk mengubah tanggal + jam lokal menjadi instan.
 */

export const DEFAULT_TIME_ZONE = "Asia/Jakarta";

export const BRANCH_TIME_ZONES = [
  { value: "Asia/Jakarta", abbr: "WIB", offset: "+07:00", label: "WIB, Asia/Jakarta (UTC+7)" },
  { value: "Asia/Makassar", abbr: "WITA", offset: "+08:00", label: "WITA, Asia/Makassar (UTC+8)" },
  { value: "Asia/Jayapura", abbr: "WIT", offset: "+09:00", label: "WIT, Asia/Jayapura (UTC+9)" },
] as const;

type TimeZoneLike = string | null | undefined;

function zoneOf(timeZone: TimeZoneLike) {
  return BRANCH_TIME_ZONES.find((z) => z.value === timeZone) ?? BRANCH_TIME_ZONES[0];
}

/** Nama zona yang dikenal; nilai kosong atau asing menjadi Asia/Jakarta. */
export const zoneName = (timeZone: TimeZoneLike) => zoneOf(timeZone).value;

/** "WIB", "WITA" atau "WIT". */
export const zoneAbbr = (timeZone: TimeZoneLike) => zoneOf(timeZone).abbr;

/** " WITA" atau " WIT" di luar Jakarta, kosong untuk WIB: teks WIB tetap seperti dulu. */
export const zoneSuffix = (timeZone: TimeZoneLike) =>
  zoneName(timeZone) === DEFAULT_TIME_ZONE ? "" : ` ${zoneAbbr(timeZone)}`;

const offsetMs = (timeZone: TimeZoneLike) => {
  const [h, m] = zoneOf(timeZone).offset.slice(1).split(":").map(Number);
  return (h * 60 + m) * 60_000;
};

/** Tanggal lokal ("YYYY-MM-DD") sebuah instan di zona cabang. */
export const localDay = (instant: string | Date, timeZone?: TimeZoneLike) =>
  new Date(new Date(instant).getTime() + offsetMs(timeZone)).toISOString().slice(0, 10);

/** Jam lokal ("HH:MM", nilai <input type="time">) sebuah instan di zona cabang. */
export const localClock = (instant: string | Date, timeZone?: TimeZoneLike) =>
  new Date(new Date(instant).getTime() + offsetMs(timeZone)).toISOString().slice(11, 16);

/** Instan dari tanggal "YYYY-MM-DD" dan jam "HH:MM" lokal cabang. */
export const localInstant = (day: string, time: string, timeZone?: TimeZoneLike) =>
  new Date(`${day}T${time}:00${zoneOf(timeZone).offset}`);
