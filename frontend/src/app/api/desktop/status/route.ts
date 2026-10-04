import { NextResponse } from "next/server";
import { ApiError, requireApiUser } from "@/lib/api/auth";
import { getPool } from "@/lib/db";
import { getSetting } from "@/lib/settings/app-settings";
import { SETTING_KEYS } from "@/lib/settings/app-settings";
import { printQueueLevel, rollupStatus, type StatusItem } from "@/lib/desktop/status";

/**
 * Status operasional untuk lampu di menubar desktop: database, antrian
 * cetak, dan WhatsApp gateway. Sengaja murah & bertoleransi — satu
 * pemeriksaan gagal ditandai "belum diketahui", bukan menggagalkan semua.
 */
export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 2_500;

async function checkDatabase(): Promise<StatusItem> {
  try {
    await getPool().query("SELECT 1");
    return { key: "db", label: "Database", level: "ok" };
  } catch {
    return { key: "db", label: "Database", level: "down", detail: "Tidak bisa dihubungi" };
  }
}

async function checkPrintQueue(): Promise<StatusItem> {
  try {
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS pending,
              COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at))) / 60, 0)::int AS oldest_minutes
         FROM pos.pos_print_jobs
        WHERE status IN ('pending', 'queued', 'printing')`
    );
    const pending = Number(rows[0]?.pending ?? 0);
    const oldest = pending > 0 ? Number(rows[0]?.oldest_minutes ?? 0) : null;
    return {
      key: "print",
      label: "Antrian cetak",
      level: printQueueLevel(pending, oldest),
      detail: pending === 0 ? "Kosong" : `${pending} job, tertua ${oldest ?? 0} menit`,
    };
  } catch {
    return { key: "print", label: "Antrian cetak", level: "unknown", detail: "Tidak terbaca" };
  }
}

async function checkWhatsApp(): Promise<StatusItem> {
  const baseUrl = (await getSetting(SETTING_KEYS.WA_GATEWAY_URL))?.replace(/\/+$/, "");
  if (!baseUrl) {
    return { key: "wa", label: "WhatsApp", level: "unknown", detail: "Belum dikonfigurasi" };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`${baseUrl}/status`, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) {
      return { key: "wa", label: "WhatsApp", level: "warn", detail: `Gateway menjawab ${res.status}` };
    }
    const json = (await res.json().catch(() => null)) as { connected?: boolean; state?: string } | null;
    const connected = json?.connected === true || json?.state === "connected";
    return {
      key: "wa",
      label: "WhatsApp",
      level: connected ? "ok" : "warn",
      detail: connected ? "Terhubung" : "Gateway hidup, sesi belum terhubung",
    };
  } catch {
    return { key: "wa", label: "WhatsApp", level: "down", detail: "Gateway tidak menjawab" };
  }
}

export async function GET() {
  try {
    await requireApiUser();
    const items = await Promise.all([checkDatabase(), checkPrintQueue(), checkWhatsApp()]);
    return NextResponse.json({ success: true, data: { items, level: rollupStatus(items) } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[desktop/status] gagal:", error);
    return NextResponse.json({ success: false, error: "Gagal memuat status" }, { status: 500 });
  }
}
