import {
  DEEPSEEK_DEFAULTS,
  OPENAI_DEFAULTS,
  SETTING_KEYS,
  getSettings,
} from "@/lib/settings/app-settings";
import { DeepseekNotConfiguredError } from "./deepseek";
import { synthesizeSpeechOrNull } from "@/lib/tts/synthesize";

/**
 * Interview AI (EPIC-003): AI interviewer menanyakan hal basic ke kandidat
 * (pengalaman, keahlian, motivasi, ketersediaan, ekspektasi gaji) lalu
 * menyimpulkan relevansi kandidat terhadap posisi.
 *
 * Pembagian engine (mengikuti pola psikotes-ai):
 * - DeepSeek  → generate pertanyaan adaptif + kesimpulan akhir (text-only).
 * - OpenAI    → Whisper (transkrip rekaman jawaban).
 * - TTS       → suara pertanyaan; provider/voice-nya dipilih di
 *               Settings → Suara AI (`src/lib/tts/`), tidak lagi dikunci OpenAI.
 *
 * Hasil kesimpulan bersifat INDIKATIF sebagai bahan pertimbangan HRD —
 * bukan keputusan final.
 */

export class OpenAiAudioNotConfiguredError extends Error {
  constructor() {
    super(
      "OpenAI API key belum dikonfigurasi (dipakai untuk transkrip suara & text-to-speech). " +
        "Atur di Dashboard → Settings → Integrasi."
    );
    this.name = "OpenAiAudioNotConfiguredError";
  }
}

export const INTERVIEW_MAX_QUESTIONS_DEFAULT = 8;
export const INTERVIEW_MAX_QUESTIONS_LIMIT = 15;

/** Urutan topik wajib — dipakai prompt & fallback statis bila AI down. */
export const INTERVIEW_TOPICS = [
  { key: "pembuka", label: "Perkenalan & pengalaman" },
  { key: "keahlian", label: "Keahlian teknis" },
  { key: "motivasi", label: "Motivasi & pemahaman posisi" },
  { key: "ketersediaan", label: "Ketersediaan & lokasi kerja" },
  { key: "gaji", label: "Ekspektasi gaji" },
] as const;

export type InterviewTopicKey = (typeof INTERVIEW_TOPICS)[number]["key"];

/** Pertanyaan fallback per topik — dipakai bila DeepSeek gagal/limit. */
const FALLBACK_QUESTIONS: Record<InterviewTopicKey, string> = {
  pembuka:
    "Perkenalkan diri Anda secara singkat, lalu ceritakan pengalaman kerja atau kegiatan yang paling relevan dengan posisi ini.",
  keahlian:
    "Keahlian apa yang paling Anda kuasai dan bagaimana Anda biasa menggunakannya dalam pekerjaan sehari-hari?",
  motivasi: "Apa yang membuat Anda tertarik melamar posisi ini?",
  ketersediaan:
    "Kapan Anda bisa mulai bekerja, dan apakah ada kendala lokasi atau jam kerja yang perlu kami ketahui?",
  gaji: "Berapa ekspektasi gaji Anda untuk posisi ini?",
};

export interface InterviewTurnForAi {
  turn_no: number;
  topic: string | null;
  question: string;
  answer_transcript: string | null;
}

export interface NextQuestionResult {
  action: "ask" | "finish";
  question: string | null;
  topic: string | null;
  model: string | null;
}

export interface InterviewAiSummary {
  ringkasan: string;
  relevansi: { skor: number; kesimpulan: "relevan" | "cukup_relevan" | "kurang_relevan"; alasan: string };
  keahlian: string[];
  ekspektasi_gaji: { disebutkan: boolean; nilai: string | null; catatan: string };
  red_flags: string[];
  perhatikan_saat_interview_lanjutan: string[];
  keterbatasan: string;
}

