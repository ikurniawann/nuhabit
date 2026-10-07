import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildTemplatePayload,
  buildTextPayload,
  extractMetaError,
} from "@/lib/whatsapp/meta";
import { metaEndpoint, readMetaConfig } from "@/lib/whatsapp/meta";
import { resolveProvider } from "@/lib/whatsapp";

const ENV_KEYS = [
  "WHATSAPP_PROVIDER",
  "META_WA_ACCESS_TOKEN",
  "META_WA_PHONE_NUMBER_ID",
  "META_WA_GRAPH_VERSION",
  "FONNTE_API_KEY",
  "WA_GATEWAY_TOKEN",
  "WA_GATEWAY_URL",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("buildTemplatePayload — template OTP Meta", () => {
  it("menyusun body + tombol salin-kode berisi kode yang sama", () => {
    const payload = buildTemplatePayload({
      target: "628123456789",
      templateName: "otp_login",
      languageCode: "id",
      bodyParameters: ["123456"],
      copyCodeButton: "123456",
    });

    expect(payload).toMatchObject({
      messaging_product: "whatsapp",
      to: "628123456789",
      type: "template",
      template: {
        name: "otp_login",
        language: { code: "id" },
      },
    });

    const components = (payload.template as { components: Record<string, unknown>[] }).components;
    expect(components).toHaveLength(2);
    expect(components[0]).toEqual({
      type: "body",
      parameters: [{ type: "text", text: "123456" }],
    });
    expect(components[1]).toEqual({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "123456" }],
    });
  });

  it("tanpa tombol bila copyCodeButton tidak diisi", () => {
    const payload = buildTemplatePayload({
      target: "628123456789",
      templateName: "otp_login",
      languageCode: "id",
      bodyParameters: ["123456"],
    });

    const components = (payload.template as { components: Record<string, unknown>[] }).components;
    expect(components).toHaveLength(1);
    expect(components[0]).toMatchObject({ type: "body" });
  });
});

describe("buildTextPayload", () => {
  it("menonaktifkan pratinjau tautan", () => {
    expect(buildTextPayload({ target: "628123", message: "Halo" })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "628123",
      type: "text",
      text: { preview_url: false, body: "Halo" },
    });
  });
});

describe("extractMetaError", () => {
  it("merangkum pesan + kode error Graph API", () => {
    const reason = extractMetaError({
      error: { message: "Template name does not exist", code: 132001, error_subcode: 2494010 },
    });

    expect(reason).toContain("Template name does not exist");
    expect(reason).toContain("132001");
  });

  it("aman saat bentuk respons tidak dikenal", () => {
    expect(extractMetaError(null)).toBe("Unknown error");
    expect(extractMetaError({})).toBe("Unknown error");
  });
});

describe("readMetaConfig & metaEndpoint", () => {
  it("null bila kredensial belum lengkap", () => {
    process.env.META_WA_ACCESS_TOKEN = "token";
    expect(readMetaConfig()).toBeNull();
  });

  it("versi Graph default v21.0 dan URL memuat phone number id", () => {
    process.env.META_WA_ACCESS_TOKEN = "token";
    process.env.META_WA_PHONE_NUMBER_ID = "12345";

    const config = readMetaConfig();
    expect(config?.graphVersion).toBe("v21.0");
    expect(metaEndpoint(config!)).toBe("https://graph.facebook.com/v21.0/12345/messages");
  });
});

describe("resolveProvider", () => {
  it("null bila tidak ada penyedia terkonfigurasi", () => {
    expect(resolveProvider()).toBeNull();
  });

  it("Meta didahulukan saat keduanya terkonfigurasi", () => {
    process.env.META_WA_ACCESS_TOKEN = "token";
    process.env.META_WA_PHONE_NUMBER_ID = "12345";
    process.env.FONNTE_API_KEY = "fonnte";

    expect(resolveProvider()).toBe("meta");
  });

  it("hormati pilihan eksplisit fonnte", () => {
    process.env.WHATSAPP_PROVIDER = "fonnte";
    process.env.META_WA_ACCESS_TOKEN = "token";
    process.env.META_WA_PHONE_NUMBER_ID = "12345";
    process.env.FONNTE_API_KEY = "fonnte";

    expect(resolveProvider()).toBe("fonnte");
  });

  it("pilihan eksplisit meta tanpa kredensial → null, bukan diam-diam pindah ke fonnte", () => {
    process.env.WHATSAPP_PROVIDER = "meta";
    process.env.FONNTE_API_KEY = "fonnte";

    expect(resolveProvider()).toBeNull();
  });
});

describe("resolveProvider — gateway mandiri", () => {
  it("terdeteksi dari WA_GATEWAY_TOKEN saja", () => {
    process.env.WA_GATEWAY_TOKEN = "rahasia";
    expect(resolveProvider()).toBe("gateway");
  });

  it("urutan preferensi otomatis: meta > gateway > fonnte", () => {
    process.env.WA_GATEWAY_TOKEN = "rahasia";
    process.env.FONNTE_API_KEY = "fonnte";
    expect(resolveProvider()).toBe("gateway");

    process.env.META_WA_ACCESS_TOKEN = "token";
    process.env.META_WA_PHONE_NUMBER_ID = "12345";
    expect(resolveProvider()).toBe("meta");
  });

  it("pilihan eksplisit gateway tanpa token → null", () => {
    process.env.WHATSAPP_PROVIDER = "gateway";
    process.env.FONNTE_API_KEY = "fonnte";
    expect(resolveProvider()).toBeNull();
  });
});
