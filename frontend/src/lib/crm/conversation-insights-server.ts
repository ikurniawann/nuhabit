import "server-only";
import type { Pool, PoolClient } from "pg";
import { getPool } from "@/lib/db";
import {
  buildAnalysisMessages,
  fingerprintTranscript,
  normalizeKeywordList,
  parseInsight,
  type ConversationInsight,
  type TranscriptMessage,
} from "@/lib/conversation-analytics";
import {
  modelSupportsTemperature,
  resolveAiAssistantModel,
  stripOpenAiPrefix,
} from "@/lib/ai-assistant-config";
import { OPENAI_DEFAULTS, SETTING_KEYS, getSettings } from "@/lib/settings/app-settings";
import {
  ANALYZED_MESSAGE_TYPES,
  MAX_TRANSCRIPT_MESSAGES,
  buildInsightReport,
  clampPendingLimit,
  needsAnalysis,
  summarizeBatch,
  toTranscriptMessages,
  type AggregatableInsight,
  type AnalyzeBatchSummary,
  type AnalyzeResult,
  type ConversationInsightReport,
  type StoredInsight,
} from "./conversation-insights";

/**
 * EPIC-029 — sisi server analitik percakapan: baca transkrip, panggil OpenAI,
 * simpan cache insight, dan susun laporan agregat.
 *
 * Aturan yang dijaga modul ini:
 * 1. **Cache dulu.** Transkrip yang sidik jarinya sama TIDAK dikirim ke OpenAI.
 *    Tanpa ini, membuka laporan berkali-kali = menagih ulang token yang sama.
 * 2. **Kegagalan tidak menular.** Error OpenAI/parse dikembalikan sebagai status
 *    `failed`, tidak dilempar ke atas, supaya satu percakapan bermasalah tidak
 *    membatalkan seluruh batch.
 * 3. **Laporan agregat bebas PII.** Fungsi laporan hanya membaca topic,
 *    sentiment, is_complaint, dan keywords — `summary` tidak pernah keluar dari
 *    jalur laporan.
 *
 * Logika murninya ada di `./conversation-insights.ts` (teruji unit), agregasi
 * kata kunci/topik/sentimen memakai lib bersama `@/lib/conversation-analytics`.
 */

type Db = Pool | PoolClient;

/** Timeout satu panggilan analisa. Transkrip pendek; 60 detik sudah longgar. */
const ANALYSIS_TIMEOUT_MS = 60_000;

// Batas batch dire-export supaya route API tidak perlu tahu ada dua modul.
export { DEFAULT_PENDING_LIMIT, MAX_PENDING_LIMIT } from "./conversation-insights";

// --- Transkrip ---------------------------------------------------------------

/**
 * Transkrip satu percakapan, urut waktu, dibatasi `MAX_TRANSCRIPT_MESSAGES`.
 *
 * Bila percakapan lebih panjang dari batas, yang diambil adalah pesan TERBARU
 * (ORDER BY created_at DESC lalu dibalik) — konteks paling relevan untuk menilai
 * hasil akhir percakapan. Pemotongan berikutnya (per karakter) dilakukan lib
 * bersama saat menyusun prompt.
 */
export async function fetchTranscript(
  db: Db,
  conversationId: string,
  limit = MAX_TRANSCRIPT_MESSAGES
): Promise<TranscriptMessage[]> {
  const { rows } = await db.query(
    `SELECT direction, body, created_at
       FROM (
         SELECT direction, body, created_at
           FROM crm.wa_messages
          WHERE conversation_id = $1
            AND body IS NOT NULL
            AND message_type = ANY($2)
          ORDER BY created_at DESC
          LIMIT $3
       ) recent
      ORDER BY created_at ASC`,
    [conversationId, [...ANALYZED_MESSAGE_TYPES], limit]
  );
  return toTranscriptMessages(rows);
}

// --- Cache -------------------------------------------------------------------

