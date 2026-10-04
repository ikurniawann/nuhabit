import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { readPrivateFile } from "@/lib/storage-private";
import { safeSegmentsUnder } from "@/lib/security/safe-path";
import { requireWorkforceActor } from "@/lib/hris/workforce-route";

/**
 * GET /api/hris/attendance/photo/attendance/<employeeId>/<file> — sajikan
 * selfie absensi dari storage private. HR melihat semua; karyawan hanya
 * fotonya sendiri (segment employeeId pada path).
 */
export const GET = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) => {
    const actor = await requireWorkforceActor();
    const segments = safeSegmentsUnder((await params).path, "attendance", 3);
    if (!segments) throw ApiError.badRequest("Path tidak valid");
    if (!actor.isHr && actor.employeeId !== segments[1]) throw ApiError.forbidden("Forbidden");

    const { data, mime } = await readPrivateFile(segments.join("/"));
    if (!data) throw ApiError.notFound("File tidak ditemukan");
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": mime ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  },
  "hris/attendance/photo GET"
);
