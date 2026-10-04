import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { SETTING_KEYS, getSettings, maskSecret, setSetting } from "@/lib/settings/app-settings";
import {
  TTS_DEFAULT_PROVIDER,
  TTS_PROVIDERS,
  getTtsProvider,
  isTtsProviderId,
  resolveTtsModel,
  resolveTtsVoice,
} from "@/lib/tts/catalog";

/**
 * GET /api/settings/tts  — konfigurasi suara AI + katalog provider/voice.
 * PUT /api/settings/tts  — simpan provider, voice, model, dan kredensial.
 *
 * Rahasia (Azure key, ElevenLabs key) tidak pernah dikirim balik utuh, hanya
 * versi tersamar — pola sama dengan /api/settings/integrations.
 */

const credential = z.string().nullable().optional();
const putSchema = z.object({
  provider: z.unknown().optional(),
  voice: z.string({ message: "Voice tidak valid" }).optional(),
  model: z.string({ message: "Model tidak valid" }).optional(),
  azure_key: credential,
  azure_region: credential,
  elevenlabs_key: credential,
});

const CREDENTIAL_KEYS = [
  ["azure_key", SETTING_KEYS.AZURE_SPEECH_KEY],
  ["azure_region", SETTING_KEYS.AZURE_SPEECH_REGION],
  ["elevenlabs_key", SETTING_KEYS.ELEVENLABS_API_KEY],
] as const;

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.settingsIntegrations);
  const s = await getSettings([
    SETTING_KEYS.TTS_PROVIDER,
    SETTING_KEYS.TTS_VOICE,
    SETTING_KEYS.TTS_MODEL,
    SETTING_KEYS.OPENAI_API_KEY,
    SETTING_KEYS.AZURE_SPEECH_KEY,
    SETTING_KEYS.AZURE_SPEECH_REGION,
    SETTING_KEYS.ELEVENLABS_API_KEY,
  ]);
  const provider = getTtsProvider(s[SETTING_KEYS.TTS_PROVIDER] ?? TTS_DEFAULT_PROVIDER).id;

  return NextResponse.json({
    data: {
      provider,
      voice: resolveTtsVoice(provider, s[SETTING_KEYS.TTS_VOICE]),
      model: resolveTtsModel(provider, s[SETTING_KEYS.TTS_MODEL]),
      catalog: TTS_PROVIDERS,
      credentials: {
        openai: { configured: Boolean(s[SETTING_KEYS.OPENAI_API_KEY]) },
        azure: {
          configured: Boolean(s[SETTING_KEYS.AZURE_SPEECH_KEY] && s[SETTING_KEYS.AZURE_SPEECH_REGION]),
          key_masked: maskSecret(s[SETTING_KEYS.AZURE_SPEECH_KEY]),
          region: s[SETTING_KEYS.AZURE_SPEECH_REGION] ?? "",
        },
        elevenlabs: {
          configured: Boolean(s[SETTING_KEYS.ELEVENLABS_API_KEY]),
          key_masked: maskSecret(s[SETTING_KEYS.ELEVENLABS_API_KEY]),
        },
      },
    },
  });
}, "GET /api/settings/tts");

export const PUT = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.settingsIntegrations);
  const body = await validateBody(request, putSchema);

  if (body.provider !== undefined) {
    if (!isTtsProviderId(body.provider)) throw ApiError.badRequest("Provider tidak dikenal");
    await setSetting(SETTING_KEYS.TTS_PROVIDER, body.provider);
  }

  // Voice & model divalidasi terhadap provider yang BARU disimpan, supaya
  // kombinasi mustahil (mis. voice Azure di provider OpenAI) tidak tersimpan.
  const current = await getSettings([SETTING_KEYS.TTS_PROVIDER]);
  const activeProvider = getTtsProvider(current[SETTING_KEYS.TTS_PROVIDER]).id;
  if (body.voice !== undefined) {
    await setSetting(SETTING_KEYS.TTS_VOICE, resolveTtsVoice(activeProvider, body.voice) || null);
  }
  if (body.model !== undefined) {
    await setSetting(SETTING_KEYS.TTS_MODEL, resolveTtsModel(activeProvider, body.model));
  }

  for (const [field, key] of CREDENTIAL_KEYS) {
    const value = body[field];
    // string kosong / null = hapus, string berisi = simpan, undefined = tidak diubah
    if (value !== undefined) await setSetting(key, value ? value.trim() : null);
  }
  return NextResponse.json({ success: true });
}, "PUT /api/settings/tts");
