import { z } from "zod";
import { getPool } from "@/lib/db";
import { goLinkHref } from "@/lib/member-app/go-link";
import type { AnnouncementView } from "@/lib/member-app/home-views";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

type Ctx = { params: Promise<{ id: string }> };

/** GET — satu pengumuman, hanya bila member ini termasuk penerimanya. */
export const GET = withMemberSession("Gagal memuat pengumuman", async (customerId, _request: Request, ctx: Ctx) => {
  const id = z.string().uuid().safeParse((await ctx.params).id);
  if (!id.success) return memberError("Pengumuman tidak ditemukan", 404);
  const { rows } = await getPool().query(
    `SELECT a.id, a.title, a.body, a.link_url, a.image_url, COALESCE(a.sent_at, a.created_at) AS created_at
       FROM crm.member_announcements a
      WHERE a.id = $2
        AND EXISTS (SELECT 1 FROM crm.member_notifications n WHERE n.announcement_id = a.id AND n.customer_id = $1)`,
    [customerId, id.data]
  );
  const a = rows[0];
  if (!a) return memberError("Pengumuman tidak ditemukan", 404);
  const view: AnnouncementView = {
    id: a.id,
    title: a.title,
    message: a.body,
    deepLink: goLinkHref(a.link_url),
    imageUrl: a.image_url,
    createdAt: new Date(a.created_at).toISOString(),
  };
  return memberJson(view);
});
