import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { TTS_PREVIEW_TEXT, isTtsProviderId } from "@/lib/tts/catalog";
import { TtsNotConfiguredError, synthesizeSpeech } from "@/lib/tts/synthesize";

/**
 * POST /api/settings/tts/preview — dengarkan kombinasi provider/voice/model
 * SEBELUM disimpan, memakai kalimat pembuka wawancara yang sesungguhnya.
 *
 * Body opsional: { provider, voice, model, text }.
 * Tanpa body → memakai konfigurasi tersimpan.
 */

/** Teks bebas dibatasi agar tombol preview tidak jadi corong TTS gratis. */
const MAX_PREVIEW_CHARS = 300;

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.settingsIntegrations);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.provider !== undefined && !isTtsProviderId(body.provider)) {
    throw ApiError.badRequest("Provider tidak dikenal");
  }

  const rawText = typeof body.text === "string" ? body.text.trim() : "";
  const text = (rawText || TTS_PREVIEW_TEXT).slice(0, MAX_PREVIEW_CHARS);

  const result = await synthesizeSpeech(text, {
    provider: isTtsProviderId(body.provider) ? body.provider : undefined,
    voice: typeof body.voice === "string" ? body.voice : undefined,
    model: typeof body.model === "string" ? body.model : undefined,
  }).catch((error: unknown) => {
    if (error instanceof TtsNotConfiguredError) throw ApiError.badRequest(error.message);
    // Pesan provider diteruskan apa adanya: inilah gunanya preview — kalau key
    // salah atau voice tidak ada, admin harus melihat alasannya, bukan "gagal".
    const message = error instanceof Error ? error.message : "Gagal membuat preview";
    console.error("[settings/tts/preview] gagal:", message);
    throw new ApiError(502, message);
  });

  return NextResponse.json({
    data: {
      audio_base64: result.buffer.toString("base64"),
      provider: result.provider,
      voice: result.voice,
      model: result.model,
      text,
    },
  });
}, "POST /api/settings/tts/preview");
