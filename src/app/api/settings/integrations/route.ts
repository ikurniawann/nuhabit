import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import {
  DEEPSEEK_DEFAULTS,
  OPENAI_DEFAULTS,
  SETTING_KEYS,
  getSettings,
  maskSecret,
  setSetting,
} from "@/lib/settings/app-settings";

/**
 * GET  /api/settings/integrations — konfigurasi integrasi (API key dimask).
 * PUT  /api/settings/integrations — simpan konfigurasi DeepSeek/OpenAI.
 *      Field DeepSeek tetap flat (api_key/model/base_url) demi kompatibilitas;
 *      OpenAI dikirim sebagai objek `openai: {api_key, model, base_url}`.
 */

const PROVIDER_KEYS = {
  deepseek: {
    apiKey: SETTING_KEYS.DEEPSEEK_API_KEY,
    model: SETTING_KEYS.DEEPSEEK_MODEL,
    baseUrl: SETTING_KEYS.DEEPSEEK_BASE_URL,
    defaults: DEEPSEEK_DEFAULTS,
  },
  openai: {
    apiKey: SETTING_KEYS.OPENAI_API_KEY,
    model: SETTING_KEYS.OPENAI_MODEL,
    baseUrl: SETTING_KEYS.OPENAI_BASE_URL,
    defaults: OPENAI_DEFAULTS,
  },
} as const;

type Provider = keyof typeof PROVIDER_KEYS;

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.settingsIntegrations);
  const keys = Object.values(PROVIDER_KEYS).flatMap((k) => [k.apiKey, k.model, k.baseUrl]);
  const s = await getSettings(keys);
  const view = (provider: Provider) => {
    const k = PROVIDER_KEYS[provider];
    return {
      api_key_masked: maskSecret(s[k.apiKey]),
      has_api_key: Boolean(s[k.apiKey]),
      model: s[k.model] || k.defaults.model,
      base_url: s[k.baseUrl] || k.defaults.baseUrl,
    };
  };
  return NextResponse.json({ data: { deepseek: view("deepseek"), openai: view("openai") } });
}, "GET /api/settings/integrations");

/** Validasi {api_key, model, base_url} parsial satu provider; lempar 400 berprefiks. */
function validateProviderInput(input: { api_key?: unknown; model?: unknown; base_url?: unknown }, prefix: string) {
  const fail = (message: string) => ApiError.badRequest(`${prefix}${message}`);
  const { api_key, model, base_url } = input;
  if (api_key !== undefined && api_key !== null && typeof api_key !== "string") throw fail("api_key tidak valid");
  if (model !== undefined && (typeof model !== "string" || !model.trim())) throw fail("model tidak valid");
  if (base_url !== undefined && (typeof base_url !== "string" || !/^https?:\/\//.test(base_url.trim()))) {
    throw fail("base_url tidak valid");
  }
  return input as { api_key?: string | null; model?: string; base_url?: string };
}

async function applyProviderConfig(provider: Provider, input: ReturnType<typeof validateProviderInput>) {
  const keys = PROVIDER_KEYS[provider];
  // string kosong = hapus key; string berisi = simpan; undefined = tidak diubah
  if (input.api_key !== undefined) await setSetting(keys.apiKey, input.api_key ? input.api_key.trim() : null);
  if (input.model !== undefined) await setSetting(keys.model, input.model.trim());
  if (input.base_url !== undefined) await setSetting(keys.baseUrl, input.base_url.trim().replace(/\/+$/, ""));
}

export const PUT = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.settingsIntegrations);
  const body = ((await request.json()) ?? {}) as Record<string, unknown>;
  const { api_key, model, base_url, openai } = body;

  // Field flat = DeepSeek (bentuk payload lama, tetap didukung)
  await applyProviderConfig("deepseek", validateProviderInput({ api_key, model, base_url }, ""));
  if (openai !== undefined) {
    if (openai === null || typeof openai !== "object") throw ApiError.badRequest("openai tidak valid");
    await applyProviderConfig("openai", validateProviderInput(openai, "openai: "));
  }
  return NextResponse.json({ message: "Konfigurasi tersimpan" });
}, "PUT /api/settings/integrations");
