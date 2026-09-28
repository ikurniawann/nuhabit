import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { decodeImageSource } from "@/lib/gobiz/image";

export const runtime = "nodejs";

/**
 * GET /api/public/gofood-image/<base64url sumber>.jpg — foto produk dalam
 * JPEG untuk katalog GoFood (GoBiz menolak WebP). Publik karena diambil
 * server GoBiz. Hanya membaca berkas lokal kita sendiri (public/products,
 * storage/uploads) dengan pemeriksaan containment — tidak pernah fetch URL luar.
 */

const PUBLIC_ROOT = path.join(process.cwd(), "public");
const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 1200;

function resolveSource(src: string): string | null {
  const [root, rel] = src.startsWith("/products/")
    ? [PUBLIC_ROOT, src.slice(1)]
    : [UPLOAD_ROOT, src.slice("/api/files/".length)];
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  // "%2e%2e" lolos cek ".." di token, jadi diperiksa ulang setelah decode.
  if (decoded.includes("..") || decoded.includes("\\")) return null;
  const abs = path.resolve(root, decoded);
  return abs.startsWith(root + path.sep) ? abs : null;
}

function notFound() {
  return NextResponse.json({ error: "Gambar tidak ditemukan" }, { status: 404 });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const match = /^([A-Za-z0-9_-]+)\.jpg$/.exec(String(file || ""));
  const src = match ? decodeImageSource(match[1]) : null;
  const abs = src ? resolveSource(src) : null;
  if (!abs) return notFound();

  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) return notFound();
    const jpeg = await sharp(await fs.readFile(abs))
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    return new NextResponse(new Uint8Array(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}
