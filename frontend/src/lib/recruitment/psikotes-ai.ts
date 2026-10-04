import {
  DEEPSEEK_DEFAULTS,
  OPENAI_DEFAULTS,
  SETTING_KEYS,
  getSettings,
} from "@/lib/settings/app-settings";
import { DeepseekNotConfiguredError } from "./deepseek";

/**
 * Insight AI utk tes gambar psikotes (Baum/DAP/Wartegg).
 *
 * API DeepSeek text-only (input gambar ditolak — diverifikasi 2026-07-15),
 * jadi alurnya dua tahap: OBSERVASI gambar (ditulis HRD, atau otomatis via
 * OpenAI vision bila dikosongkan) → DeepSeek menyusun insight interpretatif
 * per kerangka instrumen. Hasil bersifat INDIKATIF sebagai bahan
 * pertimbangan HRD — bukan diagnosis dan bukan keputusan final.
 */

export class OpenAiNotConfiguredError extends Error {
  constructor() {
    super(
      "OpenAI API key belum dikonfigurasi (dipakai untuk membaca gambar otomatis). " +
        "Atur di Dashboard → Settings → Integrasi, atau tulis observasi gambar secara manual."
    );
    this.name = "OpenAiNotConfiguredError";
  }
}

export interface DrawingAiInsight {
  ringkasan: string;
  indikasi: { aspek: string; insight: string }[];
  perhatikan_saat_interview: string[];
  keterbatasan: string;
}

const FRAMEWORKS: Record<string, string> = {
  baum:
    "Tes Baum (menggambar pohon). Aspek yang lazim dibaca: batang (proporsi, " +
    "tekstur), mahkota/dahan, akar (ada/tidak), ukuran & posisi gambar di kertas, " +
    "tekanan & kualitas garis, kelengkapan dan detail tambahan.",
  dap:
    "Tes DAP / Draw a Person (menggambar manusia). Aspek yang lazim dibaca: " +
    "proporsi tubuh, detail wajah & anggota tubuh, ukuran & posisi di kertas, " +
    "tekanan garis, kelengkapan (pakaian/aksesori), ekspresi & postur.",
  wartegg:
    "Tes Wartegg (WZT, melengkapi 8 kotak stimulus). Aspek yang lazim dibaca: " +
    "respon terhadap tiap stimulus (titik, garis lengkung, garis lurus, dst.), " +
    "urutan pengerjaan bila diketahui, orisinalitas, kualitas & keterkaitan gambar " +
    "dengan karakter stimulus tiap kotak.",
};

const SYSTEM_PROMPT = `Kamu adalah asisten psikolog HR yang membantu menafsirkan hasil tes proyektif secara INDIKATIF.
Balas HANYA dengan JSON valid (tanpa markdown code fence) berbentuk:
{
  "ringkasan": string,
  "indikasi": [{"aspek": string, "insight": string}],
  "perhatikan_saat_interview": [string],
  "keterbatasan": string
}
Ketentuan:
- Dasarkan HANYA pada observasi yang diberikan HR — jangan mengarang detail gambar yang tidak disebutkan.
- "ringkasan": 2-4 kalimat bahasa Indonesia, nada netral-profesional.
- "indikasi": 3-6 butir; tiap butir mengaitkan satu pengamatan dengan kemungkinan maknanya (pakai kata "cenderung/mengindikasikan", hindari klaim pasti).
- "perhatikan_saat_interview": 2-4 hal konkret yang sebaiknya digali HRD saat interview untuk memvalidasi indikasi.
- "keterbatasan": 1-2 kalimat yang menegaskan ini interpretasi indikatif dari observasi terbatas, bukan diagnosis psikologis, dan keputusan tetap di tangan HRD/psikolog.
- Jika observasi terlalu minim untuk ditafsirkan, katakan itu di "ringkasan" dan minta observasi tambahan di "perhatikan_saat_interview".`;

