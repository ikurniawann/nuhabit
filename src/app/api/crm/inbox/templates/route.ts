import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmUser } from "@/lib/crm/guards";
import {
  deleteReplyTemplate,
  listReplyTemplates,
  replyTemplateSchema,
  saveReplyTemplate,
} from "@/lib/crm/inbox-server";

/**
 * EPIC-012 Fase C — template balasan cepat.
 * Baca: semua agent inbox. Kelola (buat/hapus): menu pengaturan CRM.
 */

export const GET = apiHandler(async () => {
  await requireCrmUser("inbox");
  return NextResponse.json({ success: true, data: await listReplyTemplates() });
}, "crm.inbox.templates.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("settings");
  const parsed = replyTemplateSchema.safeParse(await request.json());
  if (!parsed.success) throw ApiError.badRequest("Payload tidak valid");
  return NextResponse.json({ success: true, data: await saveReplyTemplate(parsed.data) });
}, "crm.inbox.templates.POST");

export const DELETE = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("settings");
  const id = request.nextUrl.searchParams.get("id");
  if (!id) throw ApiError.badRequest("Template id wajib diisi");
  await deleteReplyTemplate(id);
  return NextResponse.json({ success: true });
}, "crm.inbox.templates.DELETE");
