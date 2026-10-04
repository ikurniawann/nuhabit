import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { SETTING_KEYS, getSetting, setSetting } from "@/lib/settings/app-settings";
import {
  applyWaNotifUpdate,
  cleanShiftReportRecipients,
  parseShiftReportRecipients,
} from "@/lib/settings/wa-notifications";
import { WA_NOTIF_SETTING_KEY, WA_NOTIF_TYPES, parseWaNotifConfig } from "@/lib/wa/notifications-config";

/**
 * GET/PUT /api/settings/wa-notifications — konfigurasi notifikasi WA owner
 * (EPIC-020): jenis mana yang aktif + nomor penerima + ambang void.
 * Penerima laporan tutup kasir disimpan terpisah: audiensnya beda
 * (supervisor/finance), tapi diatur di halaman sama.
 */

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.settingsIntegrations);
  const config = parseWaNotifConfig(await getSetting(WA_NOTIF_SETTING_KEY));
  const shiftReportRecipients = parseShiftReportRecipients(
    await getSetting(SETTING_KEYS.POS_SHIFT_REPORT_WA_RECIPIENTS)
  );
  return NextResponse.json({
    data: { config, catalog: WA_NOTIF_TYPES, shift_report_recipients: shiftReportRecipients },
  });
}, "GET /api/settings/wa-notifications");

export const PUT = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.settingsIntegrations);
  const body = ((await request.json()) ?? {}) as Record<string, unknown>;
  // Mulai dari yang tersimpan supaya PUT parsial tidak menghapus field lain.
  const config = applyWaNotifUpdate(parseWaNotifConfig(await getSetting(WA_NOTIF_SETTING_KEY)), body);

  if (body.shift_report_recipients !== undefined) {
    const cleaned = cleanShiftReportRecipients(body.shift_report_recipients);
    await setSetting(SETTING_KEYS.POS_SHIFT_REPORT_WA_RECIPIENTS, cleaned.length > 0 ? JSON.stringify(cleaned) : null);
  }
  await setSetting(WA_NOTIF_SETTING_KEY, JSON.stringify(config));
  return NextResponse.json({ data: { config } });
}, "PUT /api/settings/wa-notifications");
