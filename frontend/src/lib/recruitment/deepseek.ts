import {
  DEEPSEEK_DEFAULTS,
  SETTING_KEYS,
  getSettings,
} from "@/lib/settings/app-settings";

/**
 * Client tipis untuk DeepSeek chat completions (OpenAI-compatible).
 * API key/model/base URL diambil dari configuration.app_settings
 * (diatur lewat Dashboard → Settings → Integrasi).
 */

export interface CvAnalysisOutput {
  nama: string | null;
  email: string | null;
  no_hp: string | null;
  sumber: string | null;
  pendidikan: string | null;
  pengalaman: string | null;
  ringkasan: string;
  skor_kecocokan: number;
  alasan_kecocokan: string;
}

export class DeepseekNotConfiguredError extends Error {
  constructor() {
    super(
      "DeepSeek API key belum dikonfigurasi. Atur di Dashboard → Settings → Integrasi."
    );
    this.name = "DeepseekNotConfiguredError";
  }
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

const SYSTEM_PROMPT = `Kamu adalah asisten HR yang menganalisis CV kandidat.
Balas HANYA dengan JSON valid (tanpa markdown code fence) berbentuk:
{
  "nama": string|null,
  "email": string|null,
  "no_hp": string|null,
  "sumber": string|null,
  "pendidikan": string|null,
  "pengalaman": string|null,
  "ringkasan": string,
  "skor_kecocokan": number,
  "alasan_kecocokan": string
}
Ketentuan:
- "nama","email","no_hp": ambil dari CV; null jika tidak ditemukan.
- "sumber": dari mana kandidat tahu lowongan JIKA disebut di CV (mis. JobStreet, referral); null jika tidak disebut.
- "pendidikan": ringkasan pendidikan terakhir (jenjang, institusi, jurusan, tahun bila ada).
- "pengalaman": ringkasan pengalaman kerja relevan (posisi, perusahaan, durasi).
- "ringkasan": 2-4 kalimat profil kandidat dalam bahasa Indonesia.
- "skor_kecocokan": 0-100, kecocokan CV terhadap deskripsi pekerjaan yang diberikan. Jika deskripsi pekerjaan tidak tersedia, nilai berdasarkan kualitas & kelengkapan CV dan sebutkan itu di alasan.
- "alasan_kecocokan": 1-3 kalimat alasan skor.`;

export async function analyzeCvWithDeepseek(
  cvText: string,
  jobContext: string | null
): Promise<{ result: CvAnalysisOutput; model: string }> {
  const { apiKey, model, baseUrl } = await getDeepseekConfig();

  // batasi input supaya hemat token & aman dari CV super panjang
  const MAX_CV_CHARS = 12_000;
  const trimmedCv = cvText.length > MAX_CV_CHARS ? `${cvText.slice(0, MAX_CV_CHARS)}\n…(terpotong)` : cvText;

  const userPrompt = [
    jobContext
      ? `DESKRIPSI PEKERJAAN YANG DILAMAR:\n${jobContext}`
      : "DESKRIPSI PEKERJAAN YANG DILAMAR: (tidak tersedia)",
    `\nISI CV KANDIDAT:\n${trimmedCv}`,
  ].join("\n");

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
      temperature: 0.2,
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

  let parsed: CvAnalysisOutput;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Respons DeepSeek bukan JSON valid");
  }

  // normalisasi skor
  const skor = Number(parsed.skor_kecocokan);
  parsed.skor_kecocokan = Number.isFinite(skor) ? Math.max(0, Math.min(100, Math.round(skor))) : 0;

  return { result: parsed, model };
}
