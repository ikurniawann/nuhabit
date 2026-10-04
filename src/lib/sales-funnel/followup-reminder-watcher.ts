/**
 * EPIC-022 Fase C → EPIC-050 Fase 1 (T-1.5) — pengingat task jatuh tempo.
 *
 * Setiap beberapa menit mencari task yang waktu pengingatnya (reminder_at,
 * fallback due_at) sudah lewat, masih terbuka, dan belum pernah diingatkan,
 * lalu mengirim ke penanggung jawabnya lewat kanal yang dipilih task:
 *   • wa     — WA gateway (nomor dari hris.employees via user_id)
 *   • in_app — baris public.notifications (lonceng dashboard)
 *   • email  — DITUNDA (keputusan owner 2026-09-13), diabaikan diam-diam
 * Idempotensi dijaga dengan mengklaim reminder_sent_at SEBELUM kirim
 * (terkirim maksimal 1x per task) — bila gateway menolak dengan jelas, klaim
 * dilepas agar dicoba lagi; bila timeout (status kirim tak pasti), klaim
 * dipertahankan demi at-most-once.
 */
import { getPool } from "@/lib/db";
import { formatDateLong, formatDateTime, formatTime } from "@/lib/format";
import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import { normalizePhone, isValidNormalizedPhone } from "./server";

const CHECK_INTERVAL_MS = 5 * 60_000;
// Batas kirim per tick — jaga aktivitas nomor gateway tetap wajar
const MAX_REMINDERS_PER_TICK = 10;

type ReminderRow = {
  id: string;
  activity_type: string;
  title: string | null;
  notes: string | null;
  due_at: string;
  priority: string;
  reminder_channels: unknown;
  owner_user_id: string;
  owner_name: string | null;
  owner_phone: string | null;
  deal_title: string | null;
  subject_type: string | null;
  subject_name: string | null;
  pic_name: string | null;
};

function channelsOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string") : ["wa", "in_app"];
}

function subjectLabel(row: ReminderRow): string {
  if (row.deal_title) return `deal "${row.deal_title}"${row.subject_name && row.subject_type !== "deal" ? ` (${row.subject_name})` : ""}`;
  switch (row.subject_type) {
    case "account":
      return `account ${row.subject_name ?? "-"}`;
    case "contact":
      return `contact ${row.subject_name ?? "-"}`;
    case "member":
      return `member ${row.subject_name ?? "-"}`;
    default:
      return `lead ${row.subject_name ?? "-"}`;
  }
}

export function buildReminderMessage(row: ReminderRow): string {
  const due = `${formatDateLong(row.due_at)}, ${formatTime(row.due_at)}`;
  const head = row.title ? `${row.title}` : `${row.activity_type.toUpperCase()}`;
  const prio = row.priority === "urgent" ? " 🔴 URGENT" : row.priority === "high" ? " 🟠 Tinggi" : "";
  const lines = [
    `⏰ *Pengingat Task CRM*${prio}`,
    ``,
    `${head} — ${subjectLabel(row)}`,
    row.pic_name && row.subject_type !== "contact" ? `PIC: ${row.pic_name}` : null,
    `Jatuh tempo: ${due}`,
    row.notes ? `Catatan: ${row.notes.slice(0, 300)}` : null,
    ``,
    `Buka CRM → Sales → Tasks & Kalender untuk menandai selesai.`,
  ];
  return lines.filter((line) => line !== null).join("\n");
}

