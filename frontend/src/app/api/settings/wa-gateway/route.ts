import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getGatewayStatus, invalidateGatewayConfigCache, loadGatewayConfig } from "@/lib/whatsapp";
import { SETTING_KEYS, getSettings, maskSecret, setSetting } from "@/lib/settings/app-settings";

/**
 * Proxy status & QR pairing gateway WhatsApp untuk halaman Settings.
 *
 * Kenapa proxy: gateway hanya mendengar di 127.0.0.1 dan ber-token — browser
 * tidak boleh (dan tidak bisa) memanggilnya langsung. Token tetap di server.
 *
 * HANYA super_admin: string QR adalah kredensial sesi WhatsApp — siapa pun
 * yang memindainya menjadikan nomor bisnis tertaut ke perangkatnya.
 */
const requireSuperAdmin = () => requireApiRole(["super_admin"]);

/** QR pairing dari gateway; null bila belum tersedia. */
async function fetchPairingQr(config: { baseUrl: string; token: string }): Promise<string | null> {
  try {
    const response = await fetch(`${config.baseUrl}/qr`, {
      headers: { "x-gateway-token": config.token },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const json = await response.json();
    return typeof json?.qr === "string" ? json.qr : null;
  } catch {
    return null;
  }
}

export const GET = apiHandler(async () => {
  await requireSuperAdmin();

  // Konfigurasi tersimpan (DB) — ditampilkan di form. Token hanya versi
  // tersamar: rahasia tidak pernah dikirim balik ke browser.
  const stored = await getSettings([SETTING_KEYS.WA_GATEWAY_URL, SETTING_KEYS.WA_GATEWAY_TOKEN]);
  const settings = {
    url: stored[SETTING_KEYS.WA_GATEWAY_URL] ?? "",
    token_masked: maskSecret(stored[SETTING_KEYS.WA_GATEWAY_TOKEN]),
    token_from_env: !stored[SETTING_KEYS.WA_GATEWAY_TOKEN] && Boolean(process.env.WA_GATEWAY_TOKEN),
  };

  const config = await loadGatewayConfig();
  if (!config) {
    return NextResponse.json({ success: true, data: { configured: false, status: null, qr: null, settings } });
  }
  const status = await getGatewayStatus(config);
  if (!status) {
    return NextResponse.json({
      success: true,
      data: { configured: true, reachable: false, status: null, qr: null, settings },
    });
  }
  const qr = status.connected ? null : await fetchPairingQr(config);
  return NextResponse.json({ success: true, data: { configured: true, reachable: true, status, qr, settings } });
}, "GET /api/settings/wa-gateway");

const updateSchema = z.object({
  url: z.string().trim().max(300).optional(),
  token: z.string().trim().max(300).optional(),
});

/**
 * Simpan konfigurasi gateway ke configuration.app_settings.
 *
 * Token yang DIKOSONGKAN saat submit berarti "biarkan nilai lama" — bukan
 * "hapus" — supaya form bisa disimpan ulang tanpa mengetik ulang rahasia.
 * URL kosong = kembali ke default/ENV.
 */
export const PATCH = apiHandler(async (request: NextRequest) => {
  await requireSuperAdmin();
  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw ApiError.badRequest("Payload tidak valid");
  const { url, token } = parsed.data;

  if (url !== undefined) {
    if (url && !/^https?:\/\//.test(url)) throw ApiError.badRequest("URL harus diawali http:// atau https://");
    await setSetting(SETTING_KEYS.WA_GATEWAY_URL, url || null);
  }
  if (token) await setSetting(SETTING_KEYS.WA_GATEWAY_TOKEN, token);

  // Cache config di-flush supaya nilai baru langsung terpakai — tanpa ini,
  // tombol "Cek koneksi" masih memakai config lama sampai 30 detik.
  invalidateGatewayConfigCache();
  const config = await loadGatewayConfig();
  const status = config ? await getGatewayStatus(config) : null;
  return NextResponse.json({ success: true, data: { configured: Boolean(config), reachable: Boolean(status), status } });
}, "PATCH /api/settings/wa-gateway");
