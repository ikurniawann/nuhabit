import { z } from "zod";
import { getPool } from "@/lib/db";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

const trackSchema = z.object({
  id: z.string().uuid(),
  event: z.enum(["open", "click"]),
});

/**
 * POST — jejak buka/klik notifikasi untuk laporan kampanye. Hanya waktu
 * pertama yang dicatat; klik sekaligus menandai dibuka.
 */
export const POST = withMemberSession("Gagal mencatat notifikasi", async (customerId, request: Request) => {
  const parsed = trackSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return memberError("Data tidak valid");
  const { id, event } = parsed.data;
  const { rows } = await getPool().query(
    `UPDATE crm.member_notifications
        SET opened_at = COALESCE(opened_at, now()),
            clicked_at = CASE WHEN $3 = 'click' THEN COALESCE(clicked_at, now()) ELSE clicked_at END
      WHERE id = $1 AND customer_id = $2
      RETURNING link_url`,
    [id, customerId, event]
  );
  if (!rows[0]) return memberError("Notifikasi tidak ditemukan", 404);
  return memberJson({ link_url: rows[0].link_url ?? null });
});
