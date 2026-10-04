/**
 * EPIC-050 T-4.3 — pengirim report terjadwal.
 * Tiap 15 menit: ambil jadwal aktif yang sudah jatuh tempo, jalankan report
 * milik pembuat jadwal, lalu kirim ringkasan lewat WA dan/atau notifikasi aplikasi.
 * Email menyusul di Fase 7.
 */
import { getPool, query, queryOne } from "@/lib/db";
import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import { notifyUsers } from "@/lib/crm/workflow-engine";
import { isValidNormalizedPhone, normalizePhone } from "@/lib/sales-funnel/server";
import {
  DATE_PRESET_LABELS,
  buildReportQuery,
  summarizeRows,
  type ReportDataset,
  type ReportDefinition,
} from "./report-builder";
import { parseStoredDefinition } from "./report-builder-server";
import { buildScheduleMessage, computeNextRun, type ScheduleRecipient } from "./report-schedule";

const CHECK_INTERVAL_MS = 15 * 60_000;
let started = false;

interface ScheduleJob {
  id: string;
  name: string;
  company_id: string | null;
  frequency: "daily" | "weekly" | "monthly";
  hour: number;
  day_of_week: number | null;
  day_of_month: number | null;
  channel: string;
  recipients: unknown;
  report_id: string;
  report_name: string;
  dataset: ReportDataset;
  definition: unknown;
  creator_role: string | null;
  creator_id: string | null;
}

const SELECT_JOB = `
  SELECT s.id, s.name, s.company_id, s.frequency, s.hour, s.day_of_week, s.day_of_month,
         s.channel, s.recipients, s.report_id,
         r.name AS report_name, r.dataset, r.definition,
         u.role AS creator_role, u.id AS creator_id
  FROM crm.crm_report_schedules s
  JOIN crm.crm_reports r ON r.id = s.report_id AND r.deleted_at IS NULL
  LEFT JOIN configuration.users u ON u.id = s.created_by`;

function parseRecipients(raw: unknown): ScheduleRecipient[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is ScheduleRecipient => {
    if (!r || typeof r !== "object") return false;
    const o = r as Record<string, unknown>;
    return (o.type === "user" && typeof o.user_id === "string") || (o.type === "number" && typeof o.number === "string");
  });
}

function periodLabel(def: ReportDefinition): string {
  if (def.date_preset === "custom") return `${def.date_from ?? "?"} s/d ${def.date_to ?? "?"}`;
  return DATE_PRESET_LABELS[def.date_preset];
}

export interface ScheduleRunResult {
  ok: boolean;
  sent: number;
  rowCount?: number;
  reason?: string;
}

/**
 * Jalankan satu jadwal. `advanceNextRun` false dipakai untuk kiriman uji coba
 * dari UI supaya jadwal rutin tidak bergeser.
 */