function rowToStoredInsight(row: Record<string, unknown>): StoredInsight {
  return {
    conversation_id: String(row.conversation_id ?? ""),
    summary: typeof row.summary === "string" ? row.summary : "",
    topic: typeof row.topic === "string" ? row.topic : "",
    sentiment:
      row.sentiment === "positif" || row.sentiment === "negatif" ? row.sentiment : "netral",
    is_complaint: row.is_complaint === true,
    // jsonb sudah ter-parse pg menjadi array; tetap lewat normalisasi lib
    // supaya baris lama (mis. hasil model versi sebelumnya) ikut dirapikan.
    keywords: normalizeKeywordList(row.keywords),
    fingerprint: typeof row.fingerprint === "string" ? row.fingerprint : "",
    model: typeof row.model === "string" ? row.model : null,
    analyzed_at:
      row.analyzed_at instanceof Date
        ? row.analyzed_at.toISOString()
        : typeof row.analyzed_at === "string"
          ? row.analyzed_at
          : null,
  };
}

export async function getStoredInsight(
  db: Db,
  conversationId: string
): Promise<StoredInsight | null> {
  const { rows } = await db.query(
    `SELECT conversation_id, summary, topic, sentiment, is_complaint, keywords,
            fingerprint, model, analyzed_at
       FROM crm.wa_conversation_insights
      WHERE conversation_id = $1`,
    [conversationId]
  );
  return rows[0] ? rowToStoredInsight(rows[0] as Record<string, unknown>) : null;
}

async function upsertInsight(
  db: Db,
  conversationId: string,
  insight: ConversationInsight,
  fingerprint: string,
  model: string
): Promise<void> {
  await db.query(
    `INSERT INTO crm.wa_conversation_insights
       (conversation_id, summary, topic, sentiment, is_complaint, keywords,
        fingerprint, model, analyzed_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now())
     ON CONFLICT (conversation_id) DO UPDATE
        SET summary = EXCLUDED.summary,
            topic = EXCLUDED.topic,
            sentiment = EXCLUDED.sentiment,
            is_complaint = EXCLUDED.is_complaint,
            keywords = EXCLUDED.keywords,
            fingerprint = EXCLUDED.fingerprint,
            model = EXCLUDED.model,
            analyzed_at = now()`,
    [
      conversationId,
      insight.summary,
      insight.topic,
      insight.sentiment,
      insight.is_complaint,
      JSON.stringify(insight.keywords),
      fingerprint,
      model,
    ]
  );
}

// --- Panggilan OpenAI --------------------------------------------------------

type OpenAiCall = { apiKey: string; baseUrl: string; model: string };

/**
 * Kredensial + model dari Settings → Integrasi, fallback ke env.
 * Pola sama dengan `resolveOpenAiCall()` di `api/ai/assistant/route.ts`.
 */
async function resolveOpenAiCall(): Promise<OpenAiCall> {
  const settings = await getSettings([
    SETTING_KEYS.OPENAI_API_KEY,
    SETTING_KEYS.OPENAI_BASE_URL,
    SETTING_KEYS.OPENAI_MODEL,
  ]);
  const apiKey = settings[SETTING_KEYS.OPENAI_API_KEY] || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "API key OpenAI belum tersedia (env OPENAI_API_KEY maupun Settings → Integrasi kosong)"
    );
  }
  // Setting menyimpan id polos ("gpt-4o-mini"); `resolveAiAssistantModel` hanya
  // mengenal id ber-prefix, jadi prefiks dulu sebelum divalidasi. Id yang tidak
  // dikenal jatuh ke model default, bukan error.
  const rawModel = settings[SETTING_KEYS.OPENAI_MODEL]?.trim() || OPENAI_DEFAULTS.model;
  return {
    apiKey,
    baseUrl: (settings[SETTING_KEYS.OPENAI_BASE_URL] || OPENAI_DEFAULTS.baseUrl).replace(/\/$/, ""),
    model: resolveAiAssistantModel(`openai:${stripOpenAiPrefix(rawModel)}`),
  };
}

