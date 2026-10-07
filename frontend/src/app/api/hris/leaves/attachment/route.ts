import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { readJson, requireWorkforceActor, UUID_RE } from "@/lib/hris/workforce-route";
import { savePrivateImage } from "@/lib/storage-private";

const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/;

const uploadSchema = z.object({
  photo: z.string().optional(),
  // Dipakai sebagai segmen folder: wajib UUID agar tidak bisa keluar folder
  employee_id: z.string().regex(UUID_RE, "ID karyawan tidak valid").optional(),
});

/**
 * POST /api/hris/leaves/attachment: upload lampiran cuti (JPG/PNG/WebP maks
 * 5 MB) ke storage private; path disimpan di leaves.attachment_url dan
 * disajikan via GET /api/hris/leaves/attachment/[...path]. HR boleh
 * meng-upload atas nama karyawan lain (employee_id).
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const actor = await requireWorkforceActor();
  const body = await readJson(request, uploadSchema);
  const ownerId = actor.isHr && body.employee_id ? body.employee_id : actor.employeeId;
  if (!ownerId) throw ApiError.forbidden("Akun ini tidak terhubung ke data karyawan");

  const match = IMAGE_DATA_URL.exec(body.photo ?? "");
  if (!match) throw ApiError.badRequest("Lampiran harus berupa gambar JPG/PNG/WebP");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > MAX_BYTES) throw ApiError.badRequest("Ukuran lampiran maksimal 5 MB");

  const saved = await savePrivateImage(buffer, match[1], `leave-attachments/${ownerId}`);
  if (!saved.path) throw ApiError.badRequest(saved.error ?? "Gagal menyimpan lampiran");
  return NextResponse.json({ data: { path: saved.path }, message: "Lampiran tersimpan" });
}, "hris/leaves/attachment.POST");