export async function runReportSchedule(
  scheduleId: string,
  { advanceNextRun = true }: { advanceNextRun?: boolean } = {}
): Promise<ScheduleRunResult> {
  const job = await queryOne<ScheduleJob>(`${SELECT_JOB} WHERE s.id = $1`, [scheduleId]);
  if (!job) return { ok: false, sent: 0, reason: "Jadwal tidak ditemukan" };

  const definition = parseStoredDefinition(job.dataset, job.definition);
  const built = buildReportQuery(definition, {
    companyId: job.company_id,
    // Jadwal dijalankan sebagai pembuatnya: role sales tetap hanya melihat miliknya.
    restrictOwnerUserId: job.creator_role === "sales" ? job.creator_id : null,
  });

  let rows: Array<Record<string, unknown>>;
  try {
    rows = await query<Record<string, unknown>>(built.sql, built.params);
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Query gagal";
    await markRun(scheduleId, "error", reason, advanceNextRun ? job : null);
    return { ok: false, sent: 0, reason };
  }

  const summary = summarizeRows(rows, built.columns);
  const message = buildScheduleMessage(job.report_name, summary, {
    rowCount: rows.length,
    periodLabel: periodLabel(definition),
    url: `/dashboard/crm/reports/builder?report=${job.report_id}`,
  });

  const recipients = parseRecipients(job.recipients);
  const userIds = recipients.filter((r) => r.type === "user").map((r) => (r as { user_id: string }).user_id);
  let sent = 0;

  if (job.channel === "in_app" || job.channel === "wa") {
    if (userIds.length > 0) {
      sent += await notifyUsers(
        userIds,
        `Laporan: ${job.report_name}`,
        `${rows.length} baris · ${periodLabel(definition)}`,
        `/dashboard/crm/reports/builder?report=${job.report_id}`,
        { schedule_id: job.id, report_id: job.report_id }
      );
    }
  }

  if (job.channel === "wa") {
    const config = await loadGatewayConfig();
    if (config) {
      const numbers = new Set<string>();
      for (const r of recipients) {
        if (r.type === "number") {
          const p = normalizePhone(r.number);
          if (isValidNormalizedPhone(p)) numbers.add(p);
        }
      }
      for (const uid of userIds) {
        const emp = await queryOne<{ phone: string | null }>(
          `SELECT phone FROM hris.employees WHERE user_id = $1 AND phone IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
          [uid]
        );
        const p = emp?.phone ? normalizePhone(emp.phone) : "";
        if (isValidNormalizedPhone(p)) numbers.add(p);
      }
      for (const target of numbers) {
        const res = await sendGatewayText(config, { target, message }).catch(() => ({ success: false }));
        if (res.success) sent += 1;
      }
    }
  }

  await markRun(scheduleId, "ok", null, advanceNextRun ? job : null);
  return { ok: true, sent, rowCount: rows.length };
}

async function markRun(
  id: string,
  status: "ok" | "error",
  error: string | null,
  advanceFrom: Pick<ScheduleJob, "frequency" | "hour" | "day_of_week" | "day_of_month"> | null
): Promise<void> {
  const next = advanceFrom ? computeNextRun(advanceFrom, new Date()) : null;
  await query(
    `UPDATE crm.crm_report_schedules
     SET last_run_at = now(), last_status = $2, last_error = $3,
         next_run_at = COALESCE($4::timestamptz, next_run_at), updated_at = now()
     WHERE id = $1`,
    [id, status, error?.slice(0, 500) ?? null, next]
  );
}

/** Jalankan semua jadwal yang jatuh tempo. Mengembalikan jumlah jadwal yang diproses. */
export async function runDueReportSchedules(): Promise<number> {
  const pool = getPool();
  // Klaim atomik: geser next_run_at dulu supaya instance lain tidak ikut mengirim.
  // Bila proses mati di tengah jalan, jadwal dicoba lagi satu jam kemudian.
  const due = await pool.query<{ id: string }>(
    `UPDATE crm.crm_report_schedules SET next_run_at = now() + interval '1 hour', updated_at = now()
     WHERE id IN (
       SELECT id FROM crm.crm_report_schedules
       WHERE is_active AND next_run_at IS NOT NULL AND next_run_at <= now()
       ORDER BY next_run_at
       LIMIT 20
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id`
  );
  let n = 0;
  for (const row of due.rows) {
    try {
      await runReportSchedule(row.id, { advanceNextRun: true });
      n += 1;
    } catch (e) {
      console.error("[report-schedule] gagal:", e);
    }
  }
  if (n > 0) console.log(`[report-schedule] ${n} laporan terjadwal dikirim`);
  return n;
}

export function startReportScheduleWatcher(): void {
  if (started) return;
  started = true;
  const tick = () => {
    runDueReportSchedules().catch((e) => console.error("[report-schedule] gagal:", e));
  };
  setTimeout(tick, 90_000);
  setInterval(tick, CHECK_INTERVAL_MS);
}