function buildRequestBody(
  model: string,
  messages: Array<{ role: string; content: string }>,
  jsonMode: boolean
): string {
  return JSON.stringify({
    model: stripOpenAiPrefix(model),
    // Analisa harus stabil: transkrip sama sebaiknya menghasilkan label sama.
    // Sebagian model generasi baru menolak temperature selain 1 (HTTP 400).
    ...(modelSupportsTemperature(model) ? { temperature: 0 } : {}),
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    messages,
  });
}

/**
 * Satu panggilan chat-completions non-stream, mengembalikan teks jawaban.
 *
 * `response_format: json_object` dicoba lebih dulu karena memaksa model
 * menjawab JSON valid. Model/base URL yang tidak mengenal parameter itu
 * membalas HTTP 400 — dalam kasus itu panggilan diulang SEKALI tanpa
 * `response_format`; `parseInsight` tetap sanggup membaca jawaban ber-pagar
 * kode, jadi tidak ada yang hilang.
 */
async function requestInsightText(
  call: OpenAiCall,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const send = async (jsonMode: boolean) =>
    fetch(`${call.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${call.apiKey}` },
      body: buildRequestBody(call.model, messages, jsonMode),
      signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
    });

  let response = await send(true);
  if (response.status === 400) {
    response = await send(false);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Jawaban OpenAI kosong");
  }
  return content;
}

// --- Analisa -----------------------------------------------------------------

/**
 * Analisa satu percakapan.
 *
 * Alur: transkrip → sidik jari → **cache-hit? berhenti di sini (tanpa OpenAI)**
 * → prompt → OpenAI → parse → upsert.
 *
 * Tidak pernah melempar untuk kegagalan analisa; `status: "failed"` beserta
 * pesannya dikembalikan agar batch bisa lanjut ke percakapan berikutnya.
 * Percakapan tanpa pesan teks menghasilkan `status: "empty"` dan TIDAK memanggil
 * OpenAI (tidak ada yang bisa diringkas).
 *
 * `force: true` melewati cache — dipakai bila agent sengaja meminta analisa ulang.
 */
export async function analyzeConversation(
  db: Db = getPool(),
  conversationId: string,
  options: { force?: boolean } = {}
): Promise<AnalyzeResult> {
  let transcript: TranscriptMessage[];
  let stored: StoredInsight | null;
  try {
    [transcript, stored] = await Promise.all([
      fetchTranscript(db, conversationId),
      getStoredInsight(db, conversationId),
    ]);
  } catch (error) {
    return {
      conversation_id: conversationId,
      status: "failed",
      insight: null,
      error: error instanceof Error ? error.message : "Gagal membaca percakapan",
    };
  }

  if (transcript.length === 0) {
    return { conversation_id: conversationId, status: "empty", insight: stored ?? null };
  }

  const fingerprint = fingerprintTranscript(transcript);
  if (!options.force && !needsAnalysis(stored, fingerprint)) {
    // Cache masih sah — inilah jalur yang menekan biaya token.
    return { conversation_id: conversationId, status: "cache", insight: stored };
  }

  try {
    const call = await resolveOpenAiCall();
    const raw = await requestInsightText(call, buildAnalysisMessages(transcript));
    const insight = parseInsight(raw);
    if (!insight) {
      return {
        conversation_id: conversationId,
        status: "failed",
        insight: stored ?? null,
        error: "Jawaban AI tidak bisa dibaca sebagai JSON",
      };
    }
    await upsertInsight(db, conversationId, insight, fingerprint, call.model);
    return { conversation_id: conversationId, status: "analyzed", insight };
  } catch (error) {
    // Sengaja tidak dilempar: satu percakapan gagal tidak boleh membatalkan batch.
    const message = error instanceof Error ? error.message : "Analisa gagal";
    console.error(`Analisa percakapan ${conversationId} gagal:`, message);
    return {
      conversation_id: conversationId,
      status: "failed",
      insight: stored ?? null,
      error: message,
    };
  }
}

/**
 * Kandidat percakapan yang layak dianalisa: belum punya insight, ATAU ada pesan
 * baru setelah analisa terakhir.
 *
 * `last_message_at > analyzed_at` hanya PENYARING MURAH di SQL — sidik jari
 * sesungguhnya dihitung per percakapan di `analyzeConversation`, jadi kandidat
 * yang ternyata tidak berubah tetap berhenti di cache tanpa memanggil OpenAI.
 */
