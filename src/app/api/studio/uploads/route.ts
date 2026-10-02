import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { sniffImageMime } from "@/lib/storage-private";
import { uploadFile } from "@/lib/storage";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Upload gambar studio (foto coach, gambar News Hyrox) → URL publik untuk
 * Member App. Jenis ditentukan isi file (JPG/PNG/WebP), bukan MIME klaim browser.
 */
export async function POST(request: NextRequest) {
  return studioRoute("studio upload", async () => {
    await requireStudioContext();
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) throw ApiError.badRequest("Pilih file gambar dulu");
    if (file.size > MAX_BYTES) throw ApiError.badRequest("Gambar maksimal 5 MB");
    if (!sniffImageMime(Buffer.from(await file.arrayBuffer()))) throw ApiError.badRequest("File harus gambar JPG, PNG, atau WebP");
    const { url, error } = await uploadFile("studio-media", file);
    if (error || !url) throw new Error(error || "Upload gagal");
    return NextResponse.json({ success: true, data: { url } });
  });
}
