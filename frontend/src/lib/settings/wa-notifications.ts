import { ApiError } from "@/lib/api/auth";
import {
  MAX_RECIPIENTS,
  WA_NOTIF_TYPES,
  normalizeWaRecipient,
  type WaNotifConfig,
  type WaNotifType,
} from "@/lib/wa/notifications-config";

const MAX_SHIFT_REPORT_RECIPIENTS = 10;

function cleanOwnerRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) throw ApiError.badRequest("recipients tidak valid");
  const cleaned: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const n = normalizeWaRecipient(raw);
    if (!n) throw ApiError.badRequest(`Nomor tidak valid: ${raw}. Pakai format 08… atau 62…`);
    if (!cleaned.includes(n)) cleaned.push(n);
  }
  if (cleaned.length > MAX_RECIPIENTS) throw ApiError.badRequest(`Maksimal ${MAX_RECIPIENTS} nomor penerima`);
  return cleaned;
}

/**
 * Penerima laporan tutup kasir: validasi longgar (digit/+ minimal 9, unik, maks 10).
 * Normalisasi ketat (08xx→628xx) terjadi di sisi pengirim, jadi nilai lama yang
 * formatnya beda tidak membuat penyimpanan gagal.
 */
export function cleanShiftReportRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) throw ApiError.badRequest("shift_report_recipients tidak valid");
  return [
    ...new Set(value.map((v) => String(v).replace(/[^0-9+]/g, "")).filter((v) => v.length >= 9)),
  ].slice(0, MAX_SHIFT_REPORT_RECIPIENTS);
}

/** Terapkan PUT parsial ke config tersimpan (tidak memutasi `current`); 400 per field tidak valid. */
export function applyWaNotifUpdate(current: WaNotifConfig, body: Record<string, unknown>): WaNotifConfig {
  const next: WaNotifConfig = { ...current, types: { ...current.types } };

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") throw ApiError.badRequest("enabled tidak valid");
    next.enabled = body.enabled;
  }
  if (body.recipients !== undefined) next.recipients = cleanOwnerRecipients(body.recipients);
  if (body.types !== undefined) {
    if (!body.types || typeof body.types !== "object") throw ApiError.badRequest("types tidak valid");
    for (const meta of WA_NOTIF_TYPES) {
      const v = (body.types as Record<WaNotifType, unknown>)[meta.key];
      if (typeof v === "boolean") next.types[meta.key] = v;
    }
  }
  if (body.voidThresholdRp !== undefined) {
    const n = Number(body.voidThresholdRp);
    if (!Number.isFinite(n) || n < 0) throw ApiError.badRequest("Ambang void tidak valid");
    next.voidThresholdRp = Math.round(n);
  }
  if (body.digestHour !== undefined) {
    const n = Number(body.digestHour);
    if (!Number.isInteger(n) || n < 0 || n > 23) throw ApiError.badRequest("Jam ringkasan harus 0-23 (WIB)");
    next.digestHour = n;
  }
  if (body.omzetAnjlokPct !== undefined) {
    const n = Number(body.omzetAnjlokPct);
    if (!Number.isInteger(n) || n < 1 || n > 99) {
      throw ApiError.badRequest("Ambang omzet harus 1-99 (persen dari baseline)");
    }
    next.omzetAnjlokPct = n;
  }
  return next;
}

/** Nilai JSON tersimpan → daftar nomor; nilai korup dianggap kosong. */
export function parseShiftReportRecipients(raw: string | null): string[] {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
