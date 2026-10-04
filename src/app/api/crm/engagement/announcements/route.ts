import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { announcementSchema, listAnnouncements } from "@/lib/crm/engagement/admin-server";
import { countAudience, sendAnnouncement } from "@/lib/crm/engagement/server";
import { parseCrmInput, requireCrmUser } from "@/lib/crm/guards";

/** GET — riwayat pengumuman, terbaru dulu, dengan jumlah yang sudah dibaca. */
export const GET = apiHandler(async () => {
  await requireCrmUser("engagement");
  return successResponse(await listAnnouncements());
}, "crm.engagement.announcements.GET");

/** POST — kirim pengumuman ke kotak masuk member di audiens (atau pratinjau jumlahnya). */
export const POST = apiHandler(async (request: Request) => {
  const user = await requireCrmUser("engagement");
  const payload = parseCrmInput(announcementSchema, await request.json());
  if (payload.preview) return successResponse({ recipients: await countAudience(payload.audience) });
  return successResponse(
    await sendAnnouncement({
      title: payload.title,
      body: payload.body,
      kind: payload.kind,
      audience: payload.audience,
      createdBy: user.id,
      imageUrl: payload.image_url,
      linkUrl: payload.link_url,
    })
  );
}, "crm.engagement.announcements.POST");
