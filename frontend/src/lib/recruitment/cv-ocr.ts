import { getSettings, SETTING_KEYS, OPENAI_DEFAULTS } from "@/lib/settings/app-settings";

/**
 * OCR CV kandidat via OpenAI (fitur "Isi otomatis dari CV" di Tambah Kandidat
 * Manual). Berbeda dengan cv-extract.ts (tesseract lokal untuk file yang sudah
 * tersimpan), modul ini mengirim file langsung ke OpenAI:
 * - PDF       → content part `file` (OpenAI membaca text layer maupun hasil scan)
 * - JPG/PNG   → content part `image_url` (vision)
 * - DOC/DOCX  → teks diekstrak dulu via mammoth, dikirim sebagai teks biasa
 *
 * Kredensial: setting `openai_api_key` (Settings → Integrasi) SELALU menang;
 * env OPENAI_API_KEY hanya fallback — konsisten dengan /api/ai/assistant.
 */

export interface CvOcrFields {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  domicile: string | null;
  last_experience: string | null;
  last_education: string | null;
  notes: string | null;
}

export class OpenAiNotConfiguredError extends Error {
  constructor() {
    super("API key OpenAI belum diatur. Isi di Settings → Integrasi terlebih dahulu.");
    this.name = "OpenAiNotConfiguredError";
  }
}

const OCR_MODEL = "gpt-4o-mini";
const OCR_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `Kamu adalah asisten HR yang membaca CV/resume kandidat (bahasa Indonesia atau Inggris).
Ekstrak data berikut dari CV dan balas HANYA dengan JSON valid (tanpa markdown):
{"full_name": string|null, "email": string|null, "phone": string|null, "domicile": string|null, "last_experience": string|null, "last_education": string|null, "notes": string|null}

Ketentuan:
- "full_name": nama lengkap kandidat (bukan nama perusahaan/referensi).
- "email": alamat email kandidat.
- "phone": nomor HP/WhatsApp kandidat, tulis apa adanya (boleh berawalan 0 atau +62), hanya angka dan tanda + tanpa spasi/strip.
- "domicile": kota/kabupaten domisili kandidat saat ini (cukup nama kota, bukan alamat lengkap).
- "last_experience": pengalaman kerja TERAKHIR/terbaru kandidat, format ringkas "Nama Perusahaan - Posisi (durasi)", contoh: "PT Maju Jaya - Kasir (2 tahun)". Bila fresh graduate tanpa pengalaman, isi null.
- "last_education": pendidikan/lulusan TERAKHIR (jenjang tertinggi yang sudah lulus atau sedang ditempuh), format ringkas "Jenjang - Jurusan - Nama Sekolah/Universitas", contoh: "S1 - Manajemen - Universitas Indonesia" atau "SMA - IPA - SMAN 1 Bandung".
- "notes": ringkasan profil kandidat 2-4 kalimat dalam bahasa Indonesia untuk catatan HR: keahlian utama, sorotan pengalaman/prestasi, sertifikasi bila ada. Tulis faktual berdasarkan isi CV, tanpa opini kelayakan.
- Isi null bila informasi benar-benar tidak ditemukan. Jangan mengarang.`;

async function resolveOpenAi(): Promise<{ apiKey: string; baseUrl: string }> {
  const s = await getSettings([SETTING_KEYS.OPENAI_API_KEY, SETTING_KEYS.OPENAI_BASE_URL]);
  const apiKey = s[SETTING_KEYS.OPENAI_API_KEY] || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new OpenAiNotConfiguredError();
  return {
    apiKey,
    baseUrl: (s[SETTING_KEYS.OPENAI_BASE_URL] || OPENAI_DEFAULTS.baseUrl).replace(/\/$/, ""),
  };
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

async function buildUserContent(
  buffer: Buffer,
  filename: string,
  ext: string
): Promise<string | ContentPart[]> {
  if (ext === "pdf") {
    return [
      { type: "text", text: "Ekstrak data kandidat dari CV terlampir." },
      {
        type: "file",
        file: {
          filename,
          file_data: `data:application/pdf;base64,${buffer.toString("base64")}`,
        },
      },
    ];
  }
  if (["jpg", "jpeg", "png"].includes(ext)) {
    const mime = ext === "png" ? "image/png" : "image/jpeg";
    return [
      { type: "text", text: "Ekstrak data kandidat dari foto/scan CV terlampir." },
      {
        type: "image_url",
        image_url: { url: `data:${mime};base64,${buffer.toString("base64")}` },
      },
    ];
  }
  if (ext === "doc" || ext === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    if (!text) throw new Error("Tidak ada teks yang bisa dibaca dari dokumen CV");
    return `Ekstrak data kandidat dari teks CV berikut:\n\n${text.slice(0, 20_000)}`;
  }
  throw new Error(`Format file tidak didukung untuk OCR: .${ext}`);
}

function normalizeField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const NETWORK_RETRY_ATTEMPTS = 3;
const NETWORK_RETRY_DELAY_MS = 1000;

/**
 * DNS/connect ke api.openai.com dari server ini kadang gagal sesaat
 * (ConnectTimeoutError 10dtk / EAI_AGAIN) lalu langsung pulih di percobaan
 * berikutnya — gejala resolver DNS yang belum "hangat", bukan API key salah
 * atau limit rate. Hanya retry kegagalan JARINGAN (fetch melempar TypeError),
 * BUKAN respons HTTP error (4xx/5xx tetap gagal langsung — itu error asli API).
 */
async function fetchWithNetworkRetry(
  url: string,
  init: RequestInit
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= NETWORK_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt < NETWORK_RETRY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, NETWORK_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

export async function ocrCandidateCv(
  buffer: Buffer,
  filename: string
): Promise<CvOcrFields> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const [{ apiKey, baseUrl }, content] = await Promise.all([
    resolveOpenAi(),
    buildUserContent(buffer, filename, ext),
  ]);

  const res = await fetchWithNetworkRetry(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OCR_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI API error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = await res.json();
  const raw: string | undefined = json?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("OpenAI tidak mengembalikan jawaban");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Jawaban OpenAI bukan JSON valid");
  }

  return {
    full_name: normalizeField(parsed.full_name),
    email: normalizeField(parsed.email),
    phone: normalizeField(parsed.phone),
    domicile: normalizeField(parsed.domicile),
    last_experience: normalizeField(parsed.last_experience),
    last_education: normalizeField(parsed.last_education),
    notes: normalizeField(parsed.notes),
  };
}
