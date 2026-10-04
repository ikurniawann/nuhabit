import "server-only";
/**
 * EPIC-012 Fase D — sisi server penanganan komplain: baca konfigurasi CS,
 * jaga state SLA saat pesan mengalir, auto-reply di luar jam operasional,
 * dan tangkap skor CSAT dari balasan customer.
 */

import type { Pool, PoolClient } from "pg";
import { getPool } from "@/lib/db";
import {
  CS_DEFAULTS,
  isWithinBusinessHours,
  parseCsatReply,
  wibDateKey,
  type CsSettings,
} from "./cs-rules";

/** `crm_settings.value` bertipe jsonb — angka/boolean/string sudah ter-parse. */
function readNumber(raw: unknown, fallback: number): number {
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") return raw === "true";
  return fallback;
}

function readText(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw.trim() ? raw : fallback;
}

export async function getCsSettings(db: Pool | PoolClient = getPool()): Promise<CsSettings> {
  const { rows } = await db.query(
    `SELECT key, value FROM crm.crm_settings WHERE key LIKE 'cs_%'`
  );
  const map = new Map<string, unknown>(rows.map((row) => [row.key, row.value]));

  return {
    slaResponseMinutes: readNumber(map.get("cs_sla_response_minutes"), CS_DEFAULTS.slaResponseMinutes),
    slaResolutionMinutes: readNumber(map.get("cs_sla_resolution_minutes"), CS_DEFAULTS.slaResolutionMinutes),
    businessHoursStart: readNumber(map.get("cs_business_hours_start"), CS_DEFAULTS.businessHoursStart),
    businessHoursEnd: readNumber(map.get("cs_business_hours_end"), CS_DEFAULTS.businessHoursEnd),
    autoReplyEnabled: readBoolean(map.get("cs_auto_reply_enabled"), CS_DEFAULTS.autoReplyEnabled),
    autoReplyText: readText(map.get("cs_auto_reply_text"), CS_DEFAULTS.autoReplyText),
    csatEnabled: readBoolean(map.get("cs_csat_enabled"), CS_DEFAULTS.csatEnabled),
    csatText: readText(map.get("cs_csat_text"), CS_DEFAULTS.csatText),
  };
}

/**
 * Dipanggil setelah pesan MASUK tersimpan.
 *
 * - Menandai percakapan mulai menunggu (dasar SLA) bila belum menunggu.
 * - Menangkap skor CSAT bila kita memang sedang menunggu penilaian.
 * - Mengembalikan teks auto-reply yang perlu dikirim (bila di luar jam
 *   operasional dan belum dikirim hari ini), atau null.
 */
export async function onInboundMessage(
  conversationId: string,
  body: string | null,
  receivedAt: Date,
  db: Pool | PoolClient = getPool()
): Promise<{ autoReplyText: string | null; csatCaptured: number | null }> {
  const settings = await getCsSettings(db);

  const { rows } = await db.query(
    `SELECT awaiting_since, csat_asked_at, csat_score, auto_reply_sent_on
       FROM crm.wa_conversations WHERE id = $1`,
    [conversationId]
  );
  const conversation = rows[0];
  if (!conversation) return { autoReplyText: null, csatCaptured: null };

  // CSAT: hanya baca angka bila kita memang baru saja meminta penilaian dan
  // belum punya skor — supaya angka dalam kalimat biasa tidak salah tangkap.
  let csatCaptured: number | null = null;
  if (conversation.csat_asked_at && conversation.csat_score == null) {
    const score = parseCsatReply(body);
    if (score != null) {
      // Balasan rating datang lewat jalur pesan masuk biasa, yang sudah
      // membuka kembali percakapan 'resolved'. Kembalikan ke resolved:
      // memberi nilai bukan berarti komplain terbuka lagi.
      await db.query(
        `UPDATE crm.wa_conversations
            SET csat_score = $2,
                status = 'resolved',
                unread_count = 0,
                awaiting_since = NULL
          WHERE id = $1`,
        [conversationId, score]
      );
      csatCaptured = score;
    }
  }

  // Mulai jam tunggu SLA hanya bila belum ada yang menunggu — dan bukan
  // ketika pesan itu justru jawaban rating (percakapan sudah selesai).
  if (!conversation.awaiting_since && csatCaptured == null) {
    await db.query(
      `UPDATE crm.wa_conversations
          SET awaiting_since = $2, sla_response_breached = false, escalated_at = NULL
        WHERE id = $1 AND awaiting_since IS NULL`,
      [conversationId, receivedAt]
    );
  }

  // Auto-reply hanya di luar jam operasional, sekali per hari per percakapan.
  let autoReplyText: string | null = null;
  if (
    settings.autoReplyEnabled &&
    !isWithinBusinessHours(receivedAt, settings.businessHoursStart, settings.businessHoursEnd)
  ) {
    const today = wibDateKey(receivedAt);
    const alreadySent =
      conversation.auto_reply_sent_on &&
      new Date(conversation.auto_reply_sent_on).toISOString().slice(0, 10) === today;

    if (!alreadySent) {
      const { rowCount } = await db.query(
        `UPDATE crm.wa_conversations
            SET auto_reply_sent_on = $2::date
          WHERE id = $1 AND (auto_reply_sent_on IS DISTINCT FROM $2::date)`,
        [conversationId, today]
      );
      // rowCount 0 = proses lain sudah mengklaim slot hari ini.
      if (rowCount && rowCount > 0) autoReplyText = settings.autoReplyText;
    }
  }

  return { autoReplyText, csatCaptured };
}

/**
 * Dipanggil setelah agent MEMBALAS. Menghentikan jam tunggu dan mencatat
 * waktu respons pertama (sekali saja per percakapan).
 */
export async function onAgentReply(
  conversationId: string,
  repliedAt: Date,
  db: Pool | PoolClient = getPool()
): Promise<void> {
  await db.query(
    `UPDATE crm.wa_conversations
        SET first_response_at = COALESCE(first_response_at, $2),
            first_response_seconds = COALESCE(
              first_response_seconds,
              CASE WHEN awaiting_since IS NOT NULL
                   THEN GREATEST(0, EXTRACT(EPOCH FROM ($2::timestamptz - awaiting_since))::int)
              END
            ),
            awaiting_since = NULL,
            sla_response_breached = false,
            escalated_at = NULL
      WHERE id = $1`,
    [conversationId, repliedAt]
  );
}

/** Dipanggil saat percakapan ditandai selesai — catat durasi penyelesaian. */
export async function onResolved(
  conversationId: string,
  resolvedAt: Date,
  db: Pool | PoolClient = getPool()
): Promise<{ csatText: string | null }> {
  const settings = await getCsSettings(db);

  const { rows } = await db.query(
    `UPDATE crm.wa_conversations
        SET resolved_at = $2,
            resolution_seconds = GREATEST(
              0, EXTRACT(EPOCH FROM ($2::timestamptz - created_at))::int
            ),
            awaiting_since = NULL,
            csat_asked_at = CASE WHEN $3 THEN $2 ELSE csat_asked_at END
      WHERE id = $1
      RETURNING csat_score`,
    [conversationId, resolvedAt, settings.csatEnabled]
  );

  // Minta rating hanya bila fitur aktif dan belum pernah dinilai.
  const alreadyRated = rows[0]?.csat_score != null;
  return { csatText: settings.csatEnabled && !alreadyRated ? settings.csatText : null };
}
