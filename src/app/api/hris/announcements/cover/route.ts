// ============================================================
// API Route: Upload Cover Pengumuman
// POST — pengelola upload gambar cover (JPG/PNG/WebP ≤ 5MB) ke storage
//        private. Return path utk disimpan di announcements.cover_image_url;
//        disajikan via GET /api/hris/announcements/cover/[...path] (ber-auth).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { savePrivateImage } from "@/lib/storage-private";
import { ANNOUNCEMENT_MANAGE_ROLES } from "@/lib/hris/announcements";

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const body = (await req.json()) as { image?: string };

    const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(body.image ?? "");
    if (!match) {
      return NextResponse.json(
        { error: "Cover harus berupa gambar JPG/PNG/WebP" },
        { status: 400 }
      );
    }
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json({ error: "Ukuran cover maksimal 5 MB" }, { status: 400 });
    }

    const saved = await savePrivateImage(buffer, match[1], "announcements");
    if (!saved.path) {
      return NextResponse.json(
        { error: saved.error ?? "Gagal menyimpan cover" },
        { status: 400 }
      );
    }

    return NextResponse.json({ data: { path: saved.path } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error uploading announcement cover:", error);
    return NextResponse.json({ error: "Gagal mengunggah cover" }, { status: 500 });
  }
}
