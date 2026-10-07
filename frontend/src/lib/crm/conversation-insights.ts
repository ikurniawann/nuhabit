import {
  aggregateKeywords,
  sentimentBreakdown,
  topicDistribution,
  type ConversationInsight,
  type KeywordStat,
  type SentimentBreakdown,
  type TopicStat,
  type TranscriptMessage,
} from "@/lib/conversation-analytics";

/**
 * EPIC-029 — logika murni analitik percakapan (tanpa DB, HTTP, maupun React).
 *
 * Dipisah dari `conversation-insights-server.ts` supaya keputusan yang paling
 * mudah salah — pemetaan `direction`, kapan cache dianggap masih sah, dan
 * bentuk baris laporan — bisa diuji tanpa Postgres maupun OpenAI.
 *
 * Agregasi memakai lib BERSAMA `@/lib/conversation-analytics` (dipakai juga
 * repo `wagateway`); modul ini hanya merangkai, tidak menyalin logikanya.
 */

/**
 * Jenis pesan yang ikut dianalisa.
 *
 * Hanya `chat` — yaitu percakapan dua arah yang sesungguhnya. `otp` memang
 * selalu ber-body NULL (aturan privasi EPIC-012), sedangkan `system`,
 * `notification`, dan `broadcast` adalah teks yang KAMI kirim otomatis
 * (auto-reply di luar jam kerja, permintaan CSAT, blast). Memasukkannya membuat
 * model meringkas kalimat robot kami sendiri, bukan keluhan pelanggan.
 */
export const ANALYZED_MESSAGE_TYPES = ["chat"] as const;

/** Batas pesan yang diambil per percakapan — penjaga biaya token & memori. */
export const MAX_TRANSCRIPT_MESSAGES = 300;

/** Batas default `analyzePending` — cegah borongan tak terbatas sekali klik. */
export const DEFAULT_PENDING_LIMIT = 25;
export const MAX_PENDING_LIMIT = 100;

/**
 * Batasi jumlah percakapan per batch. Nilai tak masuk akal (kosong, nol,
 * negatif, bukan angka) jatuh ke default alih-alih menolak permintaan —
 * tombolnya dipakai agent, bukan integrasi mesin.
 */
export function clampPendingLimit(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_PENDING_LIMIT;
  }
  return Math.min(Math.floor(value), MAX_PENDING_LIMIT);
}

/** Baris mentah `crm.wa_messages` sebatas kolom yang dipakai analisa. */
export type RawMessageRow = {
  direction?: unknown;
  body?: unknown;
  created_at?: unknown;
};

/**
 * Normalisasi `direction` kolom DB ke union milik lib bersama.
 *
 * Kolom `crm.wa_messages.direction` sudah dibatasi CHECK ke 'in'|'out', tapi
 * pemetaan ini tetap eksplisit: repo `wagateway` memakai istilah
 * inbound/outbound, dan data hasil impor kanal lain bisa membawa ejaan itu.
 * Apa pun yang tidak dikenali dianggap `out` — salah menandai pesan agen
 * sebagai suara pelanggan akan membalik sentimen laporan.
 */
export function normalizeDirection(raw: unknown): "in" | "out" {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "in" || value === "inbound" || value === "incoming" || value === "received") {
    return "in";
  }
  return "out";
}

function toIsoOrUndefined(raw: unknown): string | undefined {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? undefined : raw.toISOString();
  if (typeof raw === "string" && raw.trim()) return raw;
  return undefined;
}

/**
 * Baris DB → transkrip untuk lib bersama. Pesan tanpa isi teks dibuang
 * (media/otp) karena model hanya bisa menilai teks; membiarkannya masuk sebagai
 * string kosong hanya menambah baris "Pelanggan:" hampa ke prompt.
 */
export function toTranscriptMessages(rows: RawMessageRow[]): TranscriptMessage[] {
  const out: TranscriptMessage[] = [];
  for (const row of rows) {
    const body = typeof row.body === "string" ? row.body.trim() : "";
    if (!body) continue;
    out.push({
      direction: normalizeDirection(row.direction),
      body,
      at: toIsoOrUndefined(row.created_at),
    });
  }
  return out;
}

/** Insight tersimpan (cache) apa adanya dari tabel. */
export type StoredInsight = ConversationInsight & {
  conversation_id: string;
  fingerprint: string;
  model: string | null;
  analyzed_at: string | null;
};

/**
 * Apakah percakapan perlu dikirim ke OpenAI?
 *
 * Inti penghematan token: transkrip yang isinya tidak berubah TIDAK dianalisa
 * ulang, sebanyak apa pun laporan dibuka. Cache dianggap basi bila belum ada,
 * atau sidik jarinya beda (ada pesan baru / pesan disunting).
 */
export function needsAnalysis(
  stored: Pick<StoredInsight, "fingerprint"> | null | undefined,
  fingerprint: string
): boolean {
  if (!stored) return true;
  if (!stored.fingerprint) return true;
  return stored.fingerprint !== fingerprint;
}

