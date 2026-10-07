import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import {
  loadStaticQris,
  STATIC_QRIS_BUCKET,
  STATIC_QRIS_MAX_BYTES,
} from "@/lib/payments/static-qris";
import { setSetting, SETTING_KEYS } from "@/lib/settings/app-settings";
import { sniffImageMime } from "@/lib/storage-private";
import { deleteFile, uploadFile } from "@/lib/storage";

/**
 * Static QRIS (Settings → Payment Gateways) — hak menu payment gateways.
 * - GET    : konfigurasi saat ini.
 * - POST   : unggah/ganti gambar QRIS (multipart `file`).
 * - PUT    : { enabled } — aktif hanya bila gambar sudah ada.
 * - DELETE : hapus gambar & nonaktifkan.
 */
export const dynamic = "force-dynamic";

const CONTEXT = "settings/static-qris";
const putSchema = z.object({ enabled: z.boolean() });

async function respondWithConfig() {
  return NextResponse.json({ success: true, data: await loadStaticQris() });
}

async function removeOldImage(url: string | null) {
  if (!url) return;
  const { error } = await deleteFile(STATIC_QRIS_BUCKET, url);
  if (error) console.warn(`[${CONTEXT}] berkas lama tidak terhapus:`, url, error);
}

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.settingsPaymentGateways);
  return respondWithConfig();
}, `${CONTEXT} GET`);

export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.settingsPaymentGateways);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) throw ApiError.badRequest("Pilih file gambar QRIS dulu");
  if (file.size > STATIC_QRIS_MAX_BYTES) throw ApiError.badRequest("Gambar QRIS maksimal 5 MB");
  if (!sniffImageMime(Buffer.from(await file.arrayBuffer()))) {
    throw ApiError.badRequest("File harus gambar JPG/PNG/WebP");
  }

  const previous = await loadStaticQris();
  const { url, error } = await uploadFile(STATIC_QRIS_BUCKET, file);
  if (error || !url) throw ApiError.server(error || "Upload gagal");
  await setSetting(SETTING_KEYS.STATIC_QRIS_IMAGE_URL, url);
  // Unggahan pertama langsung mengaktifkan — itu niat yang paling umum.
  if (!previous.imageUrl) await setSetting(SETTING_KEYS.STATIC_QRIS_ENABLED, "true");
  await removeOldImage(previous.imageUrl);
  return respondWithConfig();
}, `${CONTEXT} POST`);

export const PUT = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.settingsPaymentGateways);
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw ApiError.badRequest("Data tidak valid");
  if (parsed.data.enabled && !(await loadStaticQris()).imageUrl) {
    throw ApiError.badRequest("Unggah gambar QRIS dulu sebelum mengaktifkan");
  }
  await setSetting(SETTING_KEYS.STATIC_QRIS_ENABLED, parsed.data.enabled ? "true" : "false");
  return respondWithConfig();
}, `${CONTEXT} PUT`);

export const DELETE = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.settingsPaymentGateways);
  const current = await loadStaticQris();
  await setSetting(SETTING_KEYS.STATIC_QRIS_ENABLED, "false");
  await setSetting(SETTING_KEYS.STATIC_QRIS_IMAGE_URL, null);
  await removeOldImage(current.imageUrl);
  return respondWithConfig();
}, `${CONTEXT} DELETE`);
