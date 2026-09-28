/**
 * Konfigurasi GoBiz / GoFood dari app_settings (Settings → Integrasi).
 *
 * URL default mengikuti developer.gobiz.com (Direct Integration):
 * - sandbox API  : https://api.partner-sandbox.gobiz.co.id
 * - sandbox OAuth: https://integration-goauth.gojekapi.com/oauth2/token
 * - produksi API : https://api.gobiz.co.id
 * - produksi OAuth: contoh di dokumen autentikasi memakai
 *   https://accounts.go-jek.com/oauth2/token — KONFIRMASI ke tim GoBiz saat
 *   kredensial produksi diberikan; bisa dioverride lewat setting.
 */

import { randomBytes } from "crypto";
import { getSettings, SETTING_KEYS, setSetting } from "@/lib/settings/app-settings";
import type { GobizEnvironment } from "./types";

export const GOBIZ_DEFAULTS: Record<GobizEnvironment, { apiBase: string; oauthUrl: string }> = {
  sandbox: {
    apiBase: "https://api.partner-sandbox.gobiz.co.id",
    oauthUrl: "https://integration-goauth.gojekapi.com/oauth2/token",
  },
  production: {
    apiBase: "https://api.gobiz.co.id",
    oauthUrl: "https://accounts.go-jek.com/oauth2/token",
  },
};

export const GOBIZ_SCOPES =
  "gofood:catalog:write gofood:catalog:read gofood:order:write gofood:order:read gofood:outlet:write promo:food_promo:read promo:food_promo:write";

export type GobizConfig = {
  enabled: boolean;
  environment: GobizEnvironment;
  clientId: string;
  clientSecret: string;
  outletId: string;
  webhookToken: string;
  autoAccept: boolean;
  partnerId: string;
  /** Kunci HMAC X-Go-Signature (Relay secret di Developer Portal). */
  relaySecret: string;
  /** true = webhook dgn tanda tangan salah/absen ditolak 401; false = hanya dicatat. */
  enforceSignature: boolean;
  apiBase: string;
  oauthUrl: string;
};

export function normalizeEnvironment(value: string | null | undefined): GobizEnvironment {
  return value === "production" ? "production" : "sandbox";
}

export function resolveGobizUrls(
  environment: GobizEnvironment,
  overrides: { apiBase?: string | null; oauthUrl?: string | null } = {}
) {
  const defaults = GOBIZ_DEFAULTS[environment];
  return {
    apiBase: (overrides.apiBase?.trim() || defaults.apiBase).replace(/\/$/, ""),
    oauthUrl: overrides.oauthUrl?.trim() || defaults.oauthUrl,
  };
}

export function isGobizConfigured(config: Pick<GobizConfig, "clientId" | "clientSecret" | "outletId">) {
  return Boolean(config.clientId && config.clientSecret && config.outletId);
}

/** URL webhook publik yang didaftarkan ke GoBiz — token acak di path = autentikasi kita. */
export function gobizWebhookUrl(appUrl: string, webhookToken: string) {
  return `${appUrl.replace(/\/$/, "")}/api/integrations/gobiz/webhook/${webhookToken}`;
}

export function generateWebhookToken() {
  return randomBytes(24).toString("hex");
}

export async function loadGobizConfig(): Promise<GobizConfig> {
  const s = await getSettings([
    SETTING_KEYS.GOBIZ_ENABLED,
    SETTING_KEYS.GOBIZ_ENVIRONMENT,
    SETTING_KEYS.GOBIZ_CLIENT_ID,
    SETTING_KEYS.GOBIZ_CLIENT_SECRET,
    SETTING_KEYS.GOBIZ_OUTLET_ID,
    SETTING_KEYS.GOBIZ_WEBHOOK_TOKEN,
    SETTING_KEYS.GOBIZ_AUTO_ACCEPT,
    SETTING_KEYS.GOBIZ_OAUTH_URL,
    SETTING_KEYS.GOBIZ_API_BASE_URL,
    SETTING_KEYS.GOBIZ_PARTNER_ID,
    SETTING_KEYS.GOBIZ_RELAY_SECRET,
    SETTING_KEYS.GOBIZ_SIGNATURE_ENFORCE,
  ]);
  const environment = normalizeEnvironment(s[SETTING_KEYS.GOBIZ_ENVIRONMENT]);
  const urls = resolveGobizUrls(environment, {
    apiBase: s[SETTING_KEYS.GOBIZ_API_BASE_URL],
    oauthUrl: s[SETTING_KEYS.GOBIZ_OAUTH_URL],
  });
  return {
    enabled: s[SETTING_KEYS.GOBIZ_ENABLED] === "true",
    environment,
    clientId: s[SETTING_KEYS.GOBIZ_CLIENT_ID]?.trim() || "",
    clientSecret: s[SETTING_KEYS.GOBIZ_CLIENT_SECRET]?.trim() || "",
    outletId: s[SETTING_KEYS.GOBIZ_OUTLET_ID]?.trim() || "",
    webhookToken: s[SETTING_KEYS.GOBIZ_WEBHOOK_TOKEN]?.trim() || "",
    autoAccept: s[SETTING_KEYS.GOBIZ_AUTO_ACCEPT] === "true",
    partnerId: s[SETTING_KEYS.GOBIZ_PARTNER_ID]?.trim() || "",
    relaySecret: s[SETTING_KEYS.GOBIZ_RELAY_SECRET]?.trim() || "",
    enforceSignature: s[SETTING_KEYS.GOBIZ_SIGNATURE_ENFORCE] === "true",
    ...urls,
  };
}

/** Pastikan token webhook ada (dibuat sekali, dipakai di URL pendaftaran). */
export async function ensureWebhookToken(): Promise<string> {
  const current = (await getSettings([SETTING_KEYS.GOBIZ_WEBHOOK_TOKEN]))[SETTING_KEYS.GOBIZ_WEBHOOK_TOKEN];
  if (current?.trim()) return current.trim();
  const token = generateWebhookToken();
  await setSetting(SETTING_KEYS.GOBIZ_WEBHOOK_TOKEN, token);
  return token;
}
