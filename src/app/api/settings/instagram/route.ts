import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { SETTING_KEYS, getSettings, maskSecret, setSetting } from "@/lib/settings/app-settings";

/**
 * EPIC-013 Fase C — kredensial Instagram Messaging, diisi dari UI.
 *
 * Mengikuti aturan yang sama seperti Google Business Profile: **rahasia tidak
 * pernah dikirim balik ke browser**. GET hanya mengembalikan penanda "sudah
 * terisi" dan versi tersamar; field rahasia yang dikosongkan saat menyimpan
 * berarti "biarkan nilai lama", bukan "hapus".
 */

const SECRET_KEYS = [SETTING_KEYS.IG_APP_SECRET, SETTING_KEYS.IG_ACCESS_TOKEN] as const;

const updateSchema = z.object({
  app_secret: z.string().trim().max(300).optional(),
  verify_token: z.string().trim().max(300).optional(),
  access_token: z.string().trim().max(1000).optional(),
  account_id: z.string().trim().max(200).optional(),
});

// Kredensial akun Meta: hanya super_admin (belum ada menu IAM khusus).
const requireSuperAdmin = () => requireApiRole(["super_admin"]);

export const GET = apiHandler(async () => {
  await requireSuperAdmin();
  const stored = await getSettings([
    SETTING_KEYS.IG_APP_SECRET,
    SETTING_KEYS.IG_VERIFY_TOKEN,
    SETTING_KEYS.IG_ACCESS_TOKEN,
    SETTING_KEYS.IG_ACCOUNT_ID,
  ]);

  const verifyToken = stored[SETTING_KEYS.IG_VERIFY_TOKEN] ?? "";
  const accountId = stored[SETTING_KEYS.IG_ACCOUNT_ID] ?? "";
  const appSecret = stored[SETTING_KEYS.IG_APP_SECRET];
  const accessToken = stored[SETTING_KEYS.IG_ACCESS_TOKEN];

  return NextResponse.json({
    success: true,
    data: {
      // Verify token bukan rahasia sesungguhnya — kita sendiri yang
      // menentukannya, dan harus disalin persis ke dashboard Meta.
      verify_token: verifyToken,
      account_id: accountId,
      has_app_secret: Boolean(appSecret),
      app_secret_masked: maskSecret(appSecret),
      has_access_token: Boolean(accessToken),
      access_token_masked: maskSecret(accessToken),
      // Webhook sudah bisa MENERIMA pesan begitu dua nilai ini terisi,
      // walau token pengirim belum ada.
      webhook_ready: Boolean(appSecret && verifyToken),
      configured: Boolean(appSecret && verifyToken && accessToken && accountId),
    },
  });
}, "GET /api/settings/instagram");

export const PUT = apiHandler(async (request: NextRequest) => {
  await requireSuperAdmin();
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) throw ApiError.badRequest("Payload tidak valid");
  const payload = parsed.data;

  const updates: [string, string][] = [];
  if (payload.verify_token !== undefined) updates.push([SETTING_KEYS.IG_VERIFY_TOKEN, payload.verify_token]);
  if (payload.account_id !== undefined) updates.push([SETTING_KEYS.IG_ACCOUNT_ID, payload.account_id]);
  // Rahasia hanya ditulis bila benar-benar diisi — field kosong berarti
  // "jangan ubah", supaya menyimpan perubahan lain tidak menghapus token.
  if (payload.app_secret) updates.push([SETTING_KEYS.IG_APP_SECRET, payload.app_secret]);
  if (payload.access_token) updates.push([SETTING_KEYS.IG_ACCESS_TOKEN, payload.access_token]);

  for (const [key, value] of updates) await setSetting(key, value || null);
  return NextResponse.json({ success: true });
}, "PUT /api/settings/instagram");

/** Hapus seluruh kredensial (mis. saat berpindah akun Instagram). */
export const DELETE = apiHandler(async () => {
  await requireSuperAdmin();
  for (const key of [SETTING_KEYS.IG_VERIFY_TOKEN, SETTING_KEYS.IG_ACCOUNT_ID, ...SECRET_KEYS]) {
    await setSetting(key, null);
  }
  return NextResponse.json({ success: true });
}, "DELETE /api/settings/instagram");
