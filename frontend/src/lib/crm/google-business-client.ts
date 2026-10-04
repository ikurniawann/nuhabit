/**
 * EPIC-013 Fase A — klien Google Business Profile API.
 *
 * Batas adaptor sengaja tipis: hanya menukar refresh token jadi access token,
 * menarik ulasan, dan mengirim balasan. Seluruh aturan bisnis ada di
 * `google-reviews.ts` (murni & teruji), sehingga bagian yang belum bisa
 * diverifikasi tanpa kredensial tinggal lapisan HTTP ini saja.
 *
 * Kredensial diisi belakangan lewat env; tanpa itu seluruh fungsi
 * mengembalikan status "belum dikonfigurasi" secara rapi, bukan melempar.
 */

import { SETTING_KEYS, getSettings } from "@/lib/settings/app-settings";
import { parseLocationIds, type GoogleReviewResource } from "./google-reviews";

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVIEWS_API_BASE = "https://mybusiness.googleapis.com/v4";

export interface GoogleBusinessConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** accounts/{accountId} */
  accountId: string;
  /**
   * locations/{locationId} — bisa lebih dari satu (multi-lokasi). Setting
   * `google_bp_location_id` menerima daftar dipisah koma.
   */
  locationIds: string[];
}

/**
 * Kredensial dibaca dari pengaturan aplikasi (diisi Super Admin lewat
 * halaman Settings). Env dipakai sebagai cadangan supaya deployment yang
 * terlanjur memakai .env tetap jalan — nilai di UI menang bila keduanya ada.
 */
export async function readGoogleBusinessConfig(): Promise<GoogleBusinessConfig | null> {
  const stored = await getSettings([
    SETTING_KEYS.GOOGLE_BP_CLIENT_ID,
    SETTING_KEYS.GOOGLE_BP_CLIENT_SECRET,
    SETTING_KEYS.GOOGLE_BP_REFRESH_TOKEN,
    SETTING_KEYS.GOOGLE_BP_ACCOUNT_ID,
    SETTING_KEYS.GOOGLE_BP_LOCATION_ID,
  ]).catch(() => ({}) as Record<string, string | null>);

  const pick = (key: string, envValue: string | undefined) =>
    stored[key]?.trim() || envValue?.trim() || "";

  const clientId = pick(SETTING_KEYS.GOOGLE_BP_CLIENT_ID, process.env.GOOGLE_BP_CLIENT_ID);
  const clientSecret = pick(SETTING_KEYS.GOOGLE_BP_CLIENT_SECRET, process.env.GOOGLE_BP_CLIENT_SECRET);
  const refreshToken = pick(SETTING_KEYS.GOOGLE_BP_REFRESH_TOKEN, process.env.GOOGLE_BP_REFRESH_TOKEN);
  const accountId = pick(SETTING_KEYS.GOOGLE_BP_ACCOUNT_ID, process.env.GOOGLE_BP_ACCOUNT_ID);
  const locationIds = parseLocationIds(
    pick(SETTING_KEYS.GOOGLE_BP_LOCATION_ID, process.env.GOOGLE_BP_LOCATION_ID)
  );

  if (!clientId || !clientSecret || !refreshToken || !accountId || locationIds.length === 0) {
    return null;
  }
  return { clientId, clientSecret, refreshToken, accountId, locationIds };
}

/** Access token di-cache di memori sampai mendekati kedaluwarsa. */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(config: GoogleBusinessConfig): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  try {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.access_token) {
      console.error(
        "[google-bp] Gagal menukar refresh token:",
        data?.error_description ?? data?.error ?? `HTTP ${response.status}`
      );
      return null;
    }

    cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    };
    return cachedToken.value;
  } catch (error) {
    console.error(
      "[google-bp] Gagal menukar refresh token:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

function reviewsPath(config: GoogleBusinessConfig, locationId: string): string {
  return `${REVIEWS_API_BASE}/${config.accountId}/${locationId}/reviews`;
}

export type GoogleResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string; notConfigured?: boolean };

/**
 * Tarik ulasan dari SEMUA lokasi terkonfigurasi (mengikuti halaman berikutnya
 * sampai habis atau batas aman per lokasi). Kegagalan satu lokasi tidak
 * menggagalkan lokasi lain — sinkronisasi baru dianggap gagal bila TIDAK ADA
 * lokasi yang berhasil ditarik sama sekali.
 */
export async function fetchReviews(
  maxPages = 5
): Promise<GoogleResult<GoogleReviewResource[]>> {
  const config = await readGoogleBusinessConfig();
  if (!config) {
    return { ok: false, reason: "Kredensial Google Business belum dikonfigurasi", notConfigured: true };
  }

  const token = await getAccessToken(config);
  if (!token) return { ok: false, reason: "Gagal mendapatkan access token Google" };

  const collected: GoogleReviewResource[] = [];
  const failures: string[] = [];
  let succeededLocations = 0;

  for (const locationId of config.locationIds) {
    let pageToken: string | undefined;
    try {
      for (let page = 0; page < maxPages; page += 1) {
        const url = new URL(reviewsPath(config, locationId));
        url.searchParams.set("pageSize", "50");
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(20_000),
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
        }

        collected.push(...((data?.reviews ?? []) as GoogleReviewResource[]));
        pageToken = data?.nextPageToken;
        if (!pageToken) break;
      }
      succeededLocations += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Gagal menarik ulasan";
      failures.push(`${locationId}: ${reason}`);
      console.warn(`[google-bp] Gagal menarik ulasan ${locationId}:`, reason);
    }
  }

  if (succeededLocations === 0 && failures.length > 0) {
    return { ok: false, reason: failures.join("; ") };
  }
  return { ok: true, data: collected };
}

/**
 * Kirim/perbarui balasan. Google hanya mengizinkan SATU balasan per ulasan —
 * memanggil ini lagi MENGGANTI balasan sebelumnya, bukan menambah.
 */
export async function putReviewReply(
  reviewName: string,
  comment: string
): Promise<GoogleResult<{ updateTime: string | null }>> {
  const config = await readGoogleBusinessConfig();
  if (!config) {
    return { ok: false, reason: "Kredensial Google Business belum dikonfigurasi", notConfigured: true };
  }

  const token = await getAccessToken(config);
  if (!token) return { ok: false, reason: "Gagal mendapatkan access token Google" };

  try {
    const response = await fetch(`${REVIEWS_API_BASE}/${reviewName}/reply`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ comment }),
      signal: AbortSignal.timeout(20_000),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, reason: data?.error?.message ?? `HTTP ${response.status}` };
    }

    return { ok: true, data: { updateTime: data?.updateTime ?? null } };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Gagal mengirim balasan",
    };
  }
}

/** Untuk halaman diagnosa: apakah integrasi siap dipakai. */
export async function googleBusinessStatus(): Promise<{
  configured: boolean;
  locationIds: string[];
}> {
  const config = await readGoogleBusinessConfig();
  return { configured: Boolean(config), locationIds: config?.locationIds ?? [] };
}

/** Token di-cache per proses; wajib dibuang saat kredensial diganti dari UI. */
export function resetGoogleTokenCache(): void {
  cachedToken = null;
}
