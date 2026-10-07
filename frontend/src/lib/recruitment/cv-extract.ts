import fs from "fs/promises";
import path from "path";

/**
 * Ekstraksi teks dari file CV di storage lokal.
 * - PDF   → unpdf (pdfjs)
 * - DOCX  → mammoth
 * - JPG/PNG → tesseract.js (OCR)
 * Semua lib di-lazy-import supaya tidak membebani cold start route lain.
 */

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

/** Resolve cv_url (/api/files/{bucket}/{path}) → path absolut di disk. */
export function cvUrlToDiskPath(cvUrl: string): string | null {
  const m = cvUrl.match(/\/api\/files\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const bucket = decodeURIComponent(m[1]);
  const rel = m[2].split("/").map(decodeURIComponent).join("/");
  const abs = path.resolve(path.join(UPLOAD_ROOT, bucket, rel));
  // guard path traversal
  if (!abs.startsWith(path.resolve(UPLOAD_ROOT))) return null;
  return abs;
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const { extractText } = await import("unpdf");
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  return typeof text === "string" ? text : String(text ?? "");
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

const OCR_TIMEOUT_MS = 120_000; // first run download language data, kasih ruang

async function extractImage(filePath: string): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  // ind+eng: CV di Indonesia umumnya campuran dua bahasa
  const worker = await createWorker(["ind", "eng"]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      worker.recognize(filePath),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("OCR timeout — file terlalu besar/kompleks")),
          OCR_TIMEOUT_MS
        );
      }),
    ]);
    return result.data.text;
  } finally {
    if (timer) clearTimeout(timer);
    await worker.terminate();
  }
}

export interface CvExtractionResult {
  text: string;
  method: "pdf" | "docx" | "ocr";
}

export async function extractCvText(cvUrl: string): Promise<CvExtractionResult> {
  const diskPath = cvUrlToDiskPath(cvUrl);
  if (!diskPath) throw new Error("URL CV tidak valid");

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(diskPath);
  } catch {
    throw new Error("File CV tidak ditemukan di storage");
  }

  const ext = path.extname(diskPath).toLowerCase();
  let text: string;
  let method: CvExtractionResult["method"];

  if (ext === ".pdf") {
    text = await extractPdf(buffer);
    method = "pdf";
    // PDF hasil scan (tanpa text layer) → fallback ke OCR
    if (text.trim().length < 40) {
      try {
        text = await extractImage(diskPath);
        method = "ocr";
      } catch {
        // biarkan hasil pdf apa adanya
      }
    }
  } else if (ext === ".docx" || ext === ".doc") {
    text = await extractDocx(buffer);
    method = "docx";
  } else if ([".jpg", ".jpeg", ".png"].includes(ext)) {
    text = await extractImage(diskPath);
    method = "ocr";
  } else {
    throw new Error(`Format CV tidak didukung untuk ekstraksi: ${ext}`);
  }

  const cleaned = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned) throw new Error("Tidak ada teks yang bisa diekstrak dari CV");
  return { text: cleaned, method };
}
