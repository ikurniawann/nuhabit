import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

/**
 * Storage PRIVATE (EPIC-002): gambar tes proyektif & snapshot proctoring.
 * Berbeda dgn `storage.ts` (storage/uploads) yang disajikan publik tanpa auth
 * via /api/files — file di sini berada di storage/private dan hanya bisa
 * diakses lewat route ber-auth (mis. /api/psikotes/files).
 */

const PRIVATE_ROOT = path.join(process.cwd(), "storage", "private");

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function isAllowedImageMime(mime: string): boolean {
  return mime in EXT_BY_MIME;
}

/** Audio interview AI: rekaman jawaban kandidat (MediaRecorder) & TTS mp3. */
const AUDIO_EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "video/webm": "webm", // sebagian browser melabeli rekaman audio-only sbg video/webm
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
};

/**
 * Deteksi tipe audio dari magic bytes — MIME klaim client bisa dipalsukan.
 * webm (EBML), ogg (OggS), mp3 (ID3 / frame sync), mp4/m4a (ftyp).
 */
export function sniffAudioMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "audio/webm";
  if (buffer.subarray(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (buffer.subarray(0, 3).toString("ascii") === "ID3") return "audio/mpeg";
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") return "audio/mp4";
  return null;
}

/**
 * Simpan buffer audio; ekstensi dari hasil sniff magic bytes.
 * Return path relatif thd storage/private.
 */
export async function savePrivateAudio(
  buffer: Buffer,
  folder: string
): Promise<{ path: string | null; error: string | null }> {
  try {
    const sniffed = sniffAudioMime(buffer);
    if (!sniffed) {
      return { path: null, error: "Isi file bukan audio webm/ogg/mp3/m4a yang valid" };
    }
    const ext = AUDIO_EXT_BY_MIME[sniffed];
    const safeFolder = folder.replace(/[^a-zA-Z0-9/_-]/g, "");
    const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
    const rel = path.posix.join(safeFolder, name);
    const abs = path.resolve(PRIVATE_ROOT, rel);
    if (!abs.startsWith(PRIVATE_ROOT + path.sep)) {
      return { path: null, error: "Path tidak valid" };
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buffer);
    return { path: rel, error: null };
  } catch (err) {
    return { path: null, error: err instanceof Error ? err.message : "Gagal menyimpan file" };
  }
}

/** Dokumen kontrak bertanda tangan (EPIC-006): PDF atau hasil scan gambar. */
const DOC_EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  ...EXT_BY_MIME,
};

/** Deteksi PDF dari magic bytes (%PDF-). */
export function sniffDocumentMime(buffer: Buffer): string | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  return sniffImageMime(buffer);
}

/**
 * Simpan dokumen (PDF/JPG/PNG/WebP); tipe & ekstensi murni dari sniff magic
 * bytes — MIME klaim client (File.type) sengaja diabaikan karena bisa kosong/
 * salah dari sebagian OS picker. Return path relatif thd storage/private.
 */
export async function savePrivateDocument(
  buffer: Buffer,
  folder: string
): Promise<{ path: string | null; error: string | null }> {
  try {
    const sniffed = sniffDocumentMime(buffer);
    if (!sniffed) {
      return { path: null, error: "Isi file bukan PDF/JPG/PNG/WebP yang valid" };
    }
    const ext = DOC_EXT_BY_MIME[sniffed];
    const safeFolder = folder.replace(/[^a-zA-Z0-9/_-]/g, "");
    const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
    const rel = path.posix.join(safeFolder, name);
    const abs = path.resolve(PRIVATE_ROOT, rel);
    if (!abs.startsWith(PRIVATE_ROOT + path.sep)) {
      return { path: null, error: "Path tidak valid" };
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buffer);
    return { path: rel, error: null };
  } catch (err) {
    return { path: null, error: err instanceof Error ? err.message : "Gagal menyimpan file" };
  }
}

/**
 * Deteksi tipe gambar dari magic bytes — MIME yang diklaim client bisa
 * dipalsukan, jadi isi buffer yang menentukan.
 */
export function sniffImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP")
    return "image/webp";
  return null;
}

/**
 * Simpan buffer gambar; ekstensi diambil dari hasil sniff magic bytes
 * (bukan MIME klaim client). Return path relatif thd storage/private.
 */