/** Hasil satu percakapan; `status` dipakai UI untuk menjelaskan apa yang terjadi. */
export type AnalyzeStatus = "cache" | "analyzed" | "empty" | "failed";

export type AnalyzeResult = {
  conversation_id: string;
  status: AnalyzeStatus;
  insight: ConversationInsight | null;
  /** Terisi hanya saat `status === "failed"` — ditampilkan apa adanya ke agent. */
  error?: string;
};

export type AnalyzeBatchSummary = {
  requested: number;
  analyzed: number;
  cached: number;
  empty: number;
  failed: number;
};

export function summarizeBatch(results: AnalyzeResult[]): AnalyzeBatchSummary {
  const summary: AnalyzeBatchSummary = {
    requested: results.length,
    analyzed: 0,
    cached: 0,
    empty: 0,
    failed: 0,
  };
  for (const result of results) {
    if (result.status === "analyzed") summary.analyzed += 1;
    else if (result.status === "cache") summary.cached += 1;
    else if (result.status === "empty") summary.empty += 1;
    else summary.failed += 1;
  }
  return summary;
}

/**
 * Bentuk laporan agregat.
 *
 * SENGAJA bebas PII: tidak ada isi chat, nomor telepon, nama customer, maupun
 * id percakapan — konsisten dengan `api/crm/reports/cs/route.ts`. Ringkasan
 * per percakapan (`summary`) hanya boleh keluar lewat endpoint inbox.
 */
export type ConversationInsightReport = {
  period: { from: string; to: string };
  summary: {
    total_conversations: number;
    analyzed: number;
    not_analyzed: number;
    complaints: number;
    sentiment: SentimentBreakdown;
  };
  keywords: KeywordStat[];
  topics: TopicStat[];
};

/** Insight sebatas kolom yang boleh masuk laporan agregat (tanpa summary). */
export type AggregatableInsight = Pick<
  ConversationInsight,
  "topic" | "sentiment" | "is_complaint" | "keywords"
>;

export function buildInsightReport(
  insights: AggregatableInsight[],
  options: {
    period: { from: string; to: string };
    totalConversations: number;
    keywordLimit?: number;
    topicLimit?: number;
  }
): ConversationInsightReport {
  const analyzed = insights.length;
  // Percakapan bisa saja lebih sedikit dari insight bila periode dipersempit
  // setelah analisa; jangan biarkan angkanya negatif di layar.
  const notAnalyzed = Math.max(0, options.totalConversations - analyzed);

  return {
    period: options.period,
    summary: {
      total_conversations: options.totalConversations,
      analyzed,
      not_analyzed: notAnalyzed,
      complaints: insights.filter((insight) => insight.is_complaint).length,
      sentiment: sentimentBreakdown(insights),
    },
    keywords: aggregateKeywords(insights, options.keywordLimit ?? 30),
    topics: topicDistribution(insights, options.topicLimit ?? 15),
  };
}

/** Satu sheet XLSX sebagai matriks — dirakit di sini agar bisa diuji polos. */
export type ReportSheet = { name: string; rows: (string | number)[][] };

/**
 * Laporan → tiga sheet siap ditulis `xlsx`.
 *
 * Header berbahasa Indonesia karena file ini dibuka manajemen / di-import ke
 * Google Sheet. Nama sheet dijaga <= 31 karakter (batas format XLSX).
 */
export function buildReportSheets(report: ConversationInsightReport): ReportSheet[] {
  const { summary, period } = report;

  return [
    {
      name: "Ringkasan",
      rows: [
        ["Laporan Analitik Percakapan"],
        ["Periode", `${period.from} s/d ${period.to}`],
        [],
        ["Metrik", "Jumlah"],
        ["Percakapan pada periode", summary.total_conversations],
        ["Sudah dianalisa", summary.analyzed],
        ["Belum dianalisa", summary.not_analyzed],
        ["Terindikasi komplain", summary.complaints],
        ["Sentimen positif", summary.sentiment.positif],
        ["Sentimen netral", summary.sentiment.netral],
        ["Sentimen negatif", summary.sentiment.negatif],
        [],
        ["Catatan", "Laporan agregat: tanpa isi chat, nomor telepon, dan nama customer."],
      ],
    },
    {
      name: "Kata Kunci",
      rows: [
        ["Kata Kunci", "Jumlah Percakapan", "Total Kemunculan"],
        ...report.keywords.map((row) => [row.keyword, row.conversations, row.count]),
      ],
    },
    {
      name: "Topik",
      rows: [
        ["Topik", "Jumlah Percakapan"],
        ...report.topics.map((row) => [row.topic, row.count]),
      ],
    },
  ];
}

/** Nama file export — bertanggal agar tidak saling menimpa di folder unduhan. */
export function reportFileName(period: { from: string; to: string }): string {
  return `analitik-percakapan-${period.from}_${period.to}.xlsx`;
}
