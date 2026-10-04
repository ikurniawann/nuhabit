import { brandName } from "@/lib/branding";

/**
 * EPIC-012 Fase D — aturan customer service: jam operasional, SLA respons,
 * dan pembacaan skor CSAT. Fungsi murni, tanpa DB/jaringan, agar bisa diuji.
 *
 * Semua batas kalender memakai WIB eksplisit lewat aritmetika UTC — bukan
 * getter lokal — supaya hasilnya sama walau proses berjalan di infra ber-TZ
 * UTC (pelajaran dari EPIC-011 Fase F).
 */

export const WIB_OFFSET_HOURS = 7;

export const CS_CATEGORIES = ["produk", "layanan", "pembayaran", "lainnya"] as const;
export type CsCategory = (typeof CS_CATEGORIES)[number];

export const CS_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type CsPriority = (typeof CS_PRIORITIES)[number];

export const CATEGORY_LABELS: Record<CsCategory, string> = {
  produk: "Produk",
  layanan: "Layanan",
  pembayaran: "Pembayaran",
  lainnya: "Lainnya",
};

export const PRIORITY_LABELS: Record<CsPriority, string> = {
  low: "Rendah",
  normal: "Normal",
  high: "Tinggi",
  urgent: "Mendesak",
};

export interface CsSettings {
  slaResponseMinutes: number;
  slaResolutionMinutes: number;
  businessHoursStart: number;
  businessHoursEnd: number;
  autoReplyEnabled: boolean;
  autoReplyText: string;
  csatEnabled: boolean;
  csatText: string;
}

export const CS_DEFAULTS: CsSettings = {
  slaResponseMinutes: 15,
  slaResolutionMinutes: 1440,
  businessHoursStart: 10,
  businessHoursEnd: 22,
  autoReplyEnabled: true,
  autoReplyText:
    `Terima kasih sudah menghubungi ${brandName()}. Saat ini di luar jam operasional kami. Pesan Anda sudah kami terima dan akan dibalas pada jam operasional berikutnya.`,
  csatEnabled: true,
  csatText:
    "Terima kasih sudah menghubungi kami. Boleh beri penilaian layanan kami? Balas dengan angka 1-5 (5 = sangat puas).",
};

/** Jam dinding WIB (0-23) dari sebuah instan. */
export function wibHour(at: Date): number {
  return new Date(at.getTime() + WIB_OFFSET_HOURS * 3600_000).getUTCHours();
}

/** Tanggal kalender WIB dalam format YYYY-MM-DD. */
export function wibDateKey(at: Date): string {
  return new Date(at.getTime() + WIB_OFFSET_HOURS * 3600_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Apakah `at` berada di dalam jam operasional. Rentang yang melewati tengah
 * malam (mis. 20-02) ikut ditangani.
 */
export function isWithinBusinessHours(
  at: Date,
  start: number,
  end: number
): boolean {
  const hour = wibHour(at);
  if (start === end) return true; // 24 jam
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end; // melewati tengah malam
}

export interface SlaState {
  /** Detik sejak pesan customer menunggu dibalas. */
  waitingSeconds: number;
  breached: boolean;
  /** Detik tersisa sebelum melanggar; 0 bila sudah lewat. */
  remainingSeconds: number;
}

export function evaluateResponseSla(
  awaitingSince: Date | string | null,
  slaResponseMinutes: number,
  now: Date = new Date()
): SlaState | null {
  if (!awaitingSince) return null;

  const since = awaitingSince instanceof Date ? awaitingSince : new Date(awaitingSince);
  if (Number.isNaN(since.getTime())) return null;

  const waitingSeconds = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 1000));
  const limitSeconds = Math.max(0, slaResponseMinutes) * 60;

  return {
    waitingSeconds,
    breached: waitingSeconds > limitSeconds,
    remainingSeconds: Math.max(0, limitSeconds - waitingSeconds),
  };
}

/**
 * Baca skor CSAT dari balasan customer. Hanya menerima pesan yang memang
 * berisi angka 1-5 sebagai jawaban — bukan angka yang kebetulan muncul di
 * kalimat panjang (mis. "pesanan saya nomor 3 belum datang").
 */
export function parseCsatReply(body: string | null): number | null {
  if (!body) return null;

  const trimmed = body.trim();
  // Terima "4", "4 ", "4.", "4!", atau "nilai 4" — maksimal 2 kata.
  const match = trimmed.match(/^(?:\D{0,10}?)([1-5])\s*[.!]?$/);
  if (!match) return null;
  if (trimmed.split(/\s+/).length > 2) return null;

  return Number(match[1]);
}

/** Format durasi detik jadi teks ringkas Indonesia (mis. "2j 15m"). */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "-";
  if (seconds < 60) return `${Math.floor(seconds)}d`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes > 0 ? `${hours}j ${restMinutes}m` : `${hours}j`;

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days}h ${restHours}j` : `${days}h`;
}