async function getDeepseekConfig() {
  const s = await getSettings([
    SETTING_KEYS.DEEPSEEK_API_KEY,
    SETTING_KEYS.DEEPSEEK_MODEL,
    SETTING_KEYS.DEEPSEEK_BASE_URL,
  ]);
  const apiKey = s[SETTING_KEYS.DEEPSEEK_API_KEY];
  if (!apiKey) throw new DeepseekNotConfiguredError();
  return {
    apiKey,
    model: s[SETTING_KEYS.DEEPSEEK_MODEL] || DEEPSEEK_DEFAULTS.model,
    baseUrl: s[SETTING_KEYS.DEEPSEEK_BASE_URL] || DEEPSEEK_DEFAULTS.baseUrl,
  };
}

async function getOpenAiConfig() {
  const s = await getSettings([SETTING_KEYS.OPENAI_API_KEY, SETTING_KEYS.OPENAI_BASE_URL]);
  const apiKey = s[SETTING_KEYS.OPENAI_API_KEY];
  if (!apiKey) throw new OpenAiAudioNotConfiguredError();
  return { apiKey, baseUrl: s[SETTING_KEYS.OPENAI_BASE_URL] || OPENAI_DEFAULTS.baseUrl };
}

async function deepseekJson(systemPrompt: string, userPrompt: string): Promise<{ parsed: unknown; model: string }> {
  const { apiKey, model, baseUrl } = await getDeepseekConfig();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`DeepSeek API error ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = await res.json();
  const content: string | undefined = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek tidak mengembalikan jawaban");
  return { parsed: JSON.parse(content), model };
}

function transcriptContext(turns: InterviewTurnForAi[]): string {
  if (turns.length === 0) return "(belum ada tanya-jawab)";
  return turns
    .map(
      (t) =>
        `#${t.turn_no}${t.topic ? ` [${t.topic}]` : ""}\nAI: ${t.question}\nKandidat: ${
          t.answer_transcript?.trim() || "(tidak menjawab)"
        }`
    )
    .join("\n\n")
    .slice(0, 12_000);
}

const QUESTION_SYSTEM_PROMPT = `Kamu adalah AI interviewer HR yang ramah dan profesional, berbahasa Indonesia.
Tugasmu menanyakan hal-hal BASIC screening ke kandidat, satu pertanyaan per giliran, mencakup topik wajib berikut secara berurutan (boleh follow-up singkat bila jawaban menarik/kurang jelas):
1. pembuka — perkenalan & pengalaman relevan
2. keahlian — keahlian teknis utama & contoh penggunaannya
3. motivasi — alasan melamar & pemahaman posisi
4. ketersediaan — kapan bisa mulai, kendala lokasi/jam kerja
5. gaji — ekspektasi gaji

Balas HANYA dengan JSON valid (tanpa markdown) berbentuk:
{"action": "ask"|"finish", "topic": string|null, "question": string|null}

