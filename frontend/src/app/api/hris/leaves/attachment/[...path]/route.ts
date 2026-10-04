import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireWorkforceActor } from "@/lib/hris/workforce-route";
import { safeSegmentsUnder } from "@/lib/security/safe-path";
import { readPrivateFile } from "@/lib/storage-private";

/**
 * GET /api/hris/leaves/attachment/leave-attachments/<employeeId>/<file> , 
 * sajikan lampiran cuti dari storage private. HR melihat semua; karyawan
 * hanya lampirannya sendiri.
 */
export const GET = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) => {
    const actor = await requireWorkforceActor();
    const segments = safeSegmentsUnder((await params).path, "leave-attachments", 3);
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
  "hris/leaves/attachment/[...path].GET"
);
