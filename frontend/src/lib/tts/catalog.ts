/**
 * Katalog provider & suara text-to-speech (EPIC-016).
 *
 * Murni data + validasi, tanpa I/O — supaya bisa diuji dan dipakai bersama oleh
 * API settings, halaman preview, dan pemanggil sesungguhnya (Interview AI).
 *
 * Konteks penting: suara OpenAI seluruhnya penutur asli Inggris yang "diminta"
 * berbahasa Indonesia lewat field `instructions`, sehingga aksennya tidak pernah
 * benar-benar lokal. Azure & ElevenLabs disediakan karena punya suara yang
 * dilatih dari penutur Indonesia. Ini alasan utama menu ini ada.
 */

export type TtsProviderId = "openai" | "azure" | "elevenlabs";

export interface TtsVoice {
  id: string;
  label: string;
  /** true = dilatih dari penutur asli Indonesia (bukan aksen asing). */
  nativeIndonesian: boolean;
  note?: string;
}

export interface TtsProvider {
  id: TtsProviderId;
  label: string;
  description: string;
  /** Model default yang dipakai bila setting model kosong. */
  defaultModel: string;
  /** Pilihan model yang ditawarkan di UI. */
  models: string[];
  defaultVoice: string;
  voices: TtsVoice[];
  /** Suara di luar daftar boleh diketik manual (mis. voice hasil cloning). */
  allowCustomVoice: boolean;
  /** Field kredensial yang wajib terisi sebelum provider bisa dipakai. */
  requiredCredentials: string[];
}

export const TTS_PROVIDERS: Record<TtsProviderId, TtsProvider> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    description:
      "Sudah terpasang dan termurah, tetapi semua suaranya penutur asli Inggris — bahasa Indonesia terdengar beraksen.",
    defaultModel: "gpt-4o-mini-tts",
    models: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"],
    defaultVoice: "coral",
    voices: [
      { id: "alloy", label: "Alloy (netral)", nativeIndonesian: false },
      { id: "ash", label: "Ash (pria, tenang)", nativeIndonesian: false },
      { id: "ballad", label: "Ballad (pria, hangat)", nativeIndonesian: false },
      { id: "coral", label: "Coral (wanita, ramah)", nativeIndonesian: false },
      { id: "echo", label: "Echo (pria)", nativeIndonesian: false },
      { id: "fable", label: "Fable (ekspresif)", nativeIndonesian: false },
      { id: "nova", label: "Nova (wanita, cerah)", nativeIndonesian: false },
      { id: "onyx", label: "Onyx (pria, dalam)", nativeIndonesian: false },
      { id: "sage", label: "Sage (wanita, kalem)", nativeIndonesian: false },
      { id: "shimmer", label: "Shimmer (wanita, lembut)", nativeIndonesian: false },
    ],
    allowCustomVoice: false,
    requiredCredentials: ["API key OpenAI (Settings → Integrasi)"],
  },
  azure: {
    id: "azure",
    label: "Azure Speech",
    description:
      "Punya suara id-ID asli sehingga pelafalannya lokal. Paling murah di antara opsi native dan mendukung penyesuaian tempo.",
    defaultModel: "neural",
    models: ["neural"],
    defaultVoice: "id-ID-GadisNeural",
    voices: [
      {
        id: "id-ID-GadisNeural",
        label: "Gadis (wanita, id-ID)",
        nativeIndonesian: true,
        note: "Cocok untuk nada HR yang menenangkan.",
      },
      {
        id: "id-ID-ArdiNeural",
        label: "Ardi (pria, id-ID)",
        nativeIndonesian: true,
      },
    ],
    allowCustomVoice: true,
    requiredCredentials: ["Azure Speech key", "Region (mis. southeastasia)"],
  },
  elevenlabs: {
    id: "elevenlabs",
    label: "ElevenLabs",
    description:
      "Paling ekspresif dan bisa memakai suara hasil cloning, tetapi paling mahal. Modelnya multilingual, bukan khusus Indonesia.",
    defaultModel: "eleven_multilingual_v2",
    models: ["eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v2_5"],
    defaultVoice: "",
    voices: [],
    allowCustomVoice: true,
    requiredCredentials: ["ElevenLabs API key", "Voice ID"],
  },
};

export const TTS_PROVIDER_IDS = Object.keys(TTS_PROVIDERS) as TtsProviderId[];

/** Provider default bila setting belum pernah diisi — perilaku lama dipertahankan. */
export const TTS_DEFAULT_PROVIDER: TtsProviderId = "openai";

export function isTtsProviderId(value: unknown): value is TtsProviderId {
  return typeof value === "string" && value in TTS_PROVIDERS;
}

export function getTtsProvider(id: unknown): TtsProvider {
  return isTtsProviderId(id) ? TTS_PROVIDERS[id] : TTS_PROVIDERS[TTS_DEFAULT_PROVIDER];
}

/**
 * Voice yang dipakai: nilai tersimpan bila valid, selain itu default provider.
 * Provider yang mengizinkan voice kustom (Azure/ElevenLabs) menerima string apa
 * pun yang tidak kosong, karena daftar suaranya jauh lebih panjang dari katalog.
 */
export function resolveTtsVoice(providerId: unknown, voice: unknown): string {
  const provider = getTtsProvider(providerId);
  const candidate = typeof voice === "string" ? voice.trim() : "";
  if (!candidate) return provider.defaultVoice;
  if (provider.voices.some((v) => v.id === candidate)) return candidate;
  return provider.allowCustomVoice ? candidate : provider.defaultVoice;
}

/** Model yang dipakai: nilai tersimpan bila dikenal, selain itu default provider. */
export function resolveTtsModel(providerId: unknown, model: unknown): string {
  const provider = getTtsProvider(providerId);
  const candidate = typeof model === "string" ? model.trim() : "";
  return provider.models.includes(candidate) ? candidate : provider.defaultModel;
}

/** Kalimat contoh untuk tombol preview — sengaja memakai pertanyaan asli. */
export const TTS_PREVIEW_TEXT =
  "Perkenalkan diri Anda secara singkat, lalu ceritakan pengalaman kerja atau kegiatan yang paling relevan dengan posisi ini.";

/** Batas aman panjang teks yang disintesis sekali jalan. */
export const TTS_MAX_INPUT_CHARS = 600;
