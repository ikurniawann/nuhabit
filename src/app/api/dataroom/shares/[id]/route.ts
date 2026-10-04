import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamAction, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getShareById, listShareLogs, revokeShare } from "@/lib/dataroom/shares";

/**
 * GET    /api/dataroom/shares/[id] — log akses link.
 * DELETE /api/dataroom/shares/[id] — cabut link (penerima langsung ditolak).
 */
export const GET = apiHandler(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await requireIamMenuPrefix(IAM.dataroom);
  const { id } = await params;
  const share = await getShareById(id);
  if (!share) throw ApiError.notFound("Link tidak ditemukan");
  return NextResponse.json({ success: true, data: { logs: await listShareLogs(id) } });
}, "dataroom.share.GET");

export const DELETE = apiHandler(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await requireIamAction(IAM.dataroom, "update");
  const { id } = await params;
  const share = await getShareById(id);
  if (!share) throw ApiError.notFound("Link tidak ditemukan");
  await revokeShare(id);
  return NextResponse.json({ success: true, data: { revoked: id } });
}, "dataroom.share.DELETE");
