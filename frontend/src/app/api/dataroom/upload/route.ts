import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamAction } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { DATAROOM_MAX_FILE_BYTES, DATAROOM_QUOTA_BYTES, fitsQuota, formatBytes } from "@/lib/dataroom/config";
import { createFileNode, getNode, usedBytes } from "@/lib/dataroom/nodes";
import { deleteDataroomFiles, saveDataroomFile } from "@/lib/dataroom/storage";
import { createAccessResolver, resolveActor } from "@/lib/dataroom/access";

/**
 * POST /api/dataroom/upload (multipart: file, parent_id?) — satu file per
 * permintaan supaya klien bisa menampilkan progres per file dan memori server
 * tetap terkendali. Menolak bila melebihi batas per file atau kuota 50 GB.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamAction(IAM.dataroom, "create");
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw ApiError.badRequest("File wajib diisi");
  const parentId = String(form.get("parent_id") || "") || null;
  if (parentId) {
    const parent = await getNode(parentId);
    if (!parent || parent.kind !== "folder") throw ApiError.notFound("Folder tujuan tidak ditemukan");
    const access = await createAccessResolver(await resolveActor(user));
    if (!access.allowsFolder(parentId)) throw ApiError.forbidden("Folder ini tidak dibuka untuk departemen Anda");
  }
  if (file.size > DATAROOM_MAX_FILE_BYTES) {
    throw ApiError.badRequest(`Ukuran file melebihi batas ${formatBytes(DATAROOM_MAX_FILE_BYTES)}`);
  }
  const used = await usedBytes();
  if (!fitsQuota(used, file.size)) {
    throw ApiError.badRequest(
      `Kuota Dataroom penuh (${formatBytes(used)} dari ${formatBytes(DATAROOM_QUOTA_BYTES)}). Hapus file lain dulu.`
    );
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const saved = await saveDataroomFile(buffer, file.name, file.type);
  try {
    const node = await createFileNode({
      parentId, name: file.name || "Tanpa nama", mime: saved.mime, sizeBytes: saved.size,
      storagePath: saved.path, userId: user.id, userName: user.full_name,
    });
    return NextResponse.json({ success: true, data: node }, { status: 201 });
  } catch (err) {
    await deleteDataroomFiles([saved.path]);
    throw err;
  }
}, "dataroom.upload.POST");