Ketentuan:
- "topic" salah satu dari: pembuka, keahlian, motivasi, ketersediaan, gaji.
- Pertanyaan singkat (1-2 kalimat), sopan, mudah dipahami, TANPA menyebut skor/penilaian.
- Maksimal satu follow-up per topik; setelah semua topik tertanya (terutama gaji sudah ditanya), balas {"action":"finish","topic":null,"question":null}.
- Jangan menanyakan SARA, status pernikahan, agama, atau hal di luar konteks pekerjaan.
- Jangan mengulang pertanyaan yang sudah ditanyakan.`;

/**
 * Tentukan pertanyaan berikutnya berdasar percakapan berjalan.
 * Bila DeepSeek gagal → fallback urutan topik statis supaya interview
 * tidak pernah macet di tengah jalan.
 */
export async function generateNextInterviewQuestion(input: {
  candidateName: string;
  positionTitle: string | null;
  turns: InterviewTurnForAi[];
  maxQuestions: number;
}): Promise<NextQuestionResult> {
  const askedCount = input.turns.length;
  if (askedCount >= input.maxQuestions) {
    return { action: "finish", question: null, topic: null, model: null };
  }

  // Pertanyaan pertama statis — instan, tidak menunggu LLM.
  if (askedCount === 0) {
    return {
      action: "ask",
      question: `Halo ${input.candidateName}! Terima kasih sudah meluangkan waktu untuk interview${
        input.positionTitle ? ` posisi ${input.positionTitle}` : ""
      }. ${FALLBACK_QUESTIONS.pembuka}`,
      topic: "pembuka",
      model: null,
    };
  }

  const askedTopics = new Set(input.turns.map((t) => t.topic).filter(Boolean));
  // Gaji wajib tertanya sebelum AI boleh menutup — sisakan 1 slot terakhir.
  const mustAskGaji = !askedTopics.has("gaji") && askedCount >= input.maxQuestions - 1;
  if (mustAskGaji) {
    return { action: "ask", question: FALLBACK_QUESTIONS.gaji, topic: "gaji", model: null };
  }

  try {
    const userPrompt = [
      `KANDIDAT: ${input.candidateName}`,
      input.positionTitle ? `POSISI YANG DILAMAR: ${input.positionTitle}` : "",
      `PERTANYAAN TERPAKAI: ${askedCount}/${input.maxQuestions} (sisakan slot utk topik yang belum tertanya)`,
      `TOPIK SUDAH DITANYA: ${[...askedTopics].join(", ") || "(belum ada)"}`,
      `\nPERCAKAPAN SEJAUH INI:\n${transcriptContext(input.turns)}`,
      `\nTentukan langkah berikutnya.`,
    ]
      .filter(Boolean)
      .join("\n");

    const { parsed, model } = await deepseekJson(QUESTION_SYSTEM_PROMPT, userPrompt);
    const out = parsed as { action?: string; topic?: string | null; question?: string | null };
    if (out.action === "finish") {
      // Jangan izinkan AI menutup sebelum topik gaji tertanya.
      if (!askedTopics.has("gaji")) {
        return { action: "ask", question: FALLBACK_QUESTIONS.gaji, topic: "gaji", model };
      }
      return { action: "finish", question: null, topic: null, model };
    }
    if (out.action === "ask" && out.question?.trim()) {
      const topic = INTERVIEW_TOPICS.some((t) => t.key === out.topic) ? out.topic! : null;
      return { action: "ask", question: out.question.trim().slice(0, 600), topic, model };
    }
    throw new Error("Format jawaban AI tidak dikenal");
  } catch {
    // Fallback statis: topik pertama yang belum tertanya.
    const nextTopic = INTERVIEW_TOPICS.find((t) => !askedTopics.has(t.key));
    if (!nextTopic) return { action: "finish", question: null, topic: null, model: null };
    return {
      action: "ask",
      question: FALLBACK_QUESTIONS[nextTopic.key],
      topic: nextTopic.key,
      model: null,
    };
  }
}

const SUMMARY_SYSTEM_PROMPT = `Kamu adalah asisten HR yang menyimpulkan hasil interview screening basic secara INDIKATIF.
Balas HANYA dengan JSON valid (tanpa markdown) berbentuk:
{
  "ringkasan": string,
  "relevansi": {"skor": number, "kesimpulan": "relevan"|"cukup_relevan"|"kurang_relevan", "alasan": string},
  "keahlian": [string],
  "ekspektasi_gaji": {"disebutkan": boolean, "nilai": string|null, "catatan": string},
  "red_flags": [string],
  "perhatikan_saat_interview_lanjutan": [string],
  "keterbatasan": string
}
Ketentuan:
- Dasarkan HANYA pada transkrip — jangan mengarang informasi yang tidak disebutkan kandidat.
- "ringkasan": 2-4 kalimat bahasa Indonesia, nada netral-profesional.
- "relevansi.skor": 0-100 kecocokan jawaban kandidat dengan posisi (pakai kata "cenderung/mengindikasikan" di alasan, hindari klaim pasti).
- "keahlian": daftar keahlian yang DISEBUT kandidat (maks 8).
- "ekspektasi_gaji.nilai": angka/rentang persis seperti disebut kandidat, null bila tidak disebut.
- "red_flags": hal yang perlu diwaspadai (jawaban kosong/berputar, ketidaksesuaian, dsb) — boleh kosong.
- "perhatikan_saat_interview_lanjutan": 2-5 hal konkret utk digali interviewer manusia.
- "keterbatasan": 1-2 kalimat menegaskan ini kesimpulan indikatif dari interview basic oleh AI, bukan keputusan final — keputusan tetap di tangan HRD.`;

/** Kesimpulan akhir interview — dipanggil sekali saat sesi selesai. */
export async function summarizeInterview(input: {
  candidateName: string;
  positionTitle: string | null;
  turns: InterviewTurnForAi[];
}): Promise<{ result: InterviewAiSummary; model: string }> {
  const userPrompt = [
    `KANDIDAT: ${input.candidateName}`,
    input.positionTitle ? `POSISI YANG DILAMAR: ${input.positionTitle}` : "POSISI: (tidak diisi)",
    `\nTRANSKRIP INTERVIEW:\n${transcriptContext(input.turns)}`,
  ].join("\n");

  const { parsed, model } = await deepseekJson(SUMMARY_SYSTEM_PROMPT, userPrompt);
  const raw = parsed as Partial<InterviewAiSummary> & {
    relevansi?: Partial<InterviewAiSummary["relevansi"]>;
    ekspektasi_gaji?: Partial<InterviewAiSummary["ekspektasi_gaji"]>;
  };
  const kesimpulan =
    raw.relevansi?.kesimpulan === "relevan" ||
    raw.relevansi?.kesimpulan === "cukup_relevan" ||
    raw.relevansi?.kesimpulan === "kurang_relevan"
      ? raw.relevansi.kesimpulan
      : "cukup_relevan";
  const result: InterviewAiSummary = {
    ringkasan: String(raw.ringkasan ?? "").slice(0, 2000),
    relevansi: {
      skor: Math.min(100, Math.max(0, Math.round(Number(raw.relevansi?.skor ?? 0)))),
      kesimpulan,
      alasan: String(raw.relevansi?.alasan ?? "").slice(0, 2000),
    },
    keahlian: (Array.isArray(raw.keahlian) ? raw.keahlian : []).slice(0, 8).map((s) => String(s).slice(0, 120)),
    ekspektasi_gaji: {
      disebutkan: Boolean(raw.ekspektasi_gaji?.disebutkan),
      nilai: raw.ekspektasi_gaji?.nilai ? String(raw.ekspektasi_gaji.nilai).slice(0, 120) : null,
      catatan: String(raw.ekspektasi_gaji?.catatan ?? "").slice(0, 500),
    },
    red_flags: (Array.isArray(raw.red_flags) ? raw.red_flags : []).slice(0, 6).map((s) => String(s).slice(0, 300)),
    perhatikan_saat_interview_lanjutan: (Array.isArray(raw.perhatikan_saat_interview_lanjutan)
      ? raw.perhatikan_saat_interview_lanjutan
      : []
    )
      .slice(0, 5)
      .map((s) => String(s).slice(0, 300)),
    keterbatasan: String(raw.keterbatasan ?? "Kesimpulan indikatif dari interview basic oleh AI — keputusan tetap di tangan HRD.").slice(0, 500),
  };
  return { result, model };
}

const WHISPER_MODEL = "whisper-1";

/** Transkrip rekaman jawaban kandidat via OpenAI Whisper (bahasa Indonesia). */
export async function transcribeInterviewAudio(
  buffer: Buffer,
  mime: string
): Promise<{ transcript: string; model: string }> {
  const { apiKey, baseUrl } = await getOpenAiConfig();

  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : mime.includes("mpeg") ? "mp3" : "webm";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), `answer.${ext}`);
  form.append("model", WHISPER_MODEL);
  form.append("language", "id");
  form.append("response_format", "json");

  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Whisper API error ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = await res.json();
  const transcript = String(json?.text ?? "").trim();
  return { transcript, model: WHISPER_MODEL };
}

/**
 * Suara pertanyaan → buffer mp3. Provider & voice dipilih di
 * Settings → Suara AI (EPIC-016); lihat `src/lib/tts/`.
 * Return null bila gagal — client fallback ke Web Speech API / teks saja.
 */
export async function synthesizeInterviewSpeech(text: string): Promise<Buffer | null> {
  const result = await synthesizeSpeechOrNull(text);
  return result?.buffer ?? null;
}