async function findPendingConversationIds(
  db: Db,
  options: { limit: number; from?: string; to?: string }
): Promise<string[]> {
  const values: unknown[] = [];
  const filters: string[] = [];

  if (options.from) {
    values.push(options.from);
    filters.push(`v.last_message_at >= $${values.length}`);
  }
  if (options.to) {
    values.push(options.to);
    filters.push(`v.last_message_at < $${values.length}`);
  }
  values.push(options.limit);

  const { rows } = await db.query(
    `SELECT v.id
       FROM crm.wa_conversations v
       LEFT JOIN crm.wa_conversation_insights i ON i.conversation_id = v.id
      WHERE v.last_message_at IS NOT NULL
        AND (i.conversation_id IS NULL OR v.last_message_at > i.analyzed_at)
        ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
      ORDER BY v.last_message_at DESC
      LIMIT $${values.length}`,
    values
  );
  return rows.map((row) => String(row.id));
}

/**
 * Analisa sekumpulan percakapan yang belum/kedaluwarsa insight-nya.
 *
 * Dijalankan BERURUTAN, bukan paralel: rate limit OpenAI lebih mudah kena kalau
 * 25 permintaan ditembakkan sekaligus, dan modul ini dipanggil dari klik tombol
 * — bukan jalur yang menuntut latensi minimum.
 */
export async function analyzePending(
  db: Db = getPool(),
  options: { limit?: number; from?: string; to?: string } = {}
): Promise<{ summary: AnalyzeBatchSummary; results: AnalyzeResult[] }> {
  const limit = clampPendingLimit(options.limit);
  const ids = await findPendingConversationIds(db, { limit, from: options.from, to: options.to });

  const results: AnalyzeResult[] = [];
  for (const id of ids) {
    results.push(await analyzeConversation(db, id));
  }
  return { summary: summarizeBatch(results), results };
}

// --- Laporan agregat ---------------------------------------------------------

/**
 * Laporan agregat untuk satu periode.
 *
 * PII: query sengaja TIDAK mengambil `summary`, `phone`, maupun nama customer —
 * hanya kolom yang bisa diagregasi. Periode dinilai dari
 * `wa_conversations.last_message_at` (kapan percakapan terakhir hidup), bukan
 * `analyzed_at`, supaya angkanya sejajar dengan laporan CS.
 */
export async function getConversationInsightReport(
  db: Db = getPool(),
  period: { fromIso: string; toIso: string; fromDate: string; toDate: string },
  options: { keywordLimit?: number; topicLimit?: number } = {}
): Promise<ConversationInsightReport> {
  const params = [period.fromIso, period.toIso];

  const [insightResult, totalResult] = await Promise.all([
    db.query(
      `SELECT i.topic, i.sentiment, i.is_complaint, i.keywords
         FROM crm.wa_conversation_insights i
         JOIN crm.wa_conversations v ON v.id = i.conversation_id
        WHERE v.last_message_at >= $1 AND v.last_message_at < $2`,
      params
    ),
    db.query(
      `SELECT COUNT(*)::int AS total
         FROM crm.wa_conversations
        WHERE last_message_at >= $1 AND last_message_at < $2`,
      params
    ),
  ]);

  const insights: AggregatableInsight[] = insightResult.rows.map((row) => ({
    topic: typeof row.topic === "string" ? row.topic : "",
    sentiment:
      row.sentiment === "positif" || row.sentiment === "negatif" ? row.sentiment : "netral",
    is_complaint: row.is_complaint === true,
    keywords: normalizeKeywordList(row.keywords),
  }));

  return buildInsightReport(insights, {
    period: { from: period.fromDate, to: period.toDate },
    totalConversations: Number(totalResult.rows[0]?.total ?? 0),
    keywordLimit: options.keywordLimit,
    topicLimit: options.topicLimit,
  });
}
