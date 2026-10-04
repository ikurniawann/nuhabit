import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getPool } from "@/lib/db";
import { sendWhatsAppText } from "@/lib/whatsapp";

/**
 * EPIC-012 Fase A — riwayat pesan WhatsApp (siapa penerimanya, statusnya).
 * super_admin only: berisi nomor & isi pesan customer (PII).
 */

const requireSuperAdmin = () => requireApiRole(["super_admin"]);

export const GET = apiHandler(async (request: NextRequest) => {
  await requireSuperAdmin();
  const params = request.nextUrl.searchParams;
  const direction = params.get("direction");
  const messageType = params.get("type");
  const status = params.get("status");
  const search = params.get("search")?.trim();
  const rawLimit = params.get("limit");
  const parsedLimit = Number(rawLimit);
  const limit =
    rawLimit !== null && Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 200)
      : 100;

  const values: unknown[] = [];
  const filters: string[] = [];

  if (direction === "in" || direction === "out") {
    values.push(direction);
    filters.push(`m.direction = $${values.length}`);
  }
  if (messageType && messageType !== "all") {
    values.push(messageType);
    filters.push(`m.message_type = $${values.length}`);
  }
  if (status && status !== "all") {
    values.push(status);
    filters.push(`m.status = $${values.length}`);
  }
  if (search) {
    values.push(`%${search.replace(/[%_]/g, "")}%`);
    filters.push(
      `(m.phone LIKE $${values.length} OR c.name ILIKE $${values.length})`,
    );
  }
  values.push(limit);

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT m.id, m.direction, m.message_type, m.phone, m.body, m.media_type,
            m.status, m.provider, m.provider_message_id, m.error_reason,
            m.wa_from_me, m.created_at,
            c.name AS customer_name
       FROM crm.wa_messages m
       LEFT JOIN pos.pos_customers c ON c.id = m.customer_id
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY m.created_at DESC
      LIMIT $${values.length}`,
    values,
  );

  const { rows: summary } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE direction = 'out')::int AS total_out,
            COUNT(*) FILTER (WHERE direction = 'in')::int AS total_in,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS total_failed
       FROM crm.wa_messages`,
  );

  return NextResponse.json({
    success: true,
    data: { messages: rows, summary: summary[0] },
  });
}, "GET /api/settings/wa-gateway/messages");

const resendSchema = z.object({ id: z.string().uuid() });

/** Kirim ulang pesan yang gagal. OTP dikecualikan — kodenya sudah basi. */
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireSuperAdmin();
  const parsed = resendSchema.safeParse(await request.json());
  if (!parsed.success) throw ApiError.badRequest("Payload tidak valid");
  const payload = parsed.data;
  const pool = getPool();

  const { rows } = await pool.query(
    `SELECT id, phone, body, message_type, status, conversation_id
       FROM crm.wa_messages WHERE id = $1 AND direction = 'out'`,
    [payload.id],
  );
  const original = rows[0];
  if (!original) {
    throw ApiError.notFound("Pesan tidak ditemukan");
  }
  if (original.status !== "failed") {
    throw ApiError.conflict(
      "Hanya pesan berstatus gagal yang bisa dikirim ulang",
    );
  }
  if (original.message_type === "otp" || !original.body) {
    throw ApiError.conflict(
      "OTP tidak bisa dikirim ulang — minta member request ulang dari portal",
    );
  }

  const result = await sendWhatsAppText(
    { target: original.phone, message: original.body },
    {
      messageType: original.message_type,
      sentByUserId: user.id,
      conversationId: original.conversation_id,
    },
  );

  if (!result.success) {
    throw new ApiError(502, result.reason ?? "Pengiriman ulang gagal");
  }

  // Tandai baris asal supaya tidak bisa dikirim ulang berkali-kali
  // (temuan review M2 — spam ke customer). Kiriman baru tercatat sbg baris baru.
  await pool.query(
    `UPDATE crm.wa_messages
        SET status = 'sent', error_reason = 'Dikirim ulang manual — lihat baris terbaru'
      WHERE id = $1`,
    [original.id],
  );

  return NextResponse.json({
    success: true,
    data: { messageId: result.messageId },
  });
}, "POST /api/settings/wa-gateway/messages");