export async function savePrivateImage(
  buffer: Buffer,
  declaredMime: string,
  folder: string
): Promise<{ path: string | null; error: string | null }> {
  try {
    const sniffed = sniffImageMime(buffer);
    if (!sniffed || !isAllowedImageMime(declaredMime)) {
      return { path: null, error: "Isi file bukan gambar JPG/PNG/WebP yang valid" };
    }
    const ext = EXT_BY_MIME[sniffed];
    // folder dari kode kita sendiri (bukan input user) — tetap dinormalisasi
    const safeFolder = folder.replace(/[^a-zA-Z0-9/_-]/g, "");
    const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
    const rel = path.posix.join(safeFolder, name);
    const abs = path.resolve(PRIVATE_ROOT, rel);
    if (!abs.startsWith(PRIVATE_ROOT + path.sep)) {
      return { path: null, error: "Path tidak valid" };
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buffer);
    return { path: rel, error: null };
  } catch (err) {
    return { path: null, error: err instanceof Error ? err.message : "Gagal menyimpan file" };
  }
}

/**
 * Append potongan rekaman video interview (MediaRecorder chunked webm).
 * Chunk pertama sebuah part wajib ber-magic EBML (header webm); chunk
 * lanjutan berupa binary bebas (kelanjutan container yang sama).
 * Return ukuran file setelah append (utk penegakan kuota di caller).
 */
export async function appendPrivateChunk(
  relPath: string,
  buffer: Buffer,
  maxBytes: number
): Promise<{ size: number | null; error: string | null }> {
  try {
    const abs = path.resolve(PRIVATE_ROOT, relPath);
    if (!abs.startsWith(PRIVATE_ROOT + path.sep)) return { size: null, error: "Path tidak valid" };
    let currentSize = 0;
    try {
      currentSize = (await fs.stat(abs)).size;
    } catch {
      // file belum ada → chunk pertama wajib header webm (EBML)
      if (!buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
        return { size: null, error: "Chunk pertama bukan webm valid" };
      }
    }
    if (currentSize + buffer.length > maxBytes) {
      return { size: null, error: "Kuota rekaman sesi tercapai" };
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.appendFile(abs, buffer);
    return { size: currentSize + buffer.length, error: null };
  } catch (err) {
    return { size: null, error: err instanceof Error ? err.message : "Gagal menyimpan chunk" };
  }
}

/** Daftar file dalam satu folder private (nama + ukuran), utk daftar rekaman. */
export async function listPrivateFiles(
  relDir: string
): Promise<{ name: string; size: number; modified_at: string }[]> {
  const abs = path.resolve(PRIVATE_ROOT, relDir);
  if (!abs.startsWith(PRIVATE_ROOT + path.sep)) return [];
  try {
    const names = await fs.readdir(abs);
    const out: { name: string; size: number; modified_at: string }[] = [];
    for (const name of names) {
      const stat = await fs.stat(path.join(abs, name)).catch(() => null);
      if (stat?.isFile()) {
        out.push({ name, size: stat.size, modified_at: stat.mtime.toISOString() });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Hapus file private (best-effort, mis. saat re-upload menimpa attachment lama). */
export async function deletePrivateFile(relPath: string): Promise<void> {
  const abs = path.resolve(PRIVATE_ROOT, relPath);
  if (!abs.startsWith(PRIVATE_ROOT + path.sep)) return;
  await fs.unlink(abs).catch(() => undefined);
}

/**
 * Hapus satu folder private rekursif (best-effort) — retensi: dipanggil saat
 * kandidat dihapus supaya gambar tes & snapshot proctoring tidak tertinggal.
 */
export async function deletePrivateFolder(relDir: string): Promise<void> {
  const abs = path.resolve(PRIVATE_ROOT, relDir);
  if (!abs.startsWith(PRIVATE_ROOT + path.sep)) return;
  await fs.rm(abs, { recursive: true, force: true }).catch(() => undefined);
}

/** Baca file private; menolak path traversal. */
export async function readPrivateFile(
  relPath: string
): Promise<{ data: Buffer | null; mime: string | null }> {
  const abs = path.resolve(PRIVATE_ROOT, relPath);
  if (!abs.startsWith(PRIVATE_ROOT + path.sep)) return { data: null, mime: null };
  try {
    const data = await fs.readFile(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    const mime =
      Object.entries(DOC_EXT_BY_MIME).find(([, e]) => e === ext || (e === "jpg" && ext === "jpeg"))?.[0] ??
      Object.entries(AUDIO_EXT_BY_MIME).find(([m, e]) => e === ext && m.startsWith("audio/"))?.[0] ??
      "application/octet-stream";
    return { data, mime };
  } catch {
    return { data: null, mime: null };
  }
}
