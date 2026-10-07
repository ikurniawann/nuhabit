import type { HolidayType } from "./holidays";

/**
 * Parser ICS untuk impor kalender hari libur (EPIC-036 Fase E).
 *
 * Murni: menerima teks, mengembalikan kandidat. Tidak menyentuh jaringan dan
 * tidak menulis apa pun — pengambilan ICS dan penyimpanan ada di endpoint,
 * supaya aturan kurasinya bisa diuji tanpa keluar jaringan.
 *
 * Kenapa impor ini SELALU lewat preview bercentang, bukan cron: kalender Google
 * memuat tanggal yang bukan tanggal merah (`1 Ramadan`, `Hari Paskah`, …) dan
 * menandai sebagian tanggal hijriah "(belum pasti)". Daftar resmi terbit lewat
 * SKB 3 Menteri, jadi keputusan akhirnya milik HRD — lihat EPIC-036.
 */

export interface IcsEvent {
  uid: string;
  /** "YYYY-MM-DD" */
  date: string;
  name: string;
}

export interface HolidayCandidate {
  /** UID event ICS — kunci idempotensi saat impor ulang. */
  source_ref: string;
  holiday_date: string;
  name: string;
  type: HolidayType;
  deducts_leave: boolean;
  status: "draft" | "aktif";
  /** Dicentang otomatis di preview? false = HRD harus memutuskan sendiri. */
  suggested: boolean;
  /** Kenapa tidak dicentang, atau kenapa masuk sebagai draft. */
  reason?: string;
}

/**
 * Nama entri kalender yang BUKAN tanggal merah menurut SKB. Dicocokkan pada
 * nama yang sudah dinormalisasi (huruf kecil), bukan pada tanggal — tanggalnya
 * bergeser tiap tahun sedangkan namanya tetap.
 */
const BUKAN_TANGGAL_MERAH: { pattern: RegExp; reason: string }[] = [
  { pattern: /^\d+ ramadan/, reason: "Awal Ramadan bukan hari libur nasional" },
  { pattern: /paskah/, reason: "Hari Paskah jatuh Minggu dan bukan tanggal merah" },
  { pattern: /hari kedua muharram/, reason: "Artefak batas hari hijriah, bukan libur resmi" },
  { pattern: /malam tahun baru/, reason: "31 Desember bukan tanggal merah" },
  { pattern: /^hari (ayah|ibu|guru|pahlawan|kartini|sumpah pemuda)/, reason: "Hari peringatan, bukan hari libur" },
];

const TENTATIF = /\(belum pasti\)/i;

/** Baris terlipat RFC 5545: lanjutan diawali spasi atau tab. */
function unfold(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else {
      lines.push(raw);
    }
  }
  return lines;
}

/** Escape sequence ICS: \\ \, \; \n */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\([,;\\])/g, "$1")
    .trim();
}

/** "20260817" → "2026-08-17". Bentuk date-time (mis. 20260817T000000Z) ikut terbaca. */
function toDateIso(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let current: Partial<IcsEvent> | null = null;

  for (const line of unfold(text)) {
    if (line.startsWith("BEGIN:VEVENT")) {
      current = {};
      continue;
    }
    if (line.startsWith("END:VEVENT")) {
      if (current?.date && current.name) {
        events.push({
          uid: current.uid ?? `${current.date}_${current.name}`,
          date: current.date,
          name: current.name,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    // "DTSTART;VALUE=DATE:20260817" → nama properti sebelum ';' atau ':'
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(";")[0].toUpperCase();
    const value = line.slice(colon + 1);

    if (name === "UID") current.uid = value.trim();
    else if (name === "SUMMARY") current.name = unescapeText(value);
    else if (name === "DTSTART") current.date = toDateIso(value) ?? undefined;
  }

  return events;
}

/**
 * Ubah event ICS menjadi kandidat siap-preview untuk satu tahun.
 *
 * Aturan kurasi (semuanya bisa ditimpa HRD di preview):
 * - "Cuti Bersama …" → `cuti_bersama` + `deducts_leave = true` (SKB).
 * - Nama yang cocok daftar BUKAN_TANGGAL_MERAH → tidak dicentang, disertai alasan.
 * - Nama bertanda "(belum pasti)" → masuk sebagai `draft` sehingga belum
 *   mempengaruhi perhitungan cuti/absensi sampai HRD menyetujuinya.
 */
export function toHolidayCandidates(
  events: readonly IcsEvent[],
  year: number
): HolidayCandidate[] {
  const prefix = `${year}-`;
  return events
    .filter((event) => event.date.startsWith(prefix))
    .map((event) => {
      const normalized = event.name.toLowerCase();
      const isCutiBersama = normalized.startsWith("cuti bersama");
      const bukanLibur = BUKAN_TANGGAL_MERAH.find((rule) => rule.pattern.test(normalized));
      const tentatif = TENTATIF.test(event.name);

      return {
        source_ref: event.uid,
        holiday_date: event.date,
        name: event.name,
        type: (isCutiBersama ? "cuti_bersama" : "nasional") as HolidayType,
        deducts_leave: isCutiBersama,
        status: (tentatif ? "draft" : "aktif") as "draft" | "aktif",
        suggested: !bukanLibur,
        reason:
          bukanLibur?.reason ??
          (tentatif
            ? "Sumbernya menandai tanggal ini belum pasti — masuk sebagai draft"
            : undefined),
      };
    })
    .sort((a, b) =>
      a.holiday_date === b.holiday_date
        ? a.name.localeCompare(b.name)
        : a.holiday_date.localeCompare(b.holiday_date)
    );
}