export async function sendDueFollowupReminders(): Promise<{ sent: number; inApp: number }> {
  const config = await loadGatewayConfig();
  const pool = getPool();

  // Klaim atomik: set reminder_sent_at lebih dulu supaya dua proses/tick
  // tidak pernah mengirim pengingat yang sama dua kali.
  const claimed = await pool.query<{ id: string }>(
    `UPDATE crm.crm_sales_activities
        SET reminder_sent_at = now(), updated_at = now()
      WHERE id IN (
        SELECT id FROM crm.crm_sales_activities
         WHERE deleted_at IS NULL
           AND status IN ('open', 'in_progress')
           AND done_at IS NULL
           AND reminder_sent_at IS NULL
           AND owner_user_id IS NOT NULL
           AND COALESCE(reminder_at, due_at) IS NOT NULL
           AND COALESCE(reminder_at, due_at) <= now()
         ORDER BY COALESCE(reminder_at, due_at) ASC
         LIMIT ${MAX_REMINDERS_PER_TICK}
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id`
  );
  if (claimed.rows.length === 0) return { sent: 0, inApp: 0 };

  // Klaim yang belum tuntas diproses — dilepas kembali bila terjadi
  // exception tak terduga supaya pengingatnya tidak hilang selamanya.
  const pendingIds = new Set(claimed.rows.map((r) => r.id));
  let sent = 0;
  let inApp = 0;
  try {
    // Nomor PJ via subquery skalar (bukan JOIN) — hris.employees.user_id
    // tidak UNIQUE; JOIN bisa menduplikasi baris dan mengirim dua kali.
    const { rows } = await pool.query<ReminderRow>(
      `SELECT a.id, a.activity_type, a.title, a.notes,
              COALESCE(a.due_at, a.reminder_at) AS due_at,
              a.priority, a.reminder_channels, a.owner_user_id, a.subject_type,
              u.full_name AS owner_name,
              (SELECT e.phone FROM hris.employees e
                WHERE e.user_id = u.id AND e.phone IS NOT NULL
                ORDER BY e.created_at DESC LIMIT 1) AS owner_phone,
              d.title AS deal_title,
              CASE a.subject_type
                WHEN 'deal' THEN dl.org_name
                WHEN 'lead' THEN l.org_name
                WHEN 'account' THEN acc.name
                WHEN 'contact' THEN con.name
                WHEN 'member' THEN cust.name
                ELSE COALESCE(dl.org_name, l.org_name)
              END AS subject_name,
              COALESCE(dl.pic_name, l.pic_name, con.name, cust.name) AS pic_name
         FROM crm.crm_sales_activities a
         JOIN configuration.users u ON u.id = a.owner_user_id
         LEFT JOIN crm.crm_sales_deals d ON d.id = a.deal_id
         LEFT JOIN crm.crm_sales_leads dl ON dl.id = d.lead_id
         LEFT JOIN crm.crm_sales_leads l ON l.id = a.lead_id
         LEFT JOIN crm.crm_accounts acc ON a.subject_type = 'account' AND acc.id = a.subject_id
         LEFT JOIN crm.crm_contacts con ON a.subject_type = 'contact' AND con.id = a.subject_id
         LEFT JOIN pos.pos_customers cust ON a.subject_type = 'member' AND cust.id = a.subject_id
        WHERE a.id = ANY($1::uuid[])`,
      [claimed.rows.map((r) => r.id)]
    );
    for (const row of rows) {
      const channels = channelsOf(row.reminder_channels);
      const message = buildReminderMessage(row);

      // ── in-app: murah & selalu bisa; catat sekali (in_app_notified_at) ──
      if (channels.includes("in_app")) {
        try {
          const marked = await pool.query(
            `UPDATE crm.crm_sales_activities SET in_app_notified_at = now()
              WHERE id = $1 AND in_app_notified_at IS NULL RETURNING id`,
            [row.id]
          );
          if (marked.rowCount) {
            await pool.query(
              `INSERT INTO public.notifications (user_id, title, message, type, link, metadata, is_read)
               VALUES ($1, $2, $3, 'reminder', $4, $5::jsonb, false)`,
              [
                row.owner_user_id,
                `Task jatuh tempo: ${row.title ?? row.activity_type}`,
                `${subjectLabel(row)} — ${formatDateTime(row.due_at)}`,
                `/dashboard/sales-funnel/tasks?task=${row.id}`,
                JSON.stringify({ task_id: row.id, subject_type: row.subject_type }),
              ]
            );
            inApp += 1;
          }
        } catch (notifError) {
          console.error(`[sales-followup] gagal notifikasi in-app task ${row.id}:`, notifError);
        }
      }

      // ── WA ──
      if (!channels.includes("wa") || !config) {
        // Tanpa kanal WA (atau gateway belum dikonfigurasi) pengingat dianggap
        // selesai lewat in-app; biarkan terklaim agar tidak dicek ulang.
        pendingIds.delete(row.id);
        continue;
      }
      const phone = row.owner_phone ? normalizePhone(row.owner_phone) : "";
      if (!isValidNormalizedPhone(phone)) {
        console.warn(
          `[sales-followup] lewati task ${row.id}: nomor WA penanggung jawab tidak valid`
        );
        pendingIds.delete(row.id);
        continue;
      }
      const result = await sendGatewayText(config, { target: phone, message });
      if (result.success) {
        sent += 1;
        pendingIds.delete(row.id);
        continue;
      }
      if (result.timedOut) {
        // Status kirim tak pasti → klaim dipertahankan, at-most-once menang.
        pendingIds.delete(row.id);
      } else {
        // Gagal jelas (gateway menolak) → lepas klaim agar dicoba tick berikut.
        await pool.query(
          `UPDATE crm.crm_sales_activities
              SET reminder_sent_at = NULL, updated_at = now()
            WHERE id = $1`,
          [row.id]
        );
        pendingIds.delete(row.id);
      }
      console.error(
        `[sales-followup] gagal kirim pengingat task ${row.id}: ${result.reason}`
      );
    }
  } finally {
    // Baris terklaim yang belum sempat diproses (exception di tengah jalan)
    // dilepas kembali — tanpa ini pengingatnya hilang permanen.
    if (pendingIds.size > 0) {
      try {
        await pool.query(
          `UPDATE crm.crm_sales_activities
              SET reminder_sent_at = NULL, updated_at = now()
            WHERE id = ANY($1::uuid[])`,
          [Array.from(pendingIds)]
        );
      } catch (rollbackError) {
        console.error(
          `[sales-followup] GAGAL melepas klaim ${pendingIds.size} task ` +
            `(${Array.from(pendingIds).join(", ")}) — perlu reset manual:`,
          rollbackError
        );
      }
    }
  }
  if (sent > 0 || inApp > 0) {
    console.log(`[sales-followup] ${sent} pengingat WA + ${inApp} in-app terkirim`);
  }
  return { sent, inApp };
}

let timer: NodeJS.Timeout | null = null;

/** Dipanggil dari src/instrumentation.ts — sekali per proses server. */
export function startSalesFollowupWatcher(): void {
  if (timer) return;
  const tick = () => {
    sendDueFollowupReminders().catch((err) =>
      console.error("[sales-followup] watcher error:", err)
    );
  };
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref?.();
  // tick pertama sedikit ditunda agar pool DB siap
  setTimeout(tick, 20_000).unref?.();
  console.log("[sales-followup] watcher terdaftar (tiap 5 menit)");
}
