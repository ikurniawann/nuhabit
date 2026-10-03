import { NextRequest, NextResponse } from "next/server";
import { clientIp, nodeWithinShare, resolveShareContext, serveNodeFile } from "@/lib/dataroom/api";
import { logShareAccess } from "@/lib/dataroom/shares";
import { buildWatermarkText } from "@/lib/dataroom/watermark";

/**
 * GET /api/share/[token]/files/[nodeId]?download=1 — sajikan file lewat link
 * berbagi; watermark (email penerima / label + tanggal) bila diaktifkan.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string; nodeId: string }> }) {
  const { token, nodeId } = await params;
  const ctx = await resolveShareContext(request, token);
  if (!ctx.ok) return NextResponse.json({ success: false, error: ctx.error }, { status: ctx.status });
  if (!ctx.verified) return NextResponse.json({ success: false, error: "Verifikasi dulu" }, { status: 401 });
  const node = await nodeWithinShare(nodeId, ctx.share);
  if (!node || node.kind !== "file") return NextResponse.json({ success: false, error: "File tidak ditemukan" }, { status: 404 });
  const download = request.nextUrl.searchParams.get("download") === "1";
  await logShareAccess({
    shareId: ctx.share.id, nodeId: node.id, action: download ? "download" : "view", fileName: node.name,
    email: ctx.session?.email ?? null, ip: clientIp(request), userAgent: request.headers.get("user-agent"),
  });
  const watermarkText = ctx.share.watermark
    ? buildWatermarkText({ label: ctx.session?.email || `Dibagikan oleh ${ctx.share.created_by_name ?? "NüHabit"}` })
    : null;
  return serveNodeFile(node, { inline: !download, watermarkText });
}
