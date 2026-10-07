import type {
  ConversationInsight,
  KeywordStat,
  SentimentBreakdown,
  TopicStat,
} from "./types";

/**
 * Normalisasi & agregasi kata kunci — murni, tanpa I/O.
 *
 * Kenapa stopword-nya ditulis manual dan bukan memakai paket NLP: daftar ini
 * cuma perlu menyaring kata perekat bahasa Indonesia dari keluaran model, dan
 * modul ini wajib bebas dependensi agar bisa dipakai dua repo.
 */

/** Kata perekat bahasa Indonesia + sapaan yang tidak informatif sebagai topik. */
export const STOPWORDS_ID = new Set([
  "yang", "dan", "di", "ke", "dari", "untuk", "dengan", "pada", "adalah", "itu",
  "ini", "atau", "juga", "sudah", "belum", "tidak", "bukan", "ada", "akan",
  "saya", "aku", "kami", "kita", "anda", "kamu", "dia", "mereka",
  "bisa", "boleh", "mau", "ingin", "harus", "saja", "aja", "kok", "sih", "dong",
  "ya", "iya", "oke", "ok", "gak", "ngga", "nggak", "tak", "nya",
  "pak", "bu", "bapak", "ibu", "mas", "mbak", "kak", "bang",
  "terima", "kasih", "tolong", "mohon", "selamat", "halo", "hai", "assalamualaikum",
  "pagi", "siang", "sore", "malam",
  "apa", "kapan", "dimana", "mana", "kenapa", "bagaimana", "gimana", "berapa",
  "lagi", "masih", "sangat", "sekali", "banget", "agak", "cuma", "hanya",
]);

const MIN_KEYWORD_LENGTH = 3;
const MAX_KEYWORD_LENGTH = 40;

/**
 * Rapikan satu kata kunci dari model. Mengembalikan string kosong bila kata
 * itu tidak layak dipakai (stopword, terlalu pendek, hanya angka/simbol).
 */
export function normalizeKeyword(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < MIN_KEYWORD_LENGTH || cleaned.length > MAX_KEYWORD_LENGTH) return "";
  // Hanya angka bukan kata kunci yang berguna ("2", "10rb" tetap dibuang).
  if (!/\p{L}{3}/u.test(cleaned)) return "";
  // Frasa dinilai per kata: kalau semua katanya stopword, buang.
  const words = cleaned.split(" ");
  if (words.every((word) => STOPWORDS_ID.has(word))) return "";
  return cleaned;
}

/** Bersihkan + buang duplikat dalam satu percakapan, batasi jumlahnya. */
export function normalizeKeywordList(raw: unknown, max = 8): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const keyword = normalizeKeyword(item);
    if (keyword && !out.includes(keyword)) out.push(keyword);
    if (out.length >= max) break;
  }
  return out;
}

type InsightLike = Pick<ConversationInsight, "keywords">;

/**
 * Peringkat kata kunci lintas percakapan.
 *
 * `count` = total kemunculan, `conversations` = jumlah percakapan berbeda.
 * Keduanya dipisah karena satu percakapan yang mengulang kata yang sama tidak
 * boleh terlihat seperti keluhan banyak orang.
 */
export function aggregateKeywords(insights: InsightLike[], limit = 30): KeywordStat[] {
  const stats = new Map<string, { count: number; conversations: number }>();

  for (const insight of insights) {
    const seenInThisConversation = new Set<string>();
    for (const raw of insight.keywords ?? []) {
      const keyword = normalizeKeyword(raw);
      if (!keyword) continue;
      const entry = stats.get(keyword) ?? { count: 0, conversations: 0 };
      entry.count += 1;
      if (!seenInThisConversation.has(keyword)) {
        entry.conversations += 1;
        seenInThisConversation.add(keyword);
      }
      stats.set(keyword, entry);
    }
  }

  return [...stats.entries()]
    .map(([keyword, entry]) => ({ keyword, ...entry }))
    .sort((a, b) =>
      b.conversations - a.conversations || b.count - a.count || a.keyword.localeCompare(b.keyword, "id")
    )
    .slice(0, limit);
}

/** Distribusi topik, terbanyak lebih dulu. */
export function topicDistribution(
  insights: Pick<ConversationInsight, "topic">[],
  limit = 15
): TopicStat[] {
  const counts = new Map<string, number>();
  for (const insight of insights) {
    const topic = typeof insight.topic === "string" ? insight.topic.trim().toLowerCase() : "";
    if (!topic) continue;
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic, "id"))
    .slice(0, limit);
}

export function sentimentBreakdown(
  insights: Pick<ConversationInsight, "sentiment">[]
): SentimentBreakdown {
  const out: SentimentBreakdown = { positif: 0, netral: 0, negatif: 0 };
  for (const insight of insights) {
    if (insight.sentiment === "positif" || insight.sentiment === "negatif" || insight.sentiment === "netral") {
      out[insight.sentiment] += 1;
    }
  }
  return out;
}
