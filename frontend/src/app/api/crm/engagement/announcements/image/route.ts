import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { requireCrmUser } from "@/lib/crm/guards";
import { uploadPublicImage } from "@/lib/crm/image-upload";

/**
 * POST (multipart `file`) — unggah gambar pengumuman member. Pola sama dengan
 * /api/crm/avatars/upload, tetapi digerbang menu Engagement supaya pengirim
 * pengumuman tidak butuh akses pengaturan CRM.
 */
export const POST = apiHandler(async (request: Request) => {
  await requireCrmUser("engagement");
  return successResponse(await uploadPublicImage(request, "crm-announcements"));
}, "crm.engagement.announcements.image.POST");
