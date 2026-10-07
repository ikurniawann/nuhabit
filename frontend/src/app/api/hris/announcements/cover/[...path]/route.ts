import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { readPrivateFile } from "@/lib/storage-private";
import { safeSegmentsUnder } from "@/lib/security/safe-path";
import { requireWorkforceActor } from "@/lib/hris/workforce-route";

/**
 * GET /api/hris/announcements/cover/announcements/<file> — sajikan cover dari
 * storage private. Cukup akun login (cover tidak memuat data per-karyawan).
 */
export const GET = apiHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) => {
    await requireWorkforceActor();
    // hanya folder announcements/; segmen ".." / "%2F" ditolak
    const segments = safeSegmentsUnder((await params).path, "announcements");
    if (!segments) throw ApiError.badRequest("Path tidak valid");

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
  "hris/announcements/cover GET"
);