const VISION_SYSTEM_PROMPT = `Kamu adalah asisten psikolog HR yang mendeskripsikan gambar hasil tes proyektif secara OBJEKTIF.
Tugasmu HANYA mendeskripsikan apa yang terlihat — JANGAN menafsirkan makna psikologisnya.
Balas dalam bahasa Indonesia, 4-8 kalimat prosa padat (tanpa markdown, tanpa daftar).
Deskripsikan sesuai aspek yang lazim dibaca pada instrumen yang disebutkan (ukuran & posisi di kertas, kelengkapan bagian, kualitas/tekanan garis, detail yang menonjol atau yang hilang).
Jika gambar buram, kosong, atau bukan hasil tes yang dimaksud, katakan itu apa adanya.`;

async function getOpenAiConfig() {
  const s = await getSettings([
    SETTING_KEYS.OPENAI_API_KEY,
    SETTING_KEYS.OPENAI_MODEL,
    SETTING_KEYS.OPENAI_BASE_URL,
  ]);
  const apiKey = s[SETTING_KEYS.OPENAI_API_KEY];
  if (!apiKey) throw new OpenAiNotConfiguredError();
  return {
    apiKey,
    model: s[SETTING_KEYS.OPENAI_MODEL] || OPENAI_DEFAULTS.model,
    baseUrl: s[SETTING_KEYS.OPENAI_BASE_URL] || OPENAI_DEFAULTS.baseUrl,
  };
}

/** Deskripsi objektif gambar tes via OpenAI vision — jadi bahan observasi
 *  utk analyzeDrawingObservation ketika HRD tidak menulis observasi manual. */
export async function describeDrawingImage(input: {
  instrumentCode: string;
  instrumentName: string;
  imageBase64: string;
  imageMime: string;
}): Promise<{ observation: string; model: string }> {
  const { apiKey, model, baseUrl } = await getOpenAiConfig();

  const framework = FRAMEWORKS[input.instrumentCode] ?? `Tes ${input.instrumentName}.`;
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(90_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: VISION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `INSTRUMEN: ${input.instrumentName} — ${framework}\nDeskripsikan gambar hasil tes kandidat berikut secara objektif.`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${input.imageMime};base64,${input.imageBase64}`,
                detail: "high",
              },
            },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 700,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI API error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = await res.json();
  const observation: string | undefined = json?.choices?.[0]?.message?.content?.trim();
  if (!observation) throw new Error("OpenAI tidak mengembalikan deskripsi gambar");

  return { observation, model };
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

export async function analyzeDrawingObservation(input: {
  instrumentCode: string;
  instrumentName: string;
  observation: string;
  positionTitle: string | null;
}): Promise<{ result: DrawingAiInsight; model: string }> {
  const { apiKey, model, baseUrl } = await getDeepseekConfig();

  const framework = FRAMEWORKS[input.instrumentCode] ?? `Tes ${input.instrumentName}.`;
  const userPrompt = [
    `INSTRUMEN: ${input.instrumentName} — ${framework}`,
    input.positionTitle ? `POSISI YANG DILAMAR: ${input.positionTitle}` : "",
    `\nOBSERVASI HR TERHADAP GAMBAR KANDIDAT:\n${input.observation.slice(0, 4000)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(90_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`DeepSeek API error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = await res.json();
  const content: string | undefined = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek tidak mengembalikan konten");

  let parsed: DrawingAiInsight;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Respons DeepSeek bukan JSON valid");
  }

  return {
    result: {
      ringkasan: String(parsed.ringkasan ?? ""),
      indikasi: Array.isArray(parsed.indikasi)
        ? parsed.indikasi
            .filter((i) => i && typeof i === "object")
            .map((i) => ({ aspek: String(i.aspek ?? ""), insight: String(i.insight ?? "") }))
        : [],
      perhatikan_saat_interview: Array.isArray(parsed.perhatikan_saat_interview)
        ? parsed.perhatikan_saat_interview.map(String)
        : [],
      keterbatasan: String(parsed.keterbatasan ?? ""),
    },
    model,
  };
}
