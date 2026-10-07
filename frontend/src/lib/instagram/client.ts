import { SETTING_KEYS, getSettings } from "@/lib/settings/app-settings";

/**
 * EPIC-013 Fase C — klien Instagram Messaging (Meta Graph API).
 *
 * Mengikuti pola Google Business Profile: kredensial diisi Super Admin lewat
 * halaman Settings, env hanya cadangan, dan tanpa kredensial seluruh fungsi
 * mengembalikan status "belum dikonfigurasi" secara rapi — bukan crash.
 */

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface InstagramConfig {
  /** App Secret — dipakai memverifikasi tanda tangan webhook. */
  appSecret: string;
  /** Token bebas yang kita tentukan sendiri saat mendaftarkan webhook. */
  verifyToken: string;
  /** Page/User Access Token berizin instagram_manage_messages. */
  accessToken: string;
  /** ID akun Instagram bisnis, dipakai sebagai pengirim. */
  accountId: string;
}

/**
 * Kredensial dibaca dari pengaturan aplikasi; env dipakai sebagai cadangan
 * agar deployment yang terlanjur memakai .env tetap jalan — nilai di UI
 * menang bila keduanya ada.
 */
export async function readInstagramConfig(): Promise<InstagramConfig | null> {
  const stored = await getSettings([
    SETTING_KEYS.IG_APP_SECRET,
    SETTING_KEYS.IG_VERIFY_TOKEN,
    SETTING_KEYS.IG_ACCESS_TOKEN,
    SETTING_KEYS.IG_ACCOUNT_ID,
  ]).catch(() => ({}) as Record<string, string | null>);

  const pick = (key: string, envValue: string | undefined) =>
    stored[key]?.trim() || envValue?.trim() || "";

  const appSecret = pick(SETTING_KEYS.IG_APP_SECRET, process.env.IG_APP_SECRET);
  const verifyToken = pick(SETTING_KEYS.IG_VERIFY_TOKEN, process.env.IG_VERIFY_TOKEN);
  const accessToken = pick(SETTING_KEYS.IG_ACCESS_TOKEN, process.env.IG_ACCESS_TOKEN);
  const accountId = pick(SETTING_KEYS.IG_ACCOUNT_ID, process.env.IG_ACCOUNT_ID);

  if (!appSecret || !verifyToken || !accessToken || !accountId) return null;
  return { appSecret, verifyToken, accessToken, accountId };
}

/**
 * Konfigurasi minimal untuk melayani webhook.
 *
 * Sengaja terpisah dari `readInstagramConfig`: webhook hanya butuh App Secret
 * dan Verify Token, sehingga pesan sudah bisa DITERIMA sebelum token pengirim
 * tersedia. Menuntut kredensial lengkap di sini akan menolak pesan masuk
 * tanpa alasan yang sebenarnya.
 */
export async function readInstagramWebhookConfig(): Promise<
  { appSecret: string; verifyToken: string } | null
> {
  const stored = await getSettings([
    SETTING_KEYS.IG_APP_SECRET,
    SETTING_KEYS.IG_VERIFY_TOKEN,
  ]).catch(() => ({}) as Record<string, string | null>);

  const appSecret =
    stored[SETTING_KEYS.IG_APP_SECRET]?.trim() || process.env.IG_APP_SECRET?.trim() || "";
  const verifyToken =
    stored[SETTING_KEYS.IG_VERIFY_TOKEN]?.trim() || process.env.IG_VERIFY_TOKEN?.trim() || "";

  if (!appSecret || !verifyToken) return null;
  return { appSecret, verifyToken };
}

export type InstagramSendResult =
  | { success: true; messageId: string | null }
  | { success: false; reason: string; notConfigured?: boolean };

/**
 * Kirim pesan teks ke satu IGSID.
 *
 * Kegagalan dikembalikan sebagai nilai, bukan lemparan, agar pemanggil bisa
 * menampilkan alasannya kepada agent. Pesan galat Meta ikut diteruskan karena
 * biasanya menjelaskan sebab sesungguhnya — mis. jendela 24 jam terlewat atau
 * izin token kurang.
 */
export async function sendInstagramText(
  recipientId: string,
  message: string
): Promise<InstagramSendResult> {
  const config = await readInstagramConfig();
  if (!config) {
    return {
      success: false,
      notConfigured: true,
      reason: "Instagram belum dikonfigurasi — lengkapi kredensial di Settings.",
    };
  }

  try {
    const response = await fetch(`${GRAPH_BASE}/${config.accountId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message },
      }),
    });

    const json = (await response.json().catch(() => null)) as
      | { message_id?: string; error?: { message?: string } }
      | null;

    if (!response.ok) {
      return {
        success: false,
        reason: json?.error?.message ?? `Instagram menolak permintaan (HTTP ${response.status})`,
      };
    }

    return { success: true, messageId: json?.message_id ?? null };
  } catch (error) {
    return {
      success: false,
      reason: error instanceof Error ? error.message : "Gagal menghubungi Instagram",
    };
  }
}
