import { NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { extractAttachmentText, MAX_ATTACHMENT_BYTES } from "@/lib/attachments/extract";
import { IAM } from "@/lib/iam/prefixes";
import { parseReceiptText, type ReceiptFields } from "@/lib/purchasing/receipt-scan";
import { savePrivateDocument } from "@/lib/storage-private";

// OCR (tesseract.js) butuh Node runtime penuh.
export const runtime = "nodejs";

/** Nota = foto atau PDF; spreadsheet/DOCX bukan bentuk nota. */
const ALLOWED_EXT = /\.(jpe?g|png|webp|pdf)$/i;

/** Folder arsip per bulan supaya tidak membengkak. */
function receiptFolder(now: Date): string {
  return `purchasing-receipts/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Unggah nota/faktur vendor (EPIC-018 Fase B): file disimpan PERMANEN ke
 * storage/private/purchasing-receipts (arsip bukti), lalu teksnya diekstrak
 * (OCR untuk foto/scan) dan dipetakan ke field form pembayaran. File tetap
 * tersimpan meskipun parsing gagal; user tinggal mengisi manual.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.items);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) throw ApiError.badRequest("Pilih file nota dulu");
  if (file.size > MAX_ATTACHMENT_BYTES) throw ApiError.badRequest("File terlalu besar — maksimal 10 MB");

  const originalName = (file.name || "nota").slice(0, 150);
  if (!ALLOWED_EXT.test(originalName)) {
    throw ApiError.badRequest("Format tidak didukung — gunakan foto (JPG/PNG) atau PDF");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const saved = await savePrivateDocument(buffer, receiptFolder(new Date()));
  if (!saved.path) throw ApiError.badRequest(saved.error || "File tidak bisa disimpan");

  // Ekstraksi & pemetaan best-effort: kegagalan OCR bukan kegagalan unggah.
  let fields: ReceiptFields = { nomor: null, tanggal: null, total: null };
  try {
    const extracted = await extractAttachmentText(buffer, originalName);
    fields = parseReceiptText(extracted.text);
  } catch (error) {
    console.warn("[purchasing:receipt-scan] ekstraksi gagal:", error);
  }

  return Response.json({
    success: true,
    data: { receipt_path: saved.path, receipt_name: originalName, fields },
  });
}, "purchasing.receipt-scan");
