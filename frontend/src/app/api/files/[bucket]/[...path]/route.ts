import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/api/auth";
import { getMemberSession } from "@/lib/member-portal/session";
import { isWithinPrefix, safeSegments } from "@/lib/security/safe-path";
import { bucketAccess } from "@/lib/storage";

export const runtime = "nodejs";

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

// Ekstensi yang boleh disajikan; di luar ini → octet-stream + attachment
// (jangan pernah biarkan browser me-render html/svg dari origin app).
const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** "bytes=0-1023" / "bytes=1024-" → {start,end} dalam batas ukuran file. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const hasStart = m[1] !== "";
  const hasEnd = m[2] !== "";
  let start: number;
  let end: number;
  if (hasStart) {
    start = Number(m[1]);
    end = hasEnd ? Number(m[2]) : size - 1;
  } else if (hasEnd) {
    // suffix: N byte terakhir
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    return null;
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

/**
 * Boleh membaca file ini? Bucket publik terbuka; foto member hanya untuk
 * pemiliknya (sesi member) atau staf; sisanya wajib sesi staf.
 */
async function canRead(bucket: string, segments: string[]): Promise<boolean> {
  const access = bucketAccess(bucket);
  if (access === "public") return true;
  if (access === "member-owned") {
    const member = await getMemberSession().catch(() => null);
    if (member && segments.length > 1 && segments[0] === member.customerId) return true;
  }
  return Boolean(await getApiUser().catch(() => null));
}

/**
 * Penyaji file upload. Bucket publik (lihat bucketAccess di lib/storage)
 * disajikan anonim karena dipakai lintas konteks (dashboard, portal member,
 * halaman publik); bucket sensitif (CV/foto kandidat, foto member) wajib
 * sesi dan dikirim dengan Cache-Control private. Yang WAJIB untuk semua:
 * containment path (hasil security review — dulunya bisa traversal keluar
 * storage/uploads) dan nosniff.
 *
 * File di-STREAM (bukan dibaca penuh ke RAM) dan mendukung Range request,
 * supaya file besar / banyak request bersamaan tidak menggelembungkan memori
 * dan media/PDF bisa di-seek (audit performa 2026-09-17).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ bucket: string; path: string[] }> }
) {
  try {
    const { bucket, path: segments } = await params;
    // Segmen ditolak bila kosong, ".", "..", dotfile, atau memuat / \ NUL
    // setelah decode; hasil resolve tetap harus di dalam UPLOAD_ROOT.
    const safeBucket = safeSegments([bucket]);
    const safe = safeSegments(segments);
    if (!safeBucket || !safe) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    const abs = path.resolve(UPLOAD_ROOT, safeBucket[0], ...safe);
    if (!isWithinPrefix(abs, UPLOAD_ROOT)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (!(await canRead(safeBucket[0], safe))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const isPublic = bucketAccess(safeBucket[0]) === "public";

    const stat = await fs.stat(abs);
    if (!stat.isFile()) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const ext = path.extname(abs).slice(1).toLowerCase();
    const type = CONTENT_TYPES[ext];
    const baseHeaders: Record<string, string> = {
      "Content-Type": type ?? "application/octet-stream",
      ...(type ? {} : { "Content-Disposition": "attachment" }),
      "X-Content-Type-Options": "nosniff",
      // File sensitif tidak boleh disimpan cache bersama (CDN/proxy).
      "Cache-Control": isPublic ? "public, max-age=86400" : "private, max-age=300",
      ...(isPublic ? {} : { Vary: "Cookie, Authorization" }),
      "Accept-Ranges": "bytes",
    };

    const range = parseRange(request.headers.get("range"), stat.size);
    if (range) {
      const nodeStream = createReadStream(abs, { start: range.start, end: range.end });
      const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
      return new NextResponse(webStream, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
          "Content-Length": String(range.end - range.start + 1),
        },
      });
    }

    const nodeStream = createReadStream(abs);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      headers: { ...baseHeaders, "Content-Length": String(stat.size) },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
