import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmUser } from "@/lib/crm/guards";
import { uploadPublicImage } from "@/lib/crm/image-upload";

/**
 * Upload artwork collectible oleh admin (EPIC-014 Task 3) — menggantikan
 * keharusan menghosting gambar sendiri lalu menempel URL. Disimpan ke bucket
 * publik karena artwork memang tampil ke member di portal.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("settings");
  return NextResponse.json({ success: true, data: await uploadPublicImage(request, "crm-avatars") });
}, "crm.avatars.upload.POST");
