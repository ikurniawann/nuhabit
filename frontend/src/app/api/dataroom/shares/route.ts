import { NextRequest, NextResponse } from "next/server";
import { OTP_ENABLED, OTP_UNAVAILABLE_MESSAGE } from "@/lib/otp-availability";
import { z } from "zod";
import { ApiError, requireIamAction, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { DATAROOM_MAX_EXPIRY_DAYS, computeExpiry, normalizeEmails } from "@/lib/dataroom/config";
import { getNode } from "@/lib/dataroom/nodes";
import { createShare, listShares } from "@/lib/dataroom/shares";
import { sendShareLink, shareUrl } from "@/lib/dataroom/mail";
import { createAccessResolver, resolveActor } from "@/lib/dataroom/access";

/**
 * GET  /api/dataroom/shares?node_id=  — daftar link (semua bila tanpa node_id).
 * POST /api/dataroom/shares — buat link: publik / email tertentu, PIN opsional,
 *      watermark, masa aktif (hari), opsi kirim email ke penerima.
 */
/** Baris share untuk klien: hash PIN diganti flag `has_pin`, plus URL publik. */
function toShareDto<T extends { pin_hash: string | null; token: string }>({ pin_hash, ...row }: T) {
  return { ...row, has_pin: Boolean(pin_hash), url: shareUrl(row.token) };
}

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.dataroom);
  const nodeId = request.nextUrl.searchParams.get("node_id") || null;
  const access = await createAccessResolver(await resolveActor(user));
  const rows = (await listShares(nodeId)).filter((r) =>
    access.allows({ id: r.node_id, parent_id: r.node_parent_id, kind: r.node_kind })
  );
  return NextResponse.json({ success: true, data: rows.map(toShareDto) });
}, "dataroom.shares.GET");

const createSchema = z.object({
  node_id: z.string().uuid(),
  access_type: z.enum(["public", "email"]),
  emails: z.array(z.string()).optional().default([]),
  pin: z.string().regex(/^\d{4,6}$/, "PIN harus 4–6 digit angka").nullable().optional(),
  watermark: z.boolean().optional().default(false),
  expires_days: z.number().int().min(1).max(DATAROOM_MAX_EXPIRY_DAYS).optional().default(7),
  send_email: z.boolean().optional().default(false),
});

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamAction(IAM.dataroom, "create");
  const body = await validateBody(request, createSchema);
  if (body.access_type === "email" && !OTP_ENABLED) throw ApiError.badRequest(OTP_UNAVAILABLE_MESSAGE);
  const node = await getNode(body.node_id);
  if (!node) throw ApiError.notFound("Item tidak ditemukan");
  const access = await createAccessResolver(await resolveActor(user));
  if (!access.allows(node)) throw ApiError.forbidden("Item ini tidak dibuka untuk departemen Anda");
  const emails = normalizeEmails(body.emails);
  if (body.access_type === "email" && emails.length === 0) {
    throw ApiError.badRequest("Isi minimal satu email penerima yang valid");
  }
  const expiresAt = computeExpiry(body.expires_days);
  const share = await createShare({
    nodeId: node.id, accessType: body.access_type,
    allowedEmails: body.access_type === "email" ? emails : [],
    pin: body.pin || null, watermark: body.watermark, expiresAt,
    userId: user.id, userName: user.full_name,
  });
  let mail: { sent: number; failed: string[] } | null = null;
  if (body.send_email && emails.length > 0) {
    mail = await sendShareLink({
      emails, shareName: node.name, kind: node.kind, token: share.token,
      senderName: user.full_name, expiresAt, hasPin: Boolean(body.pin),
    });
  }
  return NextResponse.json(
    { success: true, data: { ...toShareDto(share), node_name: node.name, node_kind: node.kind, access_count: 0, mail } },
    { status: 201 }
  );
}, "dataroom.shares.POST");
