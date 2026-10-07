import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import { Readable } from "stream";
import { sniffDocumentMime } from "@/lib/storage-private";
import {
  DATAROOM_STORAGE_PREFIX,
  extensionForStorage,
  mimeFromExtension,
} from "@/lib/dataroom/config";

/**
 * File Dataroom di storage/private/dataroom/YYYY/MM/<acak>.<ext> — tidak
 * pernah disajikan tanpa auth (dashboard) atau sesi link berbagi yang sah.
 */
const PRIVATE_ROOT = path.join(process.cwd(), "storage", "private");

function absFor(rel: string): string | null {
  if (!rel.startsWith(`${DATAROOM_STORAGE_PREFIX}/`)) return null;
  const abs = path.resolve(PRIVATE_ROOT, rel);
  return abs.startsWith(PRIVATE_ROOT + path.sep) ? abs : null;
}

/** MIME akhir: sniff isi (PDF/gambar) > ekstensi nama > klaim klien (dibersihkan). */
export function resolveMime(buffer: Buffer, originalName: string, claimed: string | null | undefined): string {
  const sniffed = sniffDocumentMime(buffer);
  if (sniffed) return sniffed;
  const byExt = mimeFromExtension(originalName);
  if (byExt) return byExt;
  const c = String(claimed ?? "").trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(c) ? c.slice(0, 150) : "application/octet-stream";
}

export async function saveDataroomFile(
  buffer: Buffer,
  originalName: string,
  claimedMime?: string | null
): Promise<{ path: string; mime: string; size: number }> {
  const mime = resolveMime(buffer, originalName, claimedMime);
  const ext = extensionForStorage(mime, originalName);
  const now = new Date();
  const rel = path.posix.join(
    DATAROOM_STORAGE_PREFIX,
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    `${crypto.randomBytes(12).toString("hex")}.${ext}`
  );
  const abs = absFor(rel);
  if (!abs) throw new Error("Path storage tidak valid");
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buffer);
  return { path: rel, mime, size: buffer.length };
}

export async function readDataroomFile(rel: string): Promise<Buffer | null> {
  const abs = absFor(rel);
  if (!abs) return null;
  return fsp.readFile(abs).catch(() => null);
}

/** Stream untuk file besar tanpa watermark. */
export async function openDataroomStream(rel: string): Promise<{ stream: ReadableStream; size: number } | null> {
  const abs = absFor(rel);
  if (!abs) return null;
  const stat = await fsp.stat(abs).catch(() => null);
  if (!stat?.isFile()) return null;
  const nodeStream = fs.createReadStream(abs);
  return { stream: Readable.toWeb(nodeStream) as ReadableStream, size: stat.size };
}

export async function deleteDataroomFiles(rels: (string | null | undefined)[]): Promise<void> {
  for (const rel of rels) {
    if (!rel) continue;
    const abs = absFor(rel);
    if (abs) await fsp.unlink(abs).catch(() => undefined);
  }
}
