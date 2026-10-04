import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { readPrivateFile } from "@/lib/storage-private";

/**
 * Penyaji arsip nota vendor (storage/private/purchasing-receipts). Berbeda
 * dengan /api/files (publik): nota keuangan wajib lewat route ber-auth ini.
 */
export const GET = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) => {
    await requireIamMenuPrefix(IAM.items);
    const { path: segments } = await params;

    const decoded = segments.map(decodeURIComponent);
    if (decoded.some((s) => s.includes("..") || s.startsWith(".") || s.includes("\\"))) {
      throw ApiError.notFound("File tidak ditemukan");
    }

    // readPrivateFile sudah menolak traversal; prefix folder dikunci di sini.
    const { data, mime } = await readPrivateFile(["purchasing-receipts", ...decoded].join("/"));
    if (!data) throw ApiError.notFound("File tidak ditemukan");

    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": mime ?? "application/octet-stream",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  },
  "purchasing.receipts"
);
