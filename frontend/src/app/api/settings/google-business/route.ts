import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  SETTING_KEYS,
  getSettings,
  maskSecret,
  setSetting,
} from "@/lib/settings/app-settings";
import { resetGoogleTokenCache } from "@/lib/crm/google-business-client";
import { parseLocationIds } from "@/lib/crm/google-reviews";

/**
 * EPIC-013 Fase A — kredensial Google Business Profile, diisi dari UI.
 *
 * Aturan keras: **rahasia tidak pernah dikirim balik ke browser**. GET hanya
 * mengembalikan penanda "sudah terisi" dan versi tersamar; field yang
 * dikosongkan saat menyimpan berarti "biarkan nilai lama", bukan "hapus".
 */

const SECRET_KEYS = [
  SETTING_KEYS.GOOGLE_BP_CLIENT_SECRET,
  SETTING_KEYS.GOOGLE_BP_REFRESH_TOKEN,
] as const;

const updateSchema = z.object({
  client_id: z.string().trim().max(300).optional(),
  client_secret: z.string().trim().max(300).optional(),
  refresh_token: z.string().trim().max(600).optional(),
  account_id: z.string().trim().max(200).optional(),
  // Bisa memuat BANYAK lokasi dipisah koma (multi-lokasi EPIC-013).
  location_id: z.string().trim().max(1000).optional(),
});

const requireSuperAdmin = () => requireApiRole(["super_admin"]);

/** Normalisasi: terima "accounts/123" maupun "123". */
function withPrefix(value: string, prefix: "accounts" | "locations"): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "";
  return trimmed.startsWith(`${prefix}/`) ? trimmed : `${prefix}/${trimmed}`;
}

export const GET = apiHandler(async () => {
  await requireSuperAdmin();
  const stored = await getSettings([
    SETTING_KEYS.GOOGLE_BP_CLIENT_ID,
    SETTING_KEYS.GOOGLE_BP_CLIENT_SECRET,
    SETTING_KEYS.GOOGLE_BP_REFRESH_TOKEN,
    SETTING_KEYS.GOOGLE_BP_ACCOUNT_ID,
    SETTING_KEYS.GOOGLE_BP_LOCATION_ID,
  ]);

  const clientId = stored[SETTING_KEYS.GOOGLE_BP_CLIENT_ID] ?? "";
  const accountId = stored[SETTING_KEYS.GOOGLE_BP_ACCOUNT_ID] ?? "";
  const locationId = stored[SETTING_KEYS.GOOGLE_BP_LOCATION_ID] ?? "";

  return NextResponse.json({
    success: true,
    data: {
      // Nilai non-rahasia boleh tampil utuh agar mudah diperiksa.
      client_id: clientId,
      account_id: accountId,
      location_id: locationId,
      // Rahasia: hanya penanda + samaran.
      has_client_secret: Boolean(stored[SETTING_KEYS.GOOGLE_BP_CLIENT_SECRET]),
      client_secret_masked: maskSecret(
        stored[SETTING_KEYS.GOOGLE_BP_CLIENT_SECRET],
      ),
      has_refresh_token: Boolean(stored[SETTING_KEYS.GOOGLE_BP_REFRESH_TOKEN]),
      refresh_token_masked: maskSecret(
        stored[SETTING_KEYS.GOOGLE_BP_REFRESH_TOKEN],
      ),
      configured: Boolean(
        clientId &&
        accountId &&
        locationId &&
        stored[SETTING_KEYS.GOOGLE_BP_CLIENT_SECRET] &&
        stored[SETTING_KEYS.GOOGLE_BP_REFRESH_TOKEN],
      ),
    },
  });
}, "GET /api/settings/google-business");

export const PUT = apiHandler(async (request: NextRequest) => {
  await requireSuperAdmin();
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) throw ApiError.badRequest("Payload tidak valid");
  const payload = parsed.data;

  const updates: [string, string][] = [];
  if (payload.client_id !== undefined) {
    updates.push([SETTING_KEYS.GOOGLE_BP_CLIENT_ID, payload.client_id]);
  }
  if (payload.account_id !== undefined) {
    updates.push([
      SETTING_KEYS.GOOGLE_BP_ACCOUNT_ID,
      withPrefix(payload.account_id, "accounts"),
    ]);
  }
  if (payload.location_id !== undefined) {
    // Multi-lokasi: tiap entri dinormalkan ke `locations/{id}` lalu
    // disimpan sebagai daftar dipisah koma — nilai lama satu lokasi tetap sah.
    updates.push([
      SETTING_KEYS.GOOGLE_BP_LOCATION_ID,
      parseLocationIds(payload.location_id).join(","),
    ]);
  }
  // Rahasia hanya ditulis bila benar-benar diisi — field kosong berarti
  // "jangan ubah", supaya menyimpan perubahan lain tidak menghapus token.
  if (payload.client_secret) {
    updates.push([SETTING_KEYS.GOOGLE_BP_CLIENT_SECRET, payload.client_secret]);
  }
  if (payload.refresh_token) {
    updates.push([SETTING_KEYS.GOOGLE_BP_REFRESH_TOKEN, payload.refresh_token]);
  }

  for (const [key, value] of updates) {
    await setSetting(key, value || null);
  }

  // Kredensial berubah → token lama tidak boleh dipakai lagi.
  resetGoogleTokenCache();

  return NextResponse.json({ success: true });
}, "PUT /api/settings/google-business");

/** Hapus seluruh kredensial (mis. saat berpindah akun/lokasi). */
export const DELETE = apiHandler(async () => {
  await requireSuperAdmin();

  for (const key of [
    SETTING_KEYS.GOOGLE_BP_CLIENT_ID,
    SETTING_KEYS.GOOGLE_BP_ACCOUNT_ID,
    SETTING_KEYS.GOOGLE_BP_LOCATION_ID,
    ...SECRET_KEYS,
  ]) {
    await setSetting(key, null);
  }
  resetGoogleTokenCache();

  return NextResponse.json({ success: true });
}, "DELETE /api/settings/google-business");
