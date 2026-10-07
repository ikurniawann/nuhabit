/**
 * Periode papan desktop & pembandingnya (EPIC-037 Fase A).
 *
 * Modul murni — tanpa I/O, supaya matematika tanggalnya bisa diuji habis.
 *
 * Kenapa modul ini ada: papan owner membandingkan periode BERJALAN dengan masa
 * lalu. Kalau MTD yang baru jalan 15 hari dibandingkan dengan bulan lalu PENUH,
 * setiap bulan akan tampak anjlok ~50% dan owner akan mempercayainya. Semua
 * pembanding di sini karena itu apples-to-apples: jendela yang sama panjangnya,
 * dan bila tidak bisa sama (31 Maret vs Februari), jendelanya dipotong lalu
 * DITANDAI `penuh: false` supaya widget bisa memberi tahu pembacanya.
 *
 * Seluruh tanggal adalah tanggal operasional WIB — tanggal server belum tentu
 * sama (23:30 UTC sudah besok di Jakarta).
 */

export const PERIOD_KINDS = ["today", "mtd", "qtd", "ytd"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export const PERIOD_LABELS: Record<PeriodKind, string> = {
  today: "Hari Ini",
  mtd: "Bulan Berjalan",
  qtd: "Kuartal Berjalan",
  ytd: "Tahun Berjalan",
};

export interface Period {
  kind: PeriodKind;
  /** Tanggal mulai inklusif, YYYY-MM-DD WIB. */
  mulai: string;
  /** Tanggal akhir inklusif (hari ini), YYYY-MM-DD WIB. */
  selesai: string;
  /** Hari yang sudah berjalan, termasuk hari ini. */
  hariBerjalan: number;
  /** Panjang periode penuh — dasar proyeksi run-rate. */
  totalHari: number;
}

export interface Comparison {
  mulai: string;
  selesai: string;
  /** Panjang jendela pembanding. Bisa lebih pendek dari `hariBerjalan`. */
  hariBanding: number;
  /**
   * `false` bila jendela pembanding terpaksa lebih pendek (mis. 31 Maret tidak
   * punya padanan di Februari). Widget wajib menandainya, karena membandingkan
   * 31 hari dengan 28 hari tanpa keterangan adalah angka yang menyesatkan.
   */
  penuh: boolean;
}

const MS_PER_DAY = 86_400_000;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function iso(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Bagian tanggal WIB dari sebuah instant. */
function jakartaParts(now: Date): { year: number; month: number; day: number } {
  const shifted = new Date(now.getTime() + WIB_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function toUtcMs(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function addDays(dateIso: string, days: number): string {
  const next = new Date(toUtcMs(dateIso) + days * MS_PER_DAY);
  return iso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/** Selisih hari inklusif: mulai dan selesai sama → 1. */
function inclusiveDays(mulai: string, selesai: string): number {
  return Math.round((toUtcMs(selesai) - toUtcMs(mulai)) / MS_PER_DAY) + 1;
}

/** Bulan pertama kuartal yang memuat `month` (1, 4, 7, 10). */
function quarterStartMonth(month: number): number {
  return month - ((month - 1) % 3);
}

function quarterDays(year: number, startMonth: number): number {
  return (
    daysInMonth(year, startMonth) +
    daysInMonth(year, startMonth + 1) +
    daysInMonth(year, startMonth + 2)
  );
}

export function resolvePeriod(kind: PeriodKind, now = new Date()): Period {
  const { year, month, day } = jakartaParts(now);
  const selesai = iso(year, month, day);

  switch (kind) {
    case "today":
      return { kind, mulai: selesai, selesai, hariBerjalan: 1, totalHari: 1 };

    case "mtd": {
      const mulai = iso(year, month, 1);
      return {
        kind,
        mulai,
        selesai,
        hariBerjalan: day,
        totalHari: daysInMonth(year, month),
      };
    }

    case "qtd": {
      const startMonth = quarterStartMonth(month);
      const mulai = iso(year, startMonth, 1);
      return {
        kind,
        mulai,
        selesai,
        hariBerjalan: inclusiveDays(mulai, selesai),
        totalHari: quarterDays(year, startMonth),
      };
    }

    case "ytd": {
      const mulai = iso(year, 1, 1);
      return {
        kind,
        mulai,
        selesai,
        hariBerjalan: inclusiveDays(mulai, selesai),
        totalHari: isLeap(year) ? 366 : 365,
      };
    }
  }
}

export function resolveComparison(period: Period): Comparison {
  const [year, month, day] = period.selesai.split("-").map(Number);

  switch (period.kind) {
    case "today": {
      // Hari yang sama minggu lalu, bukan kemarin: pola weekend/weekday
      // mendominasi, jadi Sabtu vs Jumat menyesatkan.
      const target = addDays(period.selesai, -7);
      return { mulai: target, selesai: target, hariBanding: 1, penuh: true };
    }

    case "mtd": {
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      // 31 Maret tidak punya padanan di Februari — jendela dipotong, bukan
      // dipanjangkan ke Maret, dan ketidakadilannya ditandai lewat `penuh`.
      const hariBanding = Math.min(day, daysInMonth(prevYear, prevMonth));
      return {
        mulai: iso(prevYear, prevMonth, 1),
        selesai: iso(prevYear, prevMonth, hariBanding),
        hariBanding,
        penuh: hariBanding === period.hariBerjalan,
      };
    }

    case "qtd": {
      const startMonth = quarterStartMonth(month);
      const prevStartMonth = startMonth === 1 ? 10 : startMonth - 3;
      const prevYear = startMonth === 1 ? year - 1 : year;
      const prevMulai = iso(prevYear, prevStartMonth, 1);
      const hariBanding = Math.min(
        period.hariBerjalan,
        quarterDays(prevYear, prevStartMonth)
      );
      return {
        mulai: prevMulai,
        selesai: addDays(prevMulai, hariBanding - 1),
        hariBanding,
        penuh: hariBanding === period.hariBerjalan,
      };
    }

    case "ytd": {
      const prevYear = year - 1;
      // 29 Februari tidak ada di tahun biasa — mundur ke 28.
      const targetDay =
        month === 2 && day === 29 && !isLeap(prevYear) ? 28 : day;
      const mulai = iso(prevYear, 1, 1);
      const selesai = iso(prevYear, month, targetDay);
      const hariBanding = inclusiveDays(mulai, selesai);
      return {
        mulai,
        selesai,
        hariBanding,
        penuh: hariBanding === period.hariBerjalan,
      };
    }
  }
}

/** Periode yang sedang dilihat papan + jendela pembandingnya. */
export interface PeriodSummary {
  periode: Period;
  banding: Comparison;
}

/** Pasangan periode + pembandingnya — dipakai `buildDesktopOverview` dan fixture tes. */
export function summarizePeriod(kind: PeriodKind, now = new Date()): PeriodSummary {
  const periode = resolvePeriod(kind, now);
  return { periode, banding: resolveComparison(periode) };
}

/**
 * Proyeksi nilai akhir periode dari laju berjalan.
 * Untuk `today` totalHari = hariBerjalan = 1, jadi nilainya dikembalikan apa adanya.
 */
export function projectRunRate(nilai: number, period: Period): number {
  if (period.hariBerjalan <= 0) return 0;
  return Math.round((nilai / period.hariBerjalan) * period.totalHari);
}
