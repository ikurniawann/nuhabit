import { NextRequest, NextResponse } from "next/server";
import { readPrivateFile } from "@/lib/storage-private";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { safeSegmentsUnder } from "@/lib/security/safe-path";

/**
 * GET /api/hris/leaves/attachment/leave-attachments/<employeeId>/<file> —
 * sajikan lampiran cuti dari storage private. HR melihat semua; karyawan
 * hanya lampirannya sendiri.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const actor = await getWorkforceActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const segments = safeSegmentsUnder((await params).path, "leave-attachments", 3);
  if (!segments) {
    return NextResponse.json({ error: "Path tidak valid" }, { status: 400 });
  }
  if (!actor.isHr && actor.employeeId !== segments[1]) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, mime } = await readPrivateFile(segments.join("/"));
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
