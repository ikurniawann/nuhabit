import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/security/client-ip";
import { listChildren } from "@/lib/dataroom/nodes";
import { publicNode, resolveShareContext } from "@/lib/dataroom/api";
import { logShareAccess, touchShare } from "@/lib/dataroom/shares";

/**
 * GET /api/share/[token] — info link untuk halaman publik: nama, jenis,
 * langkah verifikasi yang masih kurang (email / PIN), dan bila sudah
 * terverifikasi: isi root (folder) atau meta file.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await resolveShareContext(request, token);
  if (!ctx.ok) return NextResponse.json({ success: false, error: ctx.error }, { status: ctx.status });
  const { share, root, session, steps, verified } = ctx;

  if (!session) {
    await touchShare(share.id);
    await logShareAccess({ shareId: share.id, action: "open", ip: clientIp(request), userAgent: request.headers.get("user-agent") });
  }

  return NextResponse.json({
    success: true,
    data: {
      name: root.name,
      kind: root.kind,
      access_type: share.access_type,
      requires_pin: Boolean(share.pin_hash),
      watermark: share.watermark,
      expires_at: share.expires_at,
      shared_by: share.created_by_name,
      steps,
      verified,
      email: session?.email ?? null,
      root: verified ? publicNode(root) : null,
      items: verified && root.kind === "folder" ? (await listChildren(root.id)).map(publicNode) : [],
    },
  });
}
