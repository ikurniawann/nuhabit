import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  loadStaticQris,
  STATIC_QRIS_BUCKET,
  STATIC_QRIS_MAX_BYTES,
  type StaticQrisConfig,
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

function ok(data: StaticQrisConfig) {
  return NextResponse.json({ success: true, data });
}

function fail(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function handleError(error: unknown, label: string) {
  if (error instanceof ApiError) return error.toResponse();
  console.error(`[settings/static-qris] ${label} gagal:`, error);
  return fail("Gagal memproses Static QRIS", 500);
}

async function removeOldImage(url: string | null) {
  if (!url) return;
  const { error } = await deleteFile(STATIC_QRIS_BUCKET, url);
  if (error) console.warn("[settings/static-qris] berkas lama tidak terhapus:", url, error);
}

export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.settingsPaymentGateways);
    return ok(await loadStaticQris());
  } catch (error) {
    return handleError(error, "GET");
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsPaymentGateways);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) return fail("Pilih file gambar QRIS dulu", 400);
    if (file.size > STATIC_QRIS_MAX_BYTES) return fail("Gambar QRIS maksimal 5 MB", 400);
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!sniffImageMime(buffer)) return fail("File harus gambar JPG/PNG/WebP", 400);

    const previous = await loadStaticQris();
    const { url, error } = await uploadFile(STATIC_QRIS_BUCKET, file);
    if (error || !url) return fail(error || "Upload gagal", 500);
    await setSetting(SETTING_KEYS.STATIC_QRIS_IMAGE_URL, url);
    // Unggahan pertama langsung mengaktifkan — itu niat yang paling umum.
    if (!previous.imageUrl) await setSetting(SETTING_KEYS.STATIC_QRIS_ENABLED, "true");
    await removeOldImage(previous.imageUrl);
    return ok(await loadStaticQris());
  } catch (error) {
    return handleError(error, "POST");
  }
}

const putSchema = z.object({ enabled: z.boolean() });

export async function PUT(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsPaymentGateways);
    const parsed = putSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("Data tidak valid", 400);
    const current = await loadStaticQris();
    if (parsed.data.enabled && !current.imageUrl) {
      return fail("Unggah gambar QRIS dulu sebelum mengaktifkan", 400);
    }
    await setSetting(SETTING_KEYS.STATIC_QRIS_ENABLED, parsed.data.enabled ? "true" : "false");
    return ok(await loadStaticQris());
  } catch (error) {
    return handleError(error, "PUT");
  }
}

export async function DELETE() {
  try {
    await requireIamMenuPrefix(IAM.settingsPaymentGateways);
    const current = await loadStaticQris();
    await setSetting(SETTING_KEYS.STATIC_QRIS_ENABLED, "false");
    await setSetting(SETTING_KEYS.STATIC_QRIS_IMAGE_URL, null);
    await removeOldImage(current.imageUrl);
    return ok(await loadStaticQris());
  } catch (error) {
    return handleError(error, "DELETE");
  }
}
