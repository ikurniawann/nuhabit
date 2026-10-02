import { query, queryOne } from "@/lib/db";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { completePastSessions, loadSettings } from "@/lib/studio/booking-server";
import {
  addDays,
  DEFAULT_JOB_SETTINGS,
  dedupKey,
  inSendWindow,
  JOB_SETTING_KEYS,
  type JobSettings,
  passExpiringMessage,
  passLowMessage,
  scheduledRemindersDue,
  sessionReminderMessage,
  waitlistPromotedMessage,
  wibNow,
} from "@/lib/studio/jobs";
import { expireDuePasses, normalizeMemberPhone, PASS_SELECT, PASS_USAGE_JOIN, type PassRow } from "@/lib/studio/pass-server";
import { remainingCredits } from "@/lib/studio/pass";
import { awardStreaks } from "@/lib/studio/loyalty-server";

/**
 * Job harian & pengingat WhatsApp (EPIC-058). Dipanggil berkala oleh watcher
 * (instrumentation.ts) dan manual dari halaman Otomasi & Pengingat.
 */

export interface Venue {
  companyId: string;
  branchId: string;
}

/** Venue yang punya data studio (sekarang satu venue; siap multi-branch). */
export async function studioVenues(): Promise<Venue[]> {
  return query<Venue>(
    `SELECT DISTINCT company_id AS "companyId", branch_id AS "branchId" FROM studio.programs WHERE is_active`
  );
}

export async function loadJobSettings(branchId: string): Promise<JobSettings> {
  const rows = await query<{ key: string; value: unknown }>(
    `SELECT key, value FROM studio.settings WHERE branch_id = $1 AND key LIKE 'job\\_%'`,
    [branchId]
  );
  const out: JobSettings = { ...DEFAULT_JOB_SETTINGS };
  for (const [field, key] of Object.entries(JOB_SETTING_KEYS) as [keyof JobSettings, string][]) {
    const r = rows.find((x) => x.key === key);
    if (r) (out as unknown as Record<string, unknown>)[field] = r.value;
  }
  return out;
}

