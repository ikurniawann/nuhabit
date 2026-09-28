import { query, queryOne } from "@/lib/db";

/**
 * Key-value app settings di configuration.app_settings.
 * Dipakai untuk konfigurasi integrasi yang bisa diubah dari dashboard
 * (mis. DeepSeek API key untuk analisis CV).
 */

export const SETTING_KEYS = {
  DEEPSEEK_API_KEY: "deepseek_api_key",
  DEEPSEEK_MODEL: "deepseek_model",
  DEEPSEEK_BASE_URL: "deepseek_base_url",
  OPENAI_API_KEY: "openai_api_key",
  OPENAI_MODEL: "openai_model",
  OPENAI_BASE_URL: "openai_base_url",
  // Suara AI / text-to-speech (EPIC-016) — dipakai Interview AI.
  // Provider dipisah dari kredensial OpenAI di atas karena suara bisa dipindah
  // ke Azure/ElevenLabs tanpa mengubah konfigurasi teks/vision.
  TTS_PROVIDER: "tts_provider",
  TTS_VOICE: "tts_voice",
  TTS_MODEL: "tts_model",
  AZURE_SPEECH_KEY: "azure_speech_key",
  AZURE_SPEECH_REGION: "azure_speech_region",
  ELEVENLABS_API_KEY: "elevenlabs_api_key",
  // Profil legal perusahaan — dipakai dokumen kontrak kerja (PIHAK PERTAMA).
  // Kosong = dirender sebagai garis isian di PDF.
  COMPANY_LEGAL_NAME: "company_legal_name",
  COMPANY_ADDRESS: "company_address",
  COMPANY_CITY: "company_city",
  COMPANY_SIGNER_NAME: "company_signer_name",
  COMPANY_SIGNER_TITLE: "company_signer_title",
  // Google Business Profile (EPIC-013 Fase A) — diisi Super Admin lewat UI.
  // Rahasia tidak pernah dikirim balik ke browser, hanya versi tersamar.
  GOOGLE_BP_CLIENT_ID: "google_bp_client_id",
  GOOGLE_BP_CLIENT_SECRET: "google_bp_client_secret",
  GOOGLE_BP_REFRESH_TOKEN: "google_bp_refresh_token",
  GOOGLE_BP_ACCOUNT_ID: "google_bp_account_id",
  GOOGLE_BP_LOCATION_ID: "google_bp_location_id",
  // Gateway WhatsApp mandiri (services/wa-gateway) — diisi Super Admin lewat
  // UI Settings → WhatsApp Gateway. DB menang atas ENV supaya tiap instance
  // (arkiv/habitat/royal-oriental) bisa menunjuk gateway & nomor berbeda
  // tanpa menyentuh CI variable. Nomor pengirimnya sendiri TIDAK di sini —
  // ditentukan oleh akun yang memindai QR saat pairing.
  WA_GATEWAY_URL: "wa_gateway_url",
  WA_GATEWAY_TOKEN: "wa_gateway_token",
  // Identitas merchant di tampilan QRIS kasir (dialog QR bergaya standar
  // QRIS Indonesia). Kosong = nama jatuh ke COMPANY_LEGAL_NAME, NMID disembunyikan.
  QRIS_MERCHANT_NAME: "qris_merchant_name",
  // GoBiz / GoFood (EPIC-049)
  GOBIZ_ENABLED: "gobiz_enabled",
  GOBIZ_ENVIRONMENT: "gobiz_environment",
  GOBIZ_CLIENT_ID: "gobiz_client_id",
  GOBIZ_CLIENT_SECRET: "gobiz_client_secret",
  GOBIZ_OUTLET_ID: "gobiz_outlet_id",
  GOBIZ_WEBHOOK_TOKEN: "gobiz_webhook_token",
  GOBIZ_AUTO_ACCEPT: "gobiz_auto_accept",
  GOBIZ_OAUTH_URL: "gobiz_oauth_url",
  GOBIZ_API_BASE_URL: "gobiz_api_base_url",
  QRIS_NMID: "qris_nmid",
  // Static QRIS self-order — gambar QRIS statis venue + saklar aktif
  // (lib/payments/static-qris.ts). Diatur di Settings → Payment Gateways.
  STATIC_QRIS_ENABLED: "static_qris_enabled",
  STATIC_QRIS_IMAGE_URL: "static_qris_image_url",
  // Penerima laporan tutup kasir via WA — JSON array nomor `628xx`, boleh
  // lebih dari satu. Terpisah dari recipients notifikasi owner (EPIC-020)
  // karena audiensnya beda: laporan shift sering ke supervisor/finance,
  // bukan (hanya) owner.
  POS_SHIFT_REPORT_WA_RECIPIENTS: "pos_shift_report_wa_recipients",
  // Instagram Messaging (EPIC-013 Fase C) — diisi Super Admin lewat UI.
  // Rahasia tidak pernah dikirim balik ke browser, hanya versi tersamar.
  IG_APP_SECRET: "ig_app_secret",
  IG_VERIFY_TOKEN: "ig_verify_token",
  IG_ACCESS_TOKEN: "ig_access_token",
  IG_ACCOUNT_ID: "ig_account_id",
} as const;

export const DEEPSEEK_DEFAULTS = {
  model: "deepseek-chat",
  baseUrl: "https://api.deepseek.com",
};

/** OpenAI dipakai utk kemampuan vision (mis. deskripsi gambar psikotes) —
 *  DeepSeek text-only, jadi bagian "melihat gambar" dialihkan ke sini. */
export const OPENAI_DEFAULTS = {
  model: "gpt-4o-mini",
  baseUrl: "https://api.openai.com/v1",
};

export async function getSetting(key: string): Promise<string | null> {
  const row = await queryOne<{ value: string | null }>(
    "SELECT value FROM configuration.app_settings WHERE key = $1",
    [key]
  );
  return row?.value ?? null;
}

export async function getSettings(keys: string[]): Promise<Record<string, string | null>> {
  const rows = await query<{ key: string; value: string | null }>(
    "SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)",
    [keys]
  );
  const map: Record<string, string | null> = {};
  for (const k of keys) map[k] = null;
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  await query(
    `INSERT INTO configuration.app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
}

/** Masker untuk menampilkan API key tanpa membocorkan isinya. */
export function maskSecret(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}
