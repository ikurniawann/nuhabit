import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSettingsMock = vi.fn();
vi.mock("@/lib/settings/app-settings", () => ({
  SETTING_KEYS: {
    WA_GATEWAY_URL: "wa_gateway_url",
    WA_GATEWAY_TOKEN: "wa_gateway_token",
  },
  getSettings: (...args: unknown[]) => getSettingsMock(...args),
}));

import { invalidateGatewayConfigCache, loadGatewayConfig } from "./gateway";

/**
 * Tes ditulis lebih dulu — konfigurasi gateway pindah ke database
 * (configuration.app_settings) dengan ENV sebagai fallback, mengikuti pola
 * DeepSeek/Google BP yang sudah ada.
 *
 * Yang dijaga: urutan prioritas (DB menang atas ENV), fallback saat DB
 * bermasalah (OTP tidak boleh mati karena tabel settings sedang error),
 * dan cache supaya jalur kirim WA tidak menambah satu query DB per pesan.
 */

const ENV_KEYS = ["WA_GATEWAY_URL", "WA_GATEWAY_TOKEN", "WA_GATEWAY_TIMEOUT_MS"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  getSettingsMock.mockReset();
  invalidateGatewayConfigCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("loadGatewayConfig", () => {
  it("memakai nilai database bila ada", async () => {
    getSettingsMock.mockResolvedValue({
      wa_gateway_url: "http://172.17.0.1:3471",
      wa_gateway_token: "token-db",
    });

    const config = await loadGatewayConfig();
    expect(config).toMatchObject({
      baseUrl: "http://172.17.0.1:3471",
      token: "token-db",
    });
  });

  it("database menang atas ENV — sumber kebenaran yang bisa diedit dari UI", async () => {
    process.env.WA_GATEWAY_TOKEN = "token-env";
    process.env.WA_GATEWAY_URL = "http://127.0.0.1:9999";
    getSettingsMock.mockResolvedValue({
      wa_gateway_url: "http://172.17.0.1:3471",
      wa_gateway_token: "token-db",
    });

    const config = await loadGatewayConfig();
    expect(config?.token).toBe("token-db");
    expect(config?.baseUrl).toBe("http://172.17.0.1:3471");
  });

  it("jatuh ke ENV bila database kosong", async () => {
    process.env.WA_GATEWAY_TOKEN = "token-env";
    getSettingsMock.mockResolvedValue({ wa_gateway_url: null, wa_gateway_token: null });

    const config = await loadGatewayConfig();
    expect(config).toMatchObject({
      baseUrl: "http://127.0.0.1:3471",
      token: "token-env",
    });
  });

  it("token DB + URL ENV boleh dicampur", async () => {
    process.env.WA_GATEWAY_URL = "http://host.docker.internal:3471";
    getSettingsMock.mockResolvedValue({ wa_gateway_url: null, wa_gateway_token: "token-db" });

    const config = await loadGatewayConfig();
    expect(config).toMatchObject({
      baseUrl: "http://host.docker.internal:3471",
      token: "token-db",
    });
  });

  it("tanpa token sama sekali → null (fitur WA mati rapi, bukan melempar)", async () => {
    getSettingsMock.mockResolvedValue({ wa_gateway_url: "http://x:1", wa_gateway_token: null });
    expect(await loadGatewayConfig()).toBeNull();
  });

  it("query settings gagal → fallback ENV, bukan mematikan jalur OTP", async () => {
    process.env.WA_GATEWAY_TOKEN = "token-env";
    getSettingsMock.mockRejectedValue(new Error("db down"));

    const config = await loadGatewayConfig();
    expect(config?.token).toBe("token-env");
  });

  it("hasil di-cache — kirim 100 WA tidak berarti 100 query settings", async () => {
    getSettingsMock.mockResolvedValue({ wa_gateway_url: null, wa_gateway_token: "t" });

    await loadGatewayConfig();
    await loadGatewayConfig();
    await loadGatewayConfig();
    expect(getSettingsMock).toHaveBeenCalledTimes(1);
  });

  it("invalidate → dibaca ulang (dipakai setelah simpan dari UI)", async () => {
    getSettingsMock.mockResolvedValue({ wa_gateway_url: null, wa_gateway_token: "lama" });
    await loadGatewayConfig();

    getSettingsMock.mockResolvedValue({ wa_gateway_url: null, wa_gateway_token: "baru" });
    invalidateGatewayConfigCache();

    const config = await loadGatewayConfig();
    expect(config?.token).toBe("baru");
    expect(getSettingsMock).toHaveBeenCalledTimes(2);
  });
});
