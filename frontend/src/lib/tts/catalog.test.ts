import { describe, expect, it } from "vitest";
import {
  getTtsProvider,
  isTtsProviderId,
  resolveTtsModel,
  resolveTtsVoice,
  TTS_PROVIDERS,
} from "./catalog";

describe("isTtsProviderId", () => {
  it("menerima id yang terdaftar", () => {
    expect(isTtsProviderId("azure")).toBe(true);
  });

  it("menolak nilai asing dan non-string", () => {
    expect(isTtsProviderId("aws")).toBe(false);
    expect(isTtsProviderId(null)).toBe(false);
    expect(isTtsProviderId(undefined)).toBe(false);
  });
});

describe("getTtsProvider", () => {
  it("jatuh ke OpenAI bila setting rusak, bukan melempar error", () => {
    expect(getTtsProvider("provider-yang-sudah-dihapus").id).toBe("openai");
  });
});

describe("resolveTtsVoice", () => {
  it("memakai voice tersimpan bila ada di katalog", () => {
    expect(resolveTtsVoice("openai", "nova")).toBe("nova");
  });

  it("menolak voice asing pada provider berkatalog tertutup", () => {
    // Voice OpenAI tidak bisa dikarang: request-nya akan ditolak API.
    expect(resolveTtsVoice("openai", "id-ID-GadisNeural")).toBe("coral");
  });

  it("mengizinkan voice kustom pada provider yang membolehkan", () => {
    // Azure & ElevenLabs punya ratusan voice di luar katalog kita.
    expect(resolveTtsVoice("azure", "id-ID-LainnyaNeural")).toBe("id-ID-LainnyaNeural");
    expect(resolveTtsVoice("elevenlabs", "voice-hasil-cloning")).toBe("voice-hasil-cloning");
  });

  it("jatuh ke default bila kosong atau hanya spasi", () => {
    expect(resolveTtsVoice("azure", "   ")).toBe("id-ID-GadisNeural");
    expect(resolveTtsVoice("openai", null)).toBe("coral");
  });

  it("merapikan spasi di tepi voice kustom", () => {
    expect(resolveTtsVoice("azure", "  id-ID-ArdiNeural  ")).toBe("id-ID-ArdiNeural");
  });
});

describe("resolveTtsModel", () => {
  it("memakai model tersimpan bila dikenal", () => {
    expect(resolveTtsModel("openai", "tts-1-hd")).toBe("tts-1-hd");
  });

  it("jatuh ke default bila model tidak dikenal", () => {
    expect(resolveTtsModel("openai", "tts-9")).toBe("gpt-4o-mini-tts");
    expect(resolveTtsModel("elevenlabs", "")).toBe("eleven_multilingual_v2");
  });
});

describe("katalog", () => {
  it("setiap provider punya default yang konsisten dengan katalognya", () => {
    for (const provider of Object.values(TTS_PROVIDERS)) {
      expect(provider.models).toContain(provider.defaultModel);
      if (provider.defaultVoice) {
        // Provider berkatalog tertutup wajib punya default yang valid; provider
        // custom-voice (ElevenLabs) boleh kosong karena voice-nya milik akun user.
        if (!provider.allowCustomVoice) {
          expect(provider.voices.some((v) => v.id === provider.defaultVoice)).toBe(true);
        }
      }
    }
  });

  it("menandai suara mana yang benar-benar penutur asli Indonesia", () => {
    expect(TTS_PROVIDERS.openai.voices.every((v) => !v.nativeIndonesian)).toBe(true);
    expect(TTS_PROVIDERS.azure.voices.every((v) => v.nativeIndonesian)).toBe(true);
  });
});
