import { z } from "zod";
import { getApiUser } from "@/lib/api/auth";
import { getPool } from "@/lib/db";
import { engagementRoute, ok } from "@/lib/crm/engagement/admin-route";
import { countAudience, sendAnnouncement } from "@/lib/crm/engagement/server";
import { isPortalLink } from "@/lib/member-portal/links";

const audienceSchema = z.object({
  tier_codes: z.array(z.string().min(1).max(40)).max(20).optional(),
  min_visits: z.number().int().min(0).max(10_000).optional(),
  inactive_days: z.number().int().min(0).max(3_650).optional(),
});

const sendSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(1_000),
  kind: z.enum(["announcement", "promo"]),
  audience: audienceSchema,
  /** URL gambar hasil unggah (announcements/image). */
  image_url: z.string().trim().max(500).regex(/^(\/api\/files\/|https:\/\/)/, "URL gambar tidak valid").nullable().optional(),
  /** Tujuan dalam portal: "events", "promo:KODE", dst. (lib/member-portal/links). */
  link_url: z.string().trim().max(60).refine(isPortalLink, "Tujuan portal tidak dikenal").nullable().optional(),
  /** true = hanya hitung penerima, tidak mengirim. */
  preview: z.boolean().optional(),
});

/** GET — riwayat pengumuman, terbaru dulu, dengan jumlah yang sudah dibaca. */
export const GET = engagementRoute("Gagal memuat pengumuman", async () => {
  const { rows } = await getPool().query(
    `SELECT a.id, a.title, a.body, a.kind, a.audience, a.recipient_count, a.sent_at, a.image_url, a.link_url,
            (SELECT count(*)::int FROM crm.member_notifications n
              WHERE n.announcement_id = a.id AND n.read_at IS NOT NULL) AS read_count
       FROM crm.member_announcements a ORDER BY a.sent_at DESC NULLS LAST LIMIT 100`
  );
  return ok(rows);
});

/** POST — kirim pengumuman ke kotak masuk member di audiens (atau pratinjau jumlahnya). */
export const POST = engagementRoute("Gagal mengirim pengumuman", async (request: Request) => {
  const payload = sendSchema.parse(await request.json());
  if (payload.preview) return ok({ recipients: await countAudience(payload.audience) });
  const user = await getApiUser();
  return ok(
    await sendAnnouncement({
      title: payload.title,
      body: payload.body,
      kind: payload.kind,
      audience: payload.audience,
      createdBy: user?.id ?? null,
      imageUrl: payload.image_url,
      linkUrl: payload.link_url,
    })
  );
});
