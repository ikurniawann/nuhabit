import "server-only";
/**
 * EPIC-012 Fase C — inbox CS (WhatsApp + Instagram): daftar percakapan,
 * detail + konteks member, aksi agent, dan template balasan cepat.
 * Isi chat = PII sensitif; gate peran inbox di route.
 */
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { getPool } from "@/lib/db";
import { sendInstagramText } from "@/lib/instagram/client";
import { isWithinReplyWindow } from "@/lib/instagram/webhook";
import { buildKomplainMessage, komplainDedupKey } from "@/lib/wa/notifications-messages";
import { fireOwnerNotification } from "@/lib/wa/notifications-sender";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { messagePreview } from "@/lib/whatsapp/inbound";
import { recordGatewayMessage } from "@/lib/whatsapp/store";
import { CS_CATEGORIES, CS_PRIORITIES } from "./cs-rules";
import { onAgentReply, onResolved } from "./cs-server";

// ── Daftar percakapan ──────────────────────────────────────────────────────

export type ConversationFilter = {
  status: string | null;
  assigned: string | null;
  search: string | null;
  channel: string | null;
};

export async function listConversations(filter: ConversationFilter, agentUserId: string) {
  const values: unknown[] = [];
  const filters: string[] = [];

  if (filter.status && filter.status !== "all") {
    values.push(filter.status);
    filters.push(`v.status = $${values.length}`);
  }
  if (filter.assigned === "me") {
    values.push(agentUserId);
    filters.push(`v.assigned_user_id = $${values.length}`);
  } else if (filter.assigned === "unassigned") {
    filters.push(`v.assigned_user_id IS NULL`);
  }
  if (filter.channel === "whatsapp" || filter.channel === "instagram") {
    values.push(filter.channel);
    filters.push(`v.channel = $${values.length}`);
  }
  const search = filter.search?.trim();
  if (search) {
    values.push(`%${search.replace(/[%_]/g, "")}%`);
    filters.push(
      `(v.external_id LIKE $${values.length} OR v.display_name ILIKE $${values.length}` +
        ` OR c.name ILIKE $${values.length})`
    );
  }

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT v.id, v.phone, v.channel, v.external_id, v.display_name,
            v.status, v.assigned_user_id, v.unread_count,
            v.last_message_at, v.last_message_preview,
            v.is_complaint, v.category, v.priority, v.sla_response_breached,
            v.awaiting_since,
            c.id AS customer_id, c.name AS customer_name,
            c.membership_tier, c.member_type,
            u.full_name AS assigned_name
       FROM crm.wa_conversations v
       LEFT JOIN pos.pos_customers c ON c.id = v.customer_id
       LEFT JOIN configuration.users u ON u.id = v.assigned_user_id
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY v.last_message_at DESC NULLS LAST
      LIMIT 100`,
    values
  );

  const { rows: totals } = await pool.query(
    `SELECT COALESCE(SUM(unread_count), 0)::int AS total_unread,
            COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int AS total_active,
            COUNT(*) FILTER (WHERE sla_response_breached AND status <> 'resolved')::int AS total_breached,
            COUNT(*) FILTER (WHERE is_complaint AND status <> 'resolved')::int AS total_complaints,
            COUNT(*) FILTER (WHERE channel = 'whatsapp')::int AS total_whatsapp,
            COUNT(*) FILTER (WHERE channel = 'instagram')::int AS total_instagram
       FROM crm.wa_conversations`
  );

  return { conversations: rows, totals: totals[0] };
}

// ── Detail percakapan ──────────────────────────────────────────────────────

const NOT_FOUND = "Percakapan tidak ditemukan";

export async function loadConversationDetail(id: string) {
  const pool = getPool();
  const { rows: convRows } = await pool.query(
    `SELECT v.id, v.phone, v.channel, v.external_id, v.display_name,
            v.status, v.assigned_user_id, v.unread_count,
            v.last_message_at, v.customer_id,
            v.is_complaint, v.category, v.priority,
            v.awaiting_since, v.first_response_seconds, v.resolution_seconds,
            v.sla_response_breached, v.escalated_at, v.csat_score,
            u.full_name AS assigned_name
       FROM crm.wa_conversations v
       LEFT JOIN configuration.users u ON u.id = v.assigned_user_id
      WHERE v.id = $1`,
    [id]
  );
  const conversation = convRows[0];
  if (!conversation) throw ApiError.notFound(NOT_FOUND);

  const [{ rows: messages }, member, { rows: notes }] = await Promise.all([
    pool.query(
      `SELECT m.id, m.direction, m.message_type, m.body, m.media_type, m.status,
              m.error_reason, m.wa_from_me, m.created_at,
              u.full_name AS sent_by_name
         FROM crm.wa_messages m
         LEFT JOIN configuration.users u ON u.id = m.sent_by_user_id
        WHERE m.conversation_id = $1
        ORDER BY m.created_at ASC
        LIMIT 300`,
      [id]
    ),
    loadMemberContext(conversation.customer_id),
    pool.query(
      `SELECT n.id, n.body, n.created_at, u.full_name AS author_name
         FROM crm.wa_internal_notes n
         LEFT JOIN configuration.users u ON u.id = n.author_user_id
        WHERE n.conversation_id = $1
        ORDER BY n.created_at DESC
        LIMIT 50`,
      [id]
    ),
  ]);

  return { conversation, messages, member, notes };
}

/** Member yang terhubung ke percakapan: profil, 5 order & 5 redeem terakhir. */
async function loadMemberContext(customerId: string | null) {
  if (!customerId) return null;
  const pool = getPool();
  const [{ rows: customers }, { rows: orders }, { rows: redemptions }] = await Promise.all([
    pool.query(
      `SELECT c.id, c.name, c.phone, c.member_type, c.visit_count,
              c.total_xp::float AS total_xp,
              c.ark_coin_balance::float AS ark_coin_balance,
              t.name AS tier_name
         FROM pos.pos_customers c
         LEFT JOIN LATERAL (
           SELECT name FROM crm.crm_membership_tiers
            WHERE is_active AND min_lifetime_xp <= COALESCE(c.total_xp, 0)
            ORDER BY rank DESC LIMIT 1
         ) t ON true
        WHERE c.id = $1`,
      [customerId]
    ),
    pool.query(
      `SELECT id, order_number, total_amount::float AS total_amount,
              payment_method, status, created_at
         FROM pos.pos_orders
        WHERE customer_id = $1
        ORDER BY created_at DESC LIMIT 5`,
      [customerId]
    ),
    pool.query(
      `SELECT r.redemption_number, r.status, r.requested_at, w.name AS reward_name
         FROM crm.crm_redemptions r
         JOIN crm.crm_rewards w ON w.id = r.reward_id
        WHERE r.customer_id = $1
        ORDER BY r.requested_at DESC LIMIT 5`,
      [customerId]
    ),
  ]);

  const customer = customers[0];
  if (!customer) return null;
  return { ...customer, recent_orders: orders, recent_redemptions: redemptions };
}

// ── Aksi agent ─────────────────────────────────────────────────────────────

export const conversationActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), message: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal("assign_me") }),
  z.object({ action: z.literal("unassign") }),
  z.object({
    action: z.literal("set_status"),
    status: z.enum(["open", "in_progress", "waiting_customer", "resolved"]),
  }),
  z.object({ action: z.literal("mark_read") }),
  z.object({
    action: z.literal("set_complaint"),
    is_complaint: z.boolean(),
    category: z.enum(CS_CATEGORIES).nullable().optional(),
    priority: z.enum(CS_PRIORITIES).optional(),
  }),
  z.object({ action: z.literal("add_note"), body: z.string().trim().min(1).max(2000) }),
]);
type ConversationAction = z.infer<typeof conversationActionSchema>;

type ConversationRow = {
  id: string;
  phone: string;
  channel: string;
  external_id: string;
  display_name: string | null;
  category: string | null;
  priority: string | null;
};

const SIMPLE_ACTION_SQL = {
  mark_read: `UPDATE crm.wa_conversations SET unread_count = 0 WHERE id = $1`,
  unassign: `UPDATE crm.wa_conversations SET assigned_user_id = NULL WHERE id = $1`,
} as const;

/** Jalankan aksi agent; `{ messageId }` hanya untuk balasan. */
export async function applyConversationAction(
  id: string,
  payload: ConversationAction,
  agentUserId: string
): Promise<{ messageId?: string | null } | null> {
  const pool = getPool();
  const { rows } = await pool.query<ConversationRow>(
    `SELECT id, phone, channel, external_id, display_name, category, priority
       FROM crm.wa_conversations WHERE id = $1`,
    [id]
  );
  const conversation = rows[0];
  if (!conversation) throw ApiError.notFound(NOT_FOUND);

  switch (payload.action) {
    case "mark_read":
    case "unassign":
      await pool.query(SIMPLE_ACTION_SQL[payload.action], [id]);
      return null;
    case "assign_me":
      await pool.query(
        `UPDATE crm.wa_conversations
            SET assigned_user_id = $2,
                status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END
          WHERE id = $1`,
        [id, agentUserId]
      );
      return null;
    case "set_complaint":
      await setComplaint(conversation, payload);
      return null;
    case "add_note":
      // Catatan internal TIDAK pernah dikirim ke customer.
      await pool.query(
        `INSERT INTO crm.wa_internal_notes (conversation_id, author_user_id, body)
         VALUES ($1, $2, $3)`,
        [id, agentUserId, payload.body]
      );
      return null;
    case "set_status":
      await pool.query(`UPDATE crm.wa_conversations SET status = $2 WHERE id = $1`, [id, payload.status]);
      if (payload.status === "resolved") {
        const { csatText } = await onResolved(id, new Date());
        if (csatText) {
          await sendWhatsAppText(
            { target: conversation.phone, message: csatText },
            { messageType: "system", sentByUserId: agentUserId, conversationId: id }
          );
        }
      }
      return null;
    case "reply":
      return { messageId: await reply(conversation, payload.message, agentUserId) };
  }
}

async function setComplaint(
  conversation: ConversationRow,
  payload: Extract<ConversationAction, { action: "set_complaint" }>
) {
  await getPool().query(
    `UPDATE crm.wa_conversations
        SET is_complaint = $2,
            category = COALESCE($3, category),
            priority = COALESCE($4, priority)
      WHERE id = $1`,
    [conversation.id, payload.is_complaint, payload.category ?? null, payload.priority ?? null]
  );
  // EPIC-020 Fase C: komplain → WA owner. Tembak-dan-lupakan (tidak
  // menggagalkan aksi CS); dedup per percakapan — toggle bolak-balik
  // tidak mengirim ulang.
  if (payload.is_complaint) {
    fireOwnerNotification({
      type: "komplain",
      dedupKey: komplainDedupKey(conversation.id),
      message: buildKomplainMessage({
        displayName: conversation.display_name,
        phone: conversation.phone,
        category: payload.category ?? conversation.category,
        priority: payload.priority ?? conversation.priority,
      }),
    });
  }
}

/** Balasan Instagram; 409 bila jendela balas 24 jam Meta sudah lewat. */
async function replyInstagram(conversation: ConversationRow, message: string) {
  const { rows: lastInbound } = await getPool().query<{ at: string | null }>(
    `SELECT max(created_at) AS at
       FROM crm.wa_messages
      WHERE conversation_id = $1 AND direction = 'in'`,
    [conversation.id]
  );
  const lastInboundAt = lastInbound[0]?.at ? new Date(lastInbound[0].at) : null;
  // Dicegat di sini supaya agent mendapat alasan yang jelas, bukan galat
  // mentah dari Graph API setelah menulis panjang lebar.
  if (!isWithinReplyWindow(lastInboundAt, new Date())) {
    throw ApiError.conflict(
      "Jendela balas 24 jam Instagram sudah lewat. Tunggu pesan berikutnya dari pelanggan."
    );
  }

  const sent = await sendInstagramText(conversation.external_id, message);
  if (!sent.success) return { success: false, reason: sent.reason };

  // Balasan tidak lewat gateway WhatsApp, jadi dicatat lewat jalur sadar-kanal
  // yang sama. Meta juga memantulkan balasan sebagai echo; provider_message_id
  // unik membuat yang datang kedua diabaikan.
  await recordGatewayMessage({
    channel: "instagram",
    externalId: conversation.external_id,
    phone: null,
    direction: "out",
    body: message,
    mediaType: null,
    providerMessageId: sent.messageId ?? null,
    pushName: null,
    sentAt: new Date(),
  }).catch((error) => {
    // Pesan SUDAH terkirim; gagal mencatat tidak boleh membuat agent mengira
    // balasannya gagal lalu mengirim ulang.
    console.error("Balasan Instagram terkirim tetapi gagal dicatat:", error);
  });
  return { success: true, messageId: sent.messageId };
}

/** Kirim balasan lewat kanal percakapan; 502 bila kanal menolak. */
async function reply(conversation: ConversationRow, message: string, agentUserId: string) {
  const result: { success: boolean; reason?: string; messageId?: string | null } =
    conversation.channel === "instagram"
      ? await replyInstagram(conversation, message)
      : await sendWhatsAppText(
          { target: conversation.phone, message },
          { messageType: "chat", sentByUserId: agentUserId, conversationId: conversation.id }
        );
  if (!result.success) throw new ApiError(502, result.reason ?? "Gagal mengirim balasan");

  await onAgentReply(conversation.id, new Date());
  await getPool().query(
    `UPDATE crm.wa_conversations
        SET last_message_at = now(),
            last_message_preview = $2,
            status = CASE WHEN status IN ('open','resolved') THEN 'in_progress' ELSE status END,
            assigned_user_id = COALESCE(assigned_user_id, $3)
      WHERE id = $1`,
    [conversation.id, messagePreview(message, null), agentUserId]
  );
  return result.messageId;
}

// ── Template balasan cepat ─────────────────────────────────────────────────

export const replyTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(2000),
  is_active: z.boolean().default(true),
});

export async function listReplyTemplates() {
  const { rows } = await getPool().query(
    `SELECT id, title, body, is_active FROM crm.wa_reply_templates
      WHERE is_active ORDER BY title`
  );
  return rows;
}

/** Buat baru, atau perbarui bila `id` diisi (404 bila tidak ada). */
export async function saveReplyTemplate(payload: z.infer<typeof replyTemplateSchema>) {
  const pool = getPool();
  if (payload.id) {
    const { rows } = await pool.query(
      `UPDATE crm.wa_reply_templates
          SET title = $2, body = $3, is_active = $4
        WHERE id = $1 RETURNING id, title, body, is_active`,
      [payload.id, payload.title, payload.body, payload.is_active]
    );
    if (rows.length === 0) throw ApiError.notFound("Template tidak ditemukan");
    return rows[0];
  }
  const { rows } = await pool.query(
    `INSERT INTO crm.wa_reply_templates (title, body, is_active)
     VALUES ($1, $2, $3) RETURNING id, title, body, is_active`,
    [payload.title, payload.body, payload.is_active]
  );
  return rows[0];
}

export async function deleteReplyTemplate(id: string): Promise<void> {
  await getPool().query(`DELETE FROM crm.wa_reply_templates WHERE id = $1`, [id]);
}
