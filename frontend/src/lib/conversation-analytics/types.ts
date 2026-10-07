/**
 * Analitik percakapan — tipe bersama.
 *
 * PENTING: seluruh folder `conversation-analytics` sengaja BEBAS dependensi
 * aplikasi (tidak mengimpor next, pg, maupun `@/lib/*`). Modul ini dipakai dua
 * produk — arkiv-pos-saas dan repo `wagateway` — jadi ia harus bisa dipindah
 * apa adanya tanpa penyesuaian. Semua sentuhan DB, HTTP, dan auth tinggal di
 * lapisan pemanggil, bukan di sini.
 */

/** Satu pesan dalam transkrip; `direction` dari sudut pandang bisnis. */
export interface TranscriptMessage {
  direction: "in" | "out";
  body: string;
  at?: string;
}

export type Sentiment = "positif" | "netral" | "negatif";

/** Hasil analisa satu percakapan (bentuk yang disimpan sebagai cache). */
export interface ConversationInsight {
  /** Ringkasan 1–2 kalimat, bahasa Indonesia. */
  summary: string;
  /** Label topik singkat, mis. "keluhan pengiriman". */
  topic: string;
  sentiment: Sentiment;
  is_complaint: boolean;
  /** Kata kunci ternormalisasi (huruf kecil, tanpa stopword). */
  keywords: string[];
}

export interface KeywordStat {
  keyword: string;
  /** Total kemunculan di seluruh percakapan. */
  count: number;
  /** Jumlah percakapan berbeda yang memuat kata kunci ini. */
  conversations: number;
}

export interface TopicStat {
  topic: string;
  count: number;
}

export interface SentimentBreakdown {
  positif: number;
  netral: number;
  negatif: number;
}
