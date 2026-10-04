import { NextRequest, NextResponse } from "next/server";
import { readPrivateFile } from "@/lib/storage-private";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { safeSegmentsUnder } from "@/lib/security/safe-path";

/**
 * GET /api/hris/attendance/photo/attendance/<employeeId>/<file> — sajikan
 * selfie absensi dari storage private. HR melihat semua; karyawan hanya
 * fotonya sendiri (segment employeeId pada path).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const actor = await getWorkforceActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const segments = safeSegmentsUnder((await params).path, "attendance", 3);
  if (!segments) {
    return NextResponse.json({ error: "Path tidak valid" }, { status: 400 });
  }
  const relPath = segments.join("/");
  const ownerEmployeeId = segments[1];
  if (!actor.isHr && actor.employeeId !== ownerEmployeeId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
