import { NextRequest, NextResponse } from "next/server";
import { getAncestors, listChildren } from "@/lib/dataroom/nodes";
import { nodeWithinShare, publicNode, resolveShareContext } from "@/lib/dataroom/api";

/** GET /api/share/[token]/list?folder=<id> — isi subfolder (harus di bawah root share). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await resolveShareContext(request, token);
  if (!ctx.ok) return NextResponse.json({ success: false, error: ctx.error }, { status: ctx.status });
  if (!ctx.verified) return NextResponse.json({ success: false, error: "Verifikasi dulu", data: { steps: ctx.steps } }, { status: 401 });
  const folderId = request.nextUrl.searchParams.get("folder") || ctx.root.id;
  const folder = await nodeWithinShare(folderId, ctx.share);
  if (!folder || folder.kind !== "folder") return NextResponse.json({ success: false, error: "Folder tidak ditemukan" }, { status: 404 });
  const ancestors = (await getAncestors(folder.id));
  const rootIdx = ancestors.findIndex((a) => a.id === ctx.root.id);
  return NextResponse.json({
    success: true,
    data: {
      folder: publicNode(folder),
      ancestors: ancestors.slice(rootIdx).map((a) => ({ id: a.id, name: a.name })),
      items: (await listChildren(folder.id)).map(publicNode),
    },
  });
}
