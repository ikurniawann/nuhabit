/**
 * Tingkatan model asisten "Do".
 *
 * Label & deskripsi sengaja netral: nama vendor/model tidak boleh muncul di UI
 * (permintaan owner — Do adalah merek sendiri). Id internal tetap membawa nama
 * teknis karena itulah yang dikirim ke API; jangan tampilkan id ini di layar.
 *
 * Pilihan Ollama (Kimi/DeepSeek/Gemma/Qwen/GLM) sudah dihapus; id lamanya
 * otomatis jatuh ke default lewat `normalizeModel`, jadi sesi & localStorage
 * lama tidak error.
 *
 * `supportsTemperature: false` untuk model yang menolak `temperature` selain 1 —
 * diverifikasi langsung ke API: gpt-5-mini dan gpt-5.5 mengembalikan HTTP 400
 * "Unsupported value: 'temperature' does not support 0.7 with this model",
 * sementara gpt-4o-mini, gpt-4.1-mini, gpt-4o, dan gpt-5.4-mini menerimanya.
 */
export const AI_ASSISTANT_MODELS = [
  {
    id: "openai:gpt-4o-mini",
    label: "Do Ringan",
    description: "Paling cepat dan hemat. Cocok untuk pertanyaan harian.",
    logo: "D",
    logoSrc: null,
    logoClassName: "from-emerald-200 via-teal-300 to-emerald-500 text-slate-950",
    supportsTemperature: true,
  },
  {
    id: "openai:gpt-4.1-mini",
    label: "Do Standar",
    description: "Seimbang antara kecepatan dan kedalaman jawaban.",
    logo: "D",
    logoSrc: null,
    logoClassName: "from-sky-200 via-cyan-300 to-blue-500 text-slate-950",
    supportsTemperature: true,
  },
  {
    id: "openai:gpt-4o",
    label: "Do Lanjut",
    description: "Jawaban lebih dalam untuk pertanyaan yang rumit.",
    logo: "D",
    logoSrc: null,
    logoClassName: "from-violet-200 via-fuchsia-300 to-rose-400 text-slate-950",
    supportsTemperature: true,
  },
  {
    id: "openai:gpt-5.4-mini",
    label: "Do Neo",
    description: "Generasi terbaru, ringkas dan gesit.",
    logo: "D",
    logoSrc: null,
    logoClassName: "from-amber-200 via-orange-300 to-rose-400 text-slate-950",
    supportsTemperature: true,
  },
  {
    id: "openai:gpt-5.5",
    label: "Do Maks",
    description: "Paling kuat. Pakai saat butuh analisis paling teliti.",
    logo: "D",
    logoSrc: null,
    logoClassName: "from-zinc-100 via-slate-300 to-zinc-500 text-slate-950",
    supportsTemperature: false,
  },
] as const;

export type AiAssistantModel = (typeof AI_ASSISTANT_MODELS)[number]["id"];

export const DEFAULT_AI_ASSISTANT_MODEL: AiAssistantModel = "openai:gpt-4o-mini";

/** Model berprefix ini dipanggil ke OpenAI, bukan Ollama. */
export const OPENAI_MODEL_PREFIX = "openai:";

export function isOpenAiAssistantModel(model: string): boolean {
  return model.startsWith(OPENAI_MODEL_PREFIX);
}

/** "openai:gpt-4o-mini" → "gpt-4o-mini" (id yang dikenal API OpenAI). */
export function stripOpenAiPrefix(model: string): string {
  return model.startsWith(OPENAI_MODEL_PREFIX)
    ? model.slice(OPENAI_MODEL_PREFIX.length)
    : model;
}

export const AI_ASSISTANT_SCOPES = [
  {
    id: "project_plus_general",
    label: "Project + General",
    description: "Data Talentpool tetap dipakai saat relevan, dan pertanyaan umum tetap dijawab.",
  },
  {
    id: "project_only",
    label: "Project Only",
    description: "Jawaban dibatasi ke data, module, dan konteks Talentpool.",
  },
  {
    id: "general",
    label: "General Chat",
    description: "Percakapan umum tanpa membawa data operasional Talentpool.",
  },
] as const;

export type AiAssistantScope = (typeof AI_ASSISTANT_SCOPES)[number]["id"];

export const DEFAULT_AI_ASSISTANT_SCOPE: AiAssistantScope = "project_plus_general";
export type AiAssistantSettings = {
  model: AiAssistantModel;
  scope: AiAssistantScope;
};

export const DEFAULT_AI_ASSISTANT_SETTINGS: AiAssistantSettings = {
  model: DEFAULT_AI_ASSISTANT_MODEL,
  scope: DEFAULT_AI_ASSISTANT_SCOPE,
};

export function resolveAiAssistantModel(value: unknown, fallback?: unknown): AiAssistantModel {
  const direct = normalizeModel(value);
  if (direct) return direct;

  const fallbackModel = normalizeModel(fallback);
  if (fallbackModel) return fallbackModel;

  return DEFAULT_AI_ASSISTANT_MODEL;
}

export function resolveAiAssistantScope(value: unknown, fallback?: unknown): AiAssistantScope {
  const direct = normalizeScope(value);
  if (direct) return direct;

  const fallbackScope = normalizeScope(fallback);
  if (fallbackScope) return fallbackScope;

  return DEFAULT_AI_ASSISTANT_SCOPE;
}

/** Id lama (model Ollama, atau varian yang sudah dihapus) → null → default. */
function normalizeModel(value: unknown): AiAssistantModel | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return AI_ASSISTANT_MODELS.some((model) => model.id === trimmed) ? (trimmed as AiAssistantModel) : null;
}

/** Model yang menolak temperature kustom harus dikirim tanpa field itu. */
export function modelSupportsTemperature(model: string): boolean {
  return AI_ASSISTANT_MODELS.find((m) => m.id === model)?.supportsTemperature ?? true;
}

function normalizeScope(value: unknown): AiAssistantScope | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return AI_ASSISTANT_SCOPES.some((scope) => scope.id === trimmed) ? (trimmed as AiAssistantScope) : null;
}
