import { normalizeKeywordList } from "./keywords";
import type { ConversationInsight, Sentiment, TranscriptMessage } from "./types";

/**
 * Penyusun prompt & pembaca jawaban model — murni, tanpa I/O.
 *
 * Model hanya diminta MENGANALISA teks yang kita kirim dan menjawab JSON; ia
 * tidak diberi alat apa pun. Semua keluarannya divalidasi di sini karena model
 * sesekali mengarang bentuk (menambah pagar kode, mengubah nama field, atau
 * mengirim sentimen di luar daftar).
 */

/** Batas panjang transkrip yang dikirim ke model — penjaga biaya token. */
export const MAX_TRANSCRIPT_CHARS = 6000;

const TRUNCATION_MARKER = "\n… (bagian tengah percakapan dipotong) …\n";

/**
 * Transkrip → teks berlabel. Bila terlalu panjang, yang dipertahankan adalah
 * AWAL dan AKHIR percakapan: pembuka biasanya memuat inti permintaan/keluhan,
 * penutup memuat hasil akhirnya. Memotong buntutnya saja akan membuat
 * percakapan panjang selalu terbaca "belum selesai".
 */
export function transcriptToText(
  messages: TranscriptMessage[],
  maxChars = MAX_TRANSCRIPT_CHARS
): string {
  const lines = messages
    .filter((message) => typeof message.body === "string" && message.body.trim())
    .map((message) => `${message.direction === "in" ? "Pelanggan" : "Agen"}: ${message.body.trim()}`);
  const full = lines.join("\n");
  if (full.length <= maxChars) return full;

  const half = Math.floor((maxChars - TRUNCATION_MARKER.length) / 2);
  return full.slice(0, half) + TRUNCATION_MARKER + full.slice(full.length - half);
}

const SYSTEM_PROMPT = [
  "Kamu menganalisa percakapan layanan pelanggan berbahasa Indonesia.",
  "Jawab HANYA dengan satu objek JSON tanpa penjelasan tambahan dan tanpa pagar kode.",
  "Bentuk JSON: {\"summary\": string, \"topic\": string, \"sentiment\": \"positif\"|\"netral\"|\"negatif\", \"is_complaint\": boolean, \"keywords\": string[]}.",
  "summary: 1-2 kalimat ringkas berisi inti permintaan pelanggan dan hasil akhirnya.",
  "topic: label singkat maksimal 4 kata, huruf kecil, mis. \"keluhan pengiriman\" atau \"tanya harga\".",
  "sentiment: perasaan pelanggan, bukan perasaan agen.",
  "is_complaint: true hanya bila pelanggan menyatakan ketidakpuasan atau masalah nyata.",
  "keywords: 3-8 kata/frasa kunci spesifik dari isi percakapan (produk, masalah, lokasi, layanan).",
  "Jangan memasukkan nama orang, nomor telepon, atau alamat ke keywords maupun topic.",
  "Bila percakapan terlalu pendek atau tidak bermakna, tetap jawab JSON dengan topic \"tidak jelas\".",
].join(" ");

/** Pesan chat-completions siap kirim (bentuk umum, cocok untuk API OpenAI). */
export function buildAnalysisMessages(
  transcript: TranscriptMessage[],
  maxChars = MAX_TRANSCRIPT_CHARS
): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Percakapan:\n${transcriptToText(transcript, maxChars)}` },
  ];
}

/** Buang pagar kode ```json … ``` yang sering ditambahkan model. */
function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/```\s*$/, "")
    .trim();
}

function clampText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? cleaned.slice(0, max).trim() : cleaned;
}

function toSentiment(value: unknown): Sentiment {
  const text = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (text === "positif" || text === "positive") return "positif";
  if (text === "negatif" || text === "negative") return "negatif";
  return "netral";
}

/**
 * Baca jawaban model menjadi insight tervalidasi. Mengembalikan null hanya bila
 * jawabannya sama sekali bukan JSON objek — pemanggil memperlakukan itu sebagai
 * kegagalan analisa dan boleh mencoba lagi nanti.
 */
export function parseInsight(rawContent: unknown): ConversationInsight | null {
  if (typeof rawContent !== "string" || !rawContent.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(rawContent));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const source = parsed as Record<string, unknown>;
  const summary = clampText(source.summary, 500);
  const topic = clampText(source.topic, 60).toLowerCase() || "tidak jelas";

  return {
    summary,
    topic,
    sentiment: toSentiment(source.sentiment),
    is_complaint: source.is_complaint === true,
    keywords: normalizeKeywordList(source.keywords),
  };
}
