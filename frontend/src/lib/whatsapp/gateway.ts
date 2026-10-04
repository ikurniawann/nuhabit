/**
 * Penyedia `gateway` — service WhatsApp mandiri milik sendiri
 * (`services/wa-gateway`, Baileys) yang berjalan sebagai proses PM2 terpisah.
 *
 * Dipisah dari aplikasi Next.js dengan sengaja: koneksi WhatsApp harus hidup
 * terus-menerus, sedangkan aplikasi ini di-restart setiap deploy — kalau
 * disatukan, sesi WhatsApp putus tiap kali rilis.
 */

import type { TextMessage, WhatsAppResult } from "./types";

export interface GatewayConfig {
  baseUrl: string;
  token: string;
  timeoutMs: number;
}

export function readGatewayConfig(): GatewayConfig | null {
  const token = process.env.WA_GATEWAY_TOKEN;
  if (!token) return null;

  return {
    baseUrl: process.env.WA_GATEWAY_URL || "http://127.0.0.1:3471",
    token,
    timeoutMs: Number(process.env.WA_GATEWAY_TIMEOUT_MS || 20000),
  };
}

/* Cache modul untuk konfigurasi dari database. TTL pendek: cukup untuk
 * mencegah satu query settings per pesan WA, tapi perubahan dari UI tetap
 * terasa cepat (dan UI memanggil invalidate langsung setelah menyimpan). */
const CONFIG_CACHE_TTL_MS = 30_000;
let configCache: { at: number; value: GatewayConfig | null } | null = null;

export function invalidateGatewayConfigCache(): void {
  configCache = null;
}

/**
 * Konfigurasi gateway: database dulu (configuration.app_settings — bisa
 * diedit dari UI, per-instance), lalu ENV sebagai fallback. Mengikuti pola
 * DeepSeek/Google BP di app-settings.ts.
 *
 * Kegagalan membaca settings TIDAK mematikan jalur WA: jatuh ke ENV. OTP
 * login tidak boleh mati hanya karena tabel settings sedang bermasalah.
 */
export async function loadGatewayConfig(): Promise<GatewayConfig | null> {
  if (configCache && Date.now() - configCache.at < CONFIG_CACHE_TTL_MS) {
    return configCache.value;
  }

  let dbUrl: string | null = null;
  let dbToken: string | null = null;
  try {
    // Import dinamis: modul ini ikut terimpor dari kode yang juga dibundel
    // untuk klien (lewat barrel whatsapp/index) — jalur DB hanya boleh
    // tersentuh saat benar-benar dieksekusi di server.
    const { SETTING_KEYS, getSettings } = await import("@/lib/settings/app-settings");
    const stored = await getSettings([
      SETTING_KEYS.WA_GATEWAY_URL,
      SETTING_KEYS.WA_GATEWAY_TOKEN,
    ]);
    dbUrl = stored[SETTING_KEYS.WA_GATEWAY_URL]?.trim() || null;
    dbToken = stored[SETTING_KEYS.WA_GATEWAY_TOKEN]?.trim() || null;
  } catch {
    // settings tidak terbaca → murni ENV
  }

  const token = dbToken ?? process.env.WA_GATEWAY_TOKEN ?? null;
  const value: GatewayConfig | null = token
    ? {
        baseUrl: dbUrl ?? process.env.WA_GATEWAY_URL ?? "http://127.0.0.1:3471",
        token,
        timeoutMs: Number(process.env.WA_GATEWAY_TIMEOUT_MS || 20000),
      }
    : null;

  configCache = { at: Date.now(), value };
  return value;
}

async function callGateway(
  config: GatewayConfig,
  path: string,
  init: RequestInit
): Promise<{ ok: boolean; status: number; data: unknown }> {
  // Gateway memberi jeda antar pesan, jadi permintaan bisa menunggu beberapa
  // detik. Timeout tetap dipasang supaya request aplikasi tidak menggantung.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-gateway-token": config.token,
        ...(init.headers ?? {}),
      },
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendGatewayText(
  config: GatewayConfig,
  message: TextMessage
): Promise<WhatsAppResult> {
  try {
    const { ok, data } = await callGateway(config, "/send", {
      method: "POST",
      body: JSON.stringify({ target: message.target, message: message.message }),
    });

    if (!ok) {
      const reason =
        (data as { error?: string })?.error ?? "Gateway menolak permintaan kirim";
      return { success: false, provider: "gateway", reason };
    }

    return {
      success: true,
      provider: "gateway",
      messageId: (data as { messageId?: string })?.messageId ?? undefined,
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    const reason = isTimeout
      ? "Gateway tidak merespons (timeout)"
      : error instanceof Error
        ? error.message
        : "Unknown error";
    return { success: false, provider: "gateway", reason, timedOut: isTimeout };
  }
}

export interface GatewayStatus {
  connected: boolean;
  phone: string | null;
  needsPairing: boolean;
  lastConnectedAt: string | null;
  lastDisconnectReason: string | null;
}

/** Status koneksi gateway — untuk halaman monitoring/diagnosa. */
export async function getGatewayStatus(
  config: GatewayConfig
): Promise<GatewayStatus | null> {
  try {
    const { data } = await callGateway(config, "/health", { method: "GET" });
    if (!data || typeof data !== "object") return null;
    return data as GatewayStatus;
  } catch {
    return null;
  }
}