export async function saveJobSettings(branchId: string, patch: Partial<JobSettings>, userId: string) {
  for (const [field, value] of Object.entries(patch) as [keyof JobSettings, unknown][]) {
    if (value === undefined) continue;
    await query(
      `INSERT INTO studio.settings (branch_id, key, value, updated_by) VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (branch_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [branchId, JOB_SETTING_KEYS[field], JSON.stringify(value), userId]
    );
  }
  return loadJobSettings(branchId);
}

// ── Pencatatan run ─────────────────────────────────────────────────────────

/** Klaim run. Untuk auto: unik per (venue, job, tanggal) → null bila sudah ada. */
async function startRun(v: Venue, job: "daily_close" | "reminders", trigger: "auto" | "manual", userId: string | null): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO studio.job_runs (company_id, branch_id, job_code, run_date, trigger, started_by)
     VALUES ($1, $2, $3, (now() AT TIME ZONE 'Asia/Jakarta')::date, $4, $5)
     ON CONFLICT DO NOTHING RETURNING id`,
    [v.companyId, v.branchId, job, trigger, userId]
  );
  return row?.id ?? null;
}

async function finishRun(id: string, status: "success" | "failed", summary: Record<string, unknown>, error?: string) {
  await query(`UPDATE studio.job_runs SET status = $2, summary = $3::jsonb, error = $4, finished_at = now() WHERE id = $1`, [
    id,
    status,
    JSON.stringify(summary),
    error ?? null,
  ]);
}

// ── Tutup hari ─────────────────────────────────────────────────────────────

export interface DailyCloseSummary {
  sessions_completed: number;
  passes_expired: number;
  breakage_recognized: number;
  orders_expired: number;
  /** Bonus streak XP yang diberikan (EPIC-066). */
  streak_bonus: number;
}

/**
 * Selesaikan semua sesi lewat (no-show diakui), kedaluwarsakan pass, tutup
 * pesanan online kedaluwarsa. Setiap langkah idempoten; run gagal dicatat.
 */
export async function runDailyClose(v: Venue, trigger: "auto" | "manual", userId: string | null = null): Promise<{ ran: boolean; summary?: DailyCloseSummary; error?: string }> {
  const runId = await startRun(v, "daily_close", trigger, userId);
  if (!runId) return { ran: false };
  const summary: DailyCloseSummary = { sessions_completed: 0, passes_expired: 0, breakage_recognized: 0, orders_expired: 0, streak_bonus: 0 };
  try {
    const actor = { companyId: v.companyId, branchId: v.branchId, actorId: userId, staff: true };
    for (let i = 0; i < 25; i++) {
      const n = await completePastSessions(actor);
      summary.sessions_completed += n;
      if (n < 200) break;
    }
    const streak = await awardStreaks(v, wibNow().date);
    summary.streak_bonus = streak.weekly + streak.fourWeek;
    const exp = await expireDuePasses({ companyId: v.companyId, branchId: v.branchId, user: { id: userId } });
    summary.passes_expired = exp.expired;
    summary.breakage_recognized = exp.recognized;
    const orders = await query(
      `UPDATE studio.pass_orders SET status = 'expired', updated_at = now()
       WHERE branch_id = $1 AND status = 'pending' AND expires_at < now() RETURNING id`,
      [v.branchId]
    );
    summary.orders_expired = orders.length;
    await finishRun(runId, "success", summary as unknown as Record<string, unknown>);
    return { ran: true, summary };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[studio-jobs] tutup hari gagal:", e);
    await finishRun(runId, "failed", summary as unknown as Record<string, unknown>, message);
    return { ran: true, summary, error: message };
  }
}

export async function lastAutoRunDate(branchId: string, job: "daily_close" | "reminders"): Promise<string | null> {
  const row = await queryOne<{ d: string }>(
    `SELECT max(run_date)::text AS d FROM studio.job_runs WHERE branch_id = $1 AND job_code = $2 AND trigger = 'auto'`,
    [branchId, job]
  );
  return row?.d ?? null;
}

// ── Pengingat WhatsApp ─────────────────────────────────────────────────────

interface Candidate {
  customerId: string;
  phone: string | null;
  kind: "session_reminder" | "waitlist_promoted" | "pass_low" | "pass_expiring";
  key: string;
  message: string;
}

export interface ReminderSummary {
  session_reminder: number;
  waitlist_promoted: number;
  pass_low: number;
  pass_expiring: number;
  sent: number;
  failed: number;
  skipped: number;
}

const MAX_PER_TICK = 60;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Member yang mematikan pengingat di Member App tidak dikirimi. */
const OPTED_IN = `NOT EXISTS (SELECT 1 FROM studio.member_prefs mp2 WHERE mp2.customer_id = c.id AND mp2.wa_reminders = false)`;

async function waitlistCandidates(branchId: string): Promise<Candidate[]> {
  const rows = await query<{ id: string; customer_id: string; name: string | null; phone: string | null; program: string; session_date: string; start_time: string }>(
    `SELECT b.id, b.customer_id, c.name, c.phone, p.name AS program, s.session_date::text AS session_date, to_char(s.start_time,'HH24:MI') AS start_time
     FROM studio.bookings b
     JOIN studio.class_sessions s ON s.id = b.session_id
     JOIN studio.programs p ON p.id = s.program_id
     JOIN pos.pos_customers c ON c.id = b.customer_id
     WHERE b.branch_id = $1 AND b.status = 'booked' AND b.promoted_at > now() - interval '24 hours'
       AND (s.session_date + s.start_time) > (now() AT TIME ZONE 'Asia/Jakarta') AND ${OPTED_IN}`,
    [branchId]
  );
  return rows.map((r) => ({
    customerId: r.customer_id,
    phone: r.phone,
    kind: "waitlist_promoted",
    key: dedupKey.waitlist(r.id),
    message: waitlistPromotedMessage({ name: r.name, program: r.program, date: r.session_date, time: r.start_time }),
  }));
}

async function sessionCandidates(branchId: string, tomorrow: string, cancelWindowHours: number): Promise<Candidate[]> {
  const rows = await query<{ id: string; customer_id: string; name: string | null; phone: string | null; program: string; kind: "class" | "pt"; start_time: string; coach: string | null }>(
    `SELECT b.id, b.customer_id, c.name, c.phone, p.name AS program, p.kind, to_char(s.start_time,'HH24:MI') AS start_time,
            COALESCE(co.display_name, co.full_name) AS coach
     FROM studio.bookings b
     JOIN studio.class_sessions s ON s.id = b.session_id AND s.status = 'scheduled'
     JOIN studio.programs p ON p.id = s.program_id
     LEFT JOIN studio.coaches co ON co.id = s.coach_id
     JOIN pos.pos_customers c ON c.id = b.customer_id
     WHERE b.branch_id = $1 AND b.status = 'booked' AND s.session_date = $2::date AND ${OPTED_IN}
       -- Sudah dikabari "naik dari waitlist" untuk booking ini → tidak perlu H-1 lagi.
       AND NOT EXISTS (SELECT 1 FROM studio.member_notifications n WHERE n.dedup_key = 'waitlist:' || b.id::text)`,
    [branchId, tomorrow]
  );
  return rows.map((r) => ({
    customerId: r.customer_id,
    phone: r.phone,
    kind: "session_reminder",
    key: dedupKey.session(r.id),
    message: sessionReminderMessage({ name: r.name, program: r.program, kind: r.kind, time: r.start_time, coach: r.coach, cancelWindowHours }),
  }));
}

async function passCandidates(branchId: string, today: string, s: JobSettings): Promise<Candidate[]> {
  const passes = await query<PassRow & { opted_in: boolean }>(
    `SELECT ${PASS_SELECT}, ${OPTED_IN} AS opted_in
     FROM studio.member_passes mp JOIN pos.pos_customers c ON c.id = mp.customer_id
     ${PASS_USAGE_JOIN}
     WHERE mp.branch_id = $1 AND mp.status = 'active' AND mp.valid_from <= $2::date AND mp.valid_until >= $2::date`,
    [branchId, today]
  );
  const out: Candidate[] = [];
  const byCustomer = new Map<string, { pass: PassRow; left: number; opted: boolean }[]>();
  for (const p of passes) {
    const r = remainingCredits({ class_total: p.class_credits_total, pt_total: p.pt_credits_total, class_used: p.class_used, pt_used: p.pt_used });
    const left = r.class + r.pt;
    byCustomer.set(p.customer_id, [...(byCustomer.get(p.customer_id) ?? []), { pass: p, left, opted: p.opted_in }]);
    if (p.opted_in && left > 0 && p.valid_until <= addDays(today, s.pass_expiring_days)) {
      out.push({
        customerId: p.customer_id,
        phone: p.member_phone,
        kind: "pass_expiring",
        key: dedupKey.passExpiring(p.id),
        message: passExpiringMessage({ name: p.member_name, product: p.product_name, validUntil: p.valid_until, left }),
      });
    }
  }
  // Kredit hampir habis dihitung per member (paket lain yang masih banyak → tidak perlu diingatkan).
  for (const list of byCustomer.values()) {
    const total = list.reduce((sum, x) => sum + x.left, 0);
    const holder = list.find((x) => x.left > 0);
    if (!holder || !holder.opted || total <= 0 || total > s.pass_low_threshold) continue;
    out.push({
      customerId: holder.pass.customer_id,
      phone: holder.pass.member_phone,
      kind: "pass_low",
      key: dedupKey.passLow(holder.pass.id, total),
      message: passLowMessage({ name: holder.pass.member_name, product: holder.pass.product_name, left: total }),
    });
  }
  return out;
}

/** Klaim dedup lalu kirim; satu baris log per pesan. */
async function deliver(branchId: string, c: Candidate, summary: ReminderSummary): Promise<boolean> {
  const phone = c.phone ? normalizeMemberPhone(c.phone) : null;
  const claimed = await queryOne<{ id: string }>(
    `INSERT INTO studio.member_notifications (branch_id, customer_id, kind, dedup_key, phone, message, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (dedup_key) DO NOTHING RETURNING id`,
    [branchId, c.customerId, c.kind, c.key, phone, c.message, phone ? "pending" : "skipped"]
  );
  if (!claimed) return false;
  summary[c.kind] += 1;
  if (!phone) {
    summary.skipped += 1;
    await query(`UPDATE studio.member_notifications SET error = 'Nomor HP tidak valid' WHERE id = $1`, [claimed.id]);
    return true;
  }
  const res = await sendWhatsAppText({ target: phone, message: c.message }, { messageType: "notification" });
  if (res.success) summary.sent += 1;
  else summary.failed += 1;
  await query(`UPDATE studio.member_notifications SET status = $2::varchar, error = $3, sent_at = CASE WHEN $2::varchar = 'sent' THEN now() END WHERE id = $1`, [
    claimed.id,
    res.success ? "sent" : "failed",
    res.success ? null : res.timedOut ? "Status kirim tidak pasti (timeout) — tidak dikirim ulang" : (res.reason ?? "Gagal kirim"),
  ]);
  return true;
}

/**
 * Satu putaran pengingat. `scheduled` = sertakan H-1 & info paket (setelah
 * reminder_hour); waitlist selalu dicek di jam layak. force = tombol manual.
 */
export async function runReminders(v: Venue, opts: { now?: Date; force?: boolean; trigger?: "auto" | "manual"; userId?: string | null } = {}): Promise<{ ran: boolean; summary?: ReminderSummary; reason?: string }> {
  const now = opts.now ?? new Date();
  const s = await loadJobSettings(v.branchId);
  if (!s.reminders_enabled) return { ran: false, reason: "Pengingat WhatsApp sedang dimatikan" };
  if (!inSendWindow(now)) return { ran: false, reason: "Di luar jam kirim (08.00–21.00 WIB)" };
  const scheduled = opts.force || scheduledRemindersDue(s, now);
  const { date: today } = wibNow(now);
  const settings = await loadSettings(v.branchId);
  const waitlist = await waitlistCandidates(v.branchId);
  const promotedKeys = new Set(waitlist.map((c) => c.key.replace("waitlist:", "session:")));
  const candidates = [
    ...waitlist,
    ...(scheduled ? (await sessionCandidates(v.branchId, addDays(today, 1), settings.cancel_window_hours)).filter((c) => !promotedKeys.has(c.key)) : []),
    ...(scheduled ? await passCandidates(v.branchId, today, s) : []),
  ];
  const summary: ReminderSummary = { session_reminder: 0, waitlist_promoted: 0, pass_low: 0, pass_expiring: 0, sent: 0, failed: 0, skipped: 0 };
  if (candidates.length === 0 && !opts.force) return { ran: true, summary };

  // Catat run hanya bila ada yang dikirim atau dipicu manual (log tidak dibanjiri tick kosong).
  let attempted = 0;
  for (const c of candidates) {
    if (attempted >= MAX_PER_TICK) break;
    if (await deliver(v.branchId, c, summary)) {
      attempted += 1;
      if (summary.sent + summary.failed > 0) await sleep(800);
    }
  }
  if (attempted > 0 || opts.force) {
    await query(
      `INSERT INTO studio.job_runs (company_id, branch_id, job_code, run_date, trigger, status, summary, started_by, finished_at)
       VALUES ($1, $2, 'reminders', (now() AT TIME ZONE 'Asia/Jakarta')::date, $3, 'success', $4::jsonb, $5, now())`,
      [v.companyId, v.branchId, opts.trigger ?? "auto", JSON.stringify(summary), opts.userId ?? null]
    );
  }
  return { ran: true, summary };
}
