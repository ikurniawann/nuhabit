import { SETTING_KEYS, getSettings } from "@/lib/settings/app-settings";
import {
  TTS_DEFAULT_PROVIDER,
  TTS_MAX_INPUT_CHARS,
  getTtsProvider,
  resolveTtsModel,
  resolveTtsVoice,
  type TtsProviderId,
} from "./catalog";

/**
 * Sintesis suara multi-provider (EPIC-016).
 *
 * Dipakai Interview AI dan tombol preview di Settings → Suara AI. Semua jalur
 * mengembalikan mp3 supaya pemanggilnya tidak perlu tahu provider mana yang
 * bekerja.
 *
 * Catatan desain: versi lama menelan semua kegagalan dalam `catch {}` kosong,
 * sehingga tidak ada yang tahu apakah suara berasal dari model utama, fallback,
 * atau malah Web Speech API di browser. Di sini setiap kegagalan dicatat dan
 * hasilnya membawa metadata provider/voice/model yang benar-benar dipakai.
 */

export interface TtsResult {
  buffer: Buffer;
  provider: TtsProviderId;
  voice: string;
  model: string;
}

export interface TtsConfig {
  provider: TtsProviderId;
  voice: string;
  model: string;
  openai: { apiKey: string | null; baseUrl: string };
  azure: { key: string | null; region: string | null };
  elevenlabs: { apiKey: string | null };
}

/** Instruksi aksen — hanya didukung model gpt-4o-mini-tts. */
const OPENAI_INSTRUCTIONS =
  "Bicaralah sepenuhnya dalam bahasa Indonesia dengan pelafalan penutur asli Indonesia " +
  "yang natural (bukan aksen asing). Nada ramah, profesional, dan jelas — seperti seorang " +
  "HR interviewer yang menenangkan kandidat. Tempo sedang, artikulasi rapi.";

const OPENAI_INSTRUCTION_MODELS = ["gpt-4o-mini-tts"];
const REQUEST_TIMEOUT_MS = 60_000;

export class TtsNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsNotConfiguredError";
  }
}

export async function getTtsConfig(): Promise<TtsConfig> {
  const s = await getSettings([
    SETTING_KEYS.TTS_PROVIDER,
    SETTING_KEYS.TTS_VOICE,
    SETTING_KEYS.TTS_MODEL,
    SETTING_KEYS.OPENAI_API_KEY,
    SETTING_KEYS.OPENAI_BASE_URL,
    SETTING_KEYS.AZURE_SPEECH_KEY,
    SETTING_KEYS.AZURE_SPEECH_REGION,
    SETTING_KEYS.ELEVENLABS_API_KEY,
  ]);

  const provider = getTtsProvider(s[SETTING_KEYS.TTS_PROVIDER] ?? TTS_DEFAULT_PROVIDER).id;

  return {
    provider,
    voice: resolveTtsVoice(provider, s[SETTING_KEYS.TTS_VOICE]),
    model: resolveTtsModel(provider, s[SETTING_KEYS.TTS_MODEL]),
    openai: {
      apiKey: s[SETTING_KEYS.OPENAI_API_KEY],
      baseUrl: s[SETTING_KEYS.OPENAI_BASE_URL] || "https://api.openai.com/v1",
    },
    azure: {
      key: s[SETTING_KEYS.AZURE_SPEECH_KEY],
      region: s[SETTING_KEYS.AZURE_SPEECH_REGION],
    },
    elevenlabs: { apiKey: s[SETTING_KEYS.ELEVENLABS_API_KEY] },
  };
}

/** Escape untuk SSML Azure — teks pertanyaan tidak boleh bisa menyuntik tag. */
export function escapeSsml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function readError(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "(body tidak terbaca)";
  }
}

