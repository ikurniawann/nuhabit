// ============================================================
// GET /api/hris/announcements/cover/announcements/<file> — sajikan cover
// pengumuman dari storage private. Cukup akun login mana pun (pengumuman
// perusahaan bersifat internal; tidak ada data per-karyawan di cover).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { readPrivateFile } from "@/lib/storage-private";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { safeSegmentsUnder } from "@/lib/security/safe-path";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const actor = await getWorkforceActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Batasi ke folder announcements/ saja; segmen ".." / "%2F" ditolak
  const segments = safeSegmentsUnder((await params).path, "announcements");
  if (!segments) {
    return NextResponse.json({ error: "Path tidak valid" }, { status: 400 });
  }
  const relPath = segments.join("/");

  const { data, mime } = await readPrivateFile(relPath);
  if (!data) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": mime ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
