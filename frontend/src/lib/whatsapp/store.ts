/**
 * EPIC-012 Fase A+B — penyimpanan riwayat pesan & percakapan WhatsApp.
 *
 * Aturan keras: body pesan OTP TIDAK PERNAH disimpan (constraint DB
 * wa_messages_otp_no_body ikut menjaga). Kegagalan pencatatan tidak boleh
 * menggagalkan pengiriman — log dulu urusan kedua, pesan sampai urusan utama.
 */

import type { Pool, PoolClient } from "pg";
import { getPool } from "@/lib/db";
import { messagePreview, type NormalizedInbound } from "./inbound";
import type { WhatsAppResult } from "./types";

export type OutboundLogInput = {
  phone: string;
  messageType: "otp" | "notification" | "chat" | "broadcast" | "system";
  /** Diabaikan (dipaksa NULL) bila messageType === "otp". */
  body: string | null;
  result: WhatsAppResult;
  sentByUserId?: string | null;
  conversationId?: string | null;
};

async function findCustomerIdByPhone(
  db: Pool | PoolClient,
  phone: string
): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT id FROM pos.pos_customers
      WHERE regexp_replace(COALESCE(phone,''), '\\D', '', 'g')
            IN ($1, '0' || substring($1 from 3))
      LIMIT 1`,
    [phone]
  );
  return rows[0]?.id ?? null;
}

/**
 * Catat pesan keluar. Tidak melempar — kegagalan log hanya tercatat di
 * console supaya alur kirim (OTP dsb.) tidak ikut tumbang.
 */
export async function logOutboundMessage(input: OutboundLogInput): Promise<void> {
  try {
    const pool = getPool();
    const customerId = await findCustomerIdByPhone(pool, input.phone);

    await pool.query(
      `INSERT INTO crm.wa_messages
         (conversation_id, direction, message_type, phone, customer_id, body,
          status, provider, provider_message_id, error_reason, sent_by_user_id)
       VALUES ($1, 'out', $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL
       DO NOTHING`,
      [
        input.conversationId ?? null,
        input.messageType,
        input.phone,
        customerId,
        input.messageType === "otp" ? null : input.body,
        input.result.success ? "sent" : "failed",
        input.result.provider ?? null,
        input.result.messageId ?? null,
        input.result.success ? null : (input.result.reason ?? "Unknown error"),
      input.sentByUserId ?? null,
      ]
    );
  } catch (error) {
    console.error(
      "[wa-log] Gagal mencatat pesan keluar:",
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Rekam pesan dari gateway (masuk, atau keluar-manual dari HP) dalam satu
 * transaksi bersama pembaruan percakapannya.
 *
 * Idempoten: provider_message_id unik — echo fromMe atas pesan yang sudah
 * dicatat lapisan pengirim jatuh ke DO NOTHING, percakapan tidak tersentuh.
 */
export async function recordGatewayMessage(
  message: NormalizedInbound
): Promise<{ stored: boolean; conversationId: string | null }> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Auto-link member hanya mungkin untuk kanal yang punya nomor telepon.
    // Instagram sengaja tidak ditautkan (keputusan owner) — panel konteks
    // member cukup kosong.
    const customerId = message.phone
      ? await findCustomerIdByPhone(client, message.phone)
      : null;

    const { rows: convRows } = await client.query(
      `INSERT INTO crm.wa_conversations
         (channel, external_id, phone, customer_id, display_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (channel, external_id) DO UPDATE
         SET customer_id = COALESCE(crm.wa_conversations.customer_id, EXCLUDED.customer_id),
             -- Nama tampilan bisa berubah di kanal; ikuti yang terbaru.
             display_name = COALESCE(EXCLUDED.display_name, crm.wa_conversations.display_name)
       RETURNING id`,
      [message.channel, message.externalId, message.phone, customerId, message.pushName]
    );
    const conversationId: string = convRows[0].id;

    const { rows: inserted } = await client.query(
      `INSERT INTO crm.wa_messages
         (conversation_id, direction, message_type, channel, external_id, phone,
          customer_id, body, media_type, status, provider, provider_message_id,
          wa_from_me, created_at)
       VALUES ($1, $2, 'chat', $11, $12, $3, $4, $5, $6, $7, 'gateway', $8, $9,
               COALESCE($10, now()))
       ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        conversationId,
        message.direction,
        message.phone,
        customerId,
        message.body,
        message.mediaType,
        message.direction === "in" ? "received" : "sent",
        message.providerMessageId,
        message.direction === "out",
        message.sentAt,
        message.channel,
        message.externalId,
      ]
    );

    // Echo pesan yang sudah tercatat — jangan sentuh counter percakapan.
    if (inserted.length === 0) {
      await client.query("ROLLBACK");
      return { stored: false, conversationId };
    }

    const preview = messagePreview(message.body, message.mediaType);
    if (message.direction === "in") {
      await client.query(
        `UPDATE crm.wa_conversations
            SET unread_count = unread_count + 1,
                last_message_at = COALESCE($2, now()),
                last_message_preview = $3,
                status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END
          WHERE id = $1`,
        [conversationId, message.sentAt, preview]
      );
    } else {
      await client.query(
        `UPDATE crm.wa_conversations
            SET last_message_at = COALESCE($2, now()),
                last_message_preview = $3
          WHERE id = $1`,
        [conversationId, message.sentAt, preview]
      );
    }

    await client.query("COMMIT");
    return { stored: true, conversationId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