async function synthesizeOpenAi(
  text: string,
  cfg: TtsConfig,
  model: string
): Promise<Buffer> {
  if (!cfg.openai.apiKey) {
    throw new TtsNotConfiguredError(
      "API key OpenAI belum diisi. Atur di Settings → Integrasi."
    );
  }
  const res = await fetch(`${cfg.openai.baseUrl}/audio/speech`, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.openai.apiKey}`,
    },
    body: JSON.stringify({
      model,
      voice: cfg.voice,
      input: text,
      response_format: "mp3",
      ...(OPENAI_INSTRUCTION_MODELS.includes(model)
        ? { instructions: OPENAI_INSTRUCTIONS }
        : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI TTS ${res.status}: ${await readError(res)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function synthesizeAzure(text: string, cfg: TtsConfig): Promise<Buffer> {
  const { key, region } = cfg.azure;
  if (!key || !region) {
    throw new TtsNotConfiguredError(
      "Azure Speech key atau region belum diisi. Atur di Settings → Suara AI."
    );
  }
  // Locale diturunkan dari nama voice (id-ID-GadisNeural → id-ID); voice non-standar
  // tetap jalan karena Azure memakai atribut `name` sebagai penentu.
  const locale = cfg.voice.split("-").slice(0, 2).join("-") || "id-ID";
  const ssml =
    `<speak version="1.0" xml:lang="${locale}">` +
    `<voice name="${escapeSsml(cfg.voice)}">${escapeSsml(text)}</voice>` +
    `</speak>`;

  const res = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "arkiv-os",
      },
      body: ssml,
    }
  );
  if (!res.ok) {
    throw new Error(`Azure TTS ${res.status}: ${await readError(res)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function synthesizeElevenLabs(
  text: string,
  cfg: TtsConfig,
  model: string
): Promise<Buffer> {
  if (!cfg.elevenlabs.apiKey) {
    throw new TtsNotConfiguredError(
      "ElevenLabs API key belum diisi. Atur di Settings → Suara AI."
    );
  }
  if (!cfg.voice) {
    throw new TtsNotConfiguredError(
      "Voice ID ElevenLabs belum diisi. Salin dari dashboard ElevenLabs."
    );
  }
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cfg.voice)}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "xi-api-key": cfg.elevenlabs.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: model }),
    }
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs TTS ${res.status}: ${await readError(res)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Sintesis dengan konfigurasi tersimpan (atau `override` untuk preview).
 * Melempar bila gagal — pemanggil yang menentukan apakah itu fatal.
 */
export async function synthesizeSpeech(
  text: string,
  override?: Partial<Pick<TtsConfig, "provider" | "voice" | "model">>
): Promise<TtsResult> {
  const base = await getTtsConfig();
  const provider = override?.provider ?? base.provider;
  // Voice/model tersimpan hanya relevan bila provider-nya tidak berpindah:
  // "coral" milik OpenAI tidak berarti apa-apa untuk Azure.
  const sameProvider = provider === base.provider;
  const cfg: TtsConfig = {
    ...base,
    provider,
    voice: resolveTtsVoice(provider, override?.voice ?? (sameProvider ? base.voice : undefined)),
    model: resolveTtsModel(provider, override?.model ?? (sameProvider ? base.model : undefined)),
  };

  const input = text.slice(0, TTS_MAX_INPUT_CHARS);
  let buffer: Buffer;

  switch (cfg.provider) {
    case "azure":
      buffer = await synthesizeAzure(input, cfg);
      break;
    case "elevenlabs":
      buffer = await synthesizeElevenLabs(input, cfg, cfg.model);
      break;
    case "openai":
    default:
      buffer = await synthesizeOpenAi(input, cfg, cfg.model);
      break;
  }

  return { buffer, provider: cfg.provider, voice: cfg.voice, model: cfg.model };
}

/**
 * Varian toleran untuk alur produksi (Interview AI): kegagalan tidak
 * menggagalkan wawancara, tetapi SELALU dicatat — jangan dikembalikan ke
 * `catch {}` senyap seperti implementasi lama.
 */
export async function synthesizeSpeechOrNull(text: string): Promise<TtsResult | null> {
  try {
    return await synthesizeSpeech(text);
  } catch (error) {
    console.error(
      "[tts] sintesis gagal, klien akan jatuh ke Web Speech API browser:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
