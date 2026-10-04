/**
 * Ekstraksi teks dari lampiran (EPIC-018).
 *
 * Generik dan bebas modul: dipakai chat Do sekarang, disiapkan untuk purchasing
 * (scan nota/faktur) berikutnya. Karena itu fungsinya menerima Buffer + nama
 * file, bukan URL storage milik modul tertentu.
 *
 * Format yang didukung:
 * - PDF        → unpdf; PDF hasil scan (tanpa lapisan teks) jatuh ke OCR
 * - Gambar     → tesseract.js (ind+eng)
 * - DOCX       → mammoth
 * - XLSX/XLS   → xlsx, dirender jadi CSV per sheet
 * - CSV/TXT    → dibaca langsung
 *
 * Semua lib berat di-lazy-import supaya tidak membebani cold start route lain.
 */

import path from "path";
import fs from "fs/promises";
import os from "os";
import crypto from "crypto";

export type ExtractMethod = "pdf" | "ocr" | "docx" | "spreadsheet" | "text";

export interface ExtractResult {
  text: string;
  method: ExtractMethod;
  /** true bila teks dipotong karena melebihi batas. */
  truncated: boolean;
}

/** Batas teks yang ikut ke prompt — melindungi biaya token & jendela konteks. */
export const MAX_EXTRACT_CHARS = 20_000;

/** Batas ukuran file yang diterima. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"];
const SHEET_EXT = [".xlsx", ".xls", ".xlsm"];
const TEXT_EXT = [".csv", ".txt", ".md", ".log", ".tsv"];

export function isSupportedAttachment(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return (
    ext === ".pdf" ||
    ext === ".docx" ||
    ext === ".doc" ||
    IMAGE_EXT.includes(ext) ||
    SHEET_EXT.includes(ext) ||
    TEXT_EXT.includes(ext)
  );
}

const OCR_TIMEOUT_MS = 120_000;

/**
 * OCR menerima path file, bukan buffer, jadi buffer ditulis ke file sementara
 * lalu dibersihkan. Ditempatkan di direktori temp OS, bukan storage aplikasi.
 */
async function withTempFile<T>(
  buffer: Buffer,
  ext: string,
  fn: (filePath: string) => Promise<T>
): Promise<T> {
  const tmp = path.join(os.tmpdir(), `arkiv-ocr-${crypto.randomUUID()}${ext}`);
  await fs.writeFile(tmp, buffer);
  try {
    return await fn(tmp);
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

async function ocrBuffer(buffer: Buffer, ext: string): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  // ind+eng: dokumen di Indonesia umumnya campuran dua bahasa.
  const worker = await createWorker(["ind", "eng"]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await withTempFile(buffer, ext, async (filePath) => {
      const result = await Promise.race([
        worker.recognize(filePath),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("OCR timeout — file terlalu besar atau rumit")),
            OCR_TIMEOUT_MS
          );
        }),
      ]);
      return result.data.text;
    });
  } finally {
    if (timer) clearTimeout(timer);
    await worker.terminate();
  }
}

async function extractPdf(buffer: Buffer): Promise<{ text: string; method: ExtractMethod }> {
  const { extractText } = await import("unpdf");
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  const plain = typeof text === "string" ? text : String(text ?? "");

  // PDF hasil scan tidak punya lapisan teks; ambang 40 karakter mengikuti
  // perilaku ekstraksi CV yang sudah terbukti di modul rekrutmen.
  if (plain.trim().length >= 40) return { text: plain, method: "pdf" };
  try {
    return { text: await ocrBuffer(buffer, ".pdf"), method: "ocr" };
  } catch {
    return { text: plain, method: "pdf" };
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

/**
 * Spreadsheet dirender sebagai CSV per sheet. Bentuk baris/kolom yang datar
 * jauh lebih mudah dianalisis model daripada JSON bersarang, dan jauh lebih
 * hemat token daripada mengirim tiap sel sebagai objek.
 */
async function extractSpreadsheet(buffer: Buffer): Promise<string> {
  const { parseXlsxToCsvParts } = await import("@/lib/spreadsheet/exceljs-safe");
  const parts = await parseXlsxToCsvParts(buffer);
  return parts.map((part) => `### Sheet: ${part.name}\n${part.csv}`).join("\n\n");
}

function cleanText(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Ekstrak teks dari satu lampiran. Melempar bila format tidak didukung. */
export async function extractAttachmentText(
  buffer: Buffer,
  fileName: string
): Promise<ExtractResult> {
  const ext = path.extname(fileName).toLowerCase();
  let raw: string;
  let method: ExtractMethod;

  if (ext === ".pdf") {
    const out = await extractPdf(buffer);
    raw = out.text;
    method = out.method;
  } else if (ext === ".docx" || ext === ".doc") {
    raw = await extractDocx(buffer);
    method = "docx";
  } else if (IMAGE_EXT.includes(ext)) {
    raw = await ocrBuffer(buffer, ext);
    method = "ocr";
  } else if (SHEET_EXT.includes(ext)) {
    raw = await extractSpreadsheet(buffer);
    method = "spreadsheet";
  } else if (TEXT_EXT.includes(ext)) {
    raw = buffer.toString("utf-8");
    method = "text";
  } else {
    throw new Error(`Format tidak didukung: ${ext || "tanpa ekstensi"}`);
  }

  const cleaned = cleanText(raw);
  if (!cleaned) {
    throw new Error("Tidak ada teks yang bisa dibaca dari file ini");
  }

  const truncated = cleaned.length > MAX_EXTRACT_CHARS;
  return {
    text: truncated ? cleaned.slice(0, MAX_EXTRACT_CHARS) : cleaned,
    method,
    truncated,
  };
}
