import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getPool } from "@/lib/db";
import { requireCrmUser } from "@/lib/crm/guards";
import {
  MAX_PENDING_LIMIT,
  analyzeConversation,
  analyzePending,
  getStoredInsight,
} from "@/lib/crm/conversation-insights-server";

/**
 * EPIC-029 — analisa percakapan inbox dengan AI (ringkasan + kata kunci).
 *
 * Gate menu inbox karena respons memuat `summary` yang menyarikan isi chat —
 * PII. Laporan agregat bebas PII hidup di `/api/crm/reports/conversations`,
 * dengan gate laporan yang berbeda.
 */

const bodySchema = z.union([
  z.object({ conversation_id: z.string().uuid(), force: z.boolean().optional() }),
  z.object({
    analyze_pending: z.literal(true),
    limit: z.number().int().positive().max(MAX_PENDING_LIMIT).optional(),
  }),
]);

/** Baca insight tersimpan satu percakapan — tanpa memanggil OpenAI. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("inbox");
  const conversationId = request.nextUrl.searchParams.get("conversation_id");
  if (!conversationId) throw ApiError.badRequest("Parameter conversation_id wajib diisi");
  const insight = await getStoredInsight(getPool(), conversationId);
  return NextResponse.json({ success: true, data: { insight } });
}, "crm.inbox.analytics.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("inbox");
  const parsed = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    throw ApiError.badRequest("Body tidak valid (kirim {conversation_id} atau {analyze_pending:true, limit?})");
  }
  const payload = parsed.data;
  const pool = getPool();

  if ("analyze_pending" in payload) {
    return NextResponse.json({ success: true, data: await analyzePending(pool, { limit: payload.limit }) });
  }

  const result = await analyzeConversation(pool, payload.conversation_id, { force: payload.force });
  // Kegagalan analisa BUKAN error server: percakapannya ada, hanya AI-nya yang
  // tidak menjawab. 502 supaya UI bisa membedakannya dari bug/izin.
  const status = result.status === "failed" ? 502 : 200;
  return NextResponse.json({ success: result.status !== "failed", data: result }, { status });
}, "crm.inbox.analytics.POST");
