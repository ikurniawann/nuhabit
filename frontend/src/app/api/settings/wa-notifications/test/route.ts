import { NextResponse } from "next/server";
import { brandOsName } from "@/lib/branding";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getSetting } from "@/lib/settings/app-settings";
import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import { WA_NOTIF_SETTING_KEY, parseWaNotifConfig } from "@/lib/wa/notifications-config";

/**
 * POST /api/settings/wa-notifications/test — kirim pesan uji ke semua nomor
 * penerima tersimpan. Membuktikan sambungan gateway + kebenaran nomor SEBELUM
 * owner mengandalkan notifikasi sungguhan.
 */

/** Mode flash: kirim Daily Flash Report SUNGGUHAN (default hari ini, atau `date` YYYY-MM-DD). */
async function flashReportMessage(date: string | undefined, now: string) {
  const { buildFlashReportMessage, gatherFlashReportData } = await import("@/lib/wa/flash-report");
  const { todayWib } = await import("@/lib/wa/notifications-messages");
  const dateWib = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayWib();
  const data = await gatherFlashReportData(dateWib);
  return `${buildFlashReportMessage(data, dateWib)}\n\n_(uji kirim manual ${now} WIB — data ${dateWib})_`;
}

export const POST = apiHandler(async (request: Request) => {
  await requireIamMenuPrefix(IAM.settingsIntegrations);

  const config = parseWaNotifConfig(await getSetting(WA_NOTIF_SETTING_KEY));
  if (config.recipients.length === 0) {
    throw ApiError.badRequest("Belum ada nomor penerima. Simpan nomornya dulu.");
  }

  // Sumber konfigurasi HARUS sama dengan notifikasi sungguhan (DB → ENV).
  const gateway = await loadGatewayConfig();
  if (!gateway) {
    throw ApiError.badRequest("WA Gateway belum dikonfigurasi (Settings → Integrasi atau WA_GATEWAY_URL/TOKEN)");
  }

  const body = (await request.json().catch(() => ({}))) as { flash?: boolean; date?: string };
  // Format medium tanggal + jam pendek khas pesan WA ("4 Okt 2026, 14.30").
  const now = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const message = body.flash
    ? await flashReportMessage(body.date, now)
    : `${brandOsName()} — pesan uji notifikasi.\nNomor ini akan menerima notifikasi bisnis otomatis.\n${now} WIB`;

  const results = [];
  for (const target of config.recipients) {
    const result = await sendGatewayText(gateway, { target, message });
    results.push({ target, success: result.success, reason: result.reason ?? null });
  }
  return NextResponse.json({ data: { results, allOk: results.every((r) => r.success) } });
}, "POST /api/settings/wa-notifications/test");
