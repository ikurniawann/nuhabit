import { z } from "zod";
import { getPool } from "@/lib/db";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

/** GET — 50 notifikasi terbaru + jumlah belum dibaca. */
export const GET = withMemberSession("Gagal memuat notifikasi", async (customerId) => {
  const pool = getPool();
  const [{ rows }, { rows: unread }] = await Promise.all([
    pool.query(
      `SELECT id, type, title, body, image_url, link_url, created_at, read_at
         FROM crm.member_notifications WHERE customer_id = $1
        ORDER BY created_at DESC LIMIT 50`,
      [customerId]
    ),
    pool.query(
      `SELECT count(*)::int AS n FROM crm.member_notifications WHERE customer_id = $1 AND read_at IS NULL`,
      [customerId]
    ),
  ]);
  return memberJson({ notifications: rows, unread: unread[0]?.n ?? 0 });
});

const markSchema = z.object({ ids: z.array(z.string().uuid()).optional() });

/** POST — tandai dibaca: `ids` tertentu, atau semua bila kosong. */
export const POST = withMemberSession("Gagal menandai notifikasi", async (customerId, request: Request) => {
  const parsed = markSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return memberError("Data tidak valid");
  const ids = parsed.data.ids;
  await getPool().query(
    `UPDATE crm.member_notifications SET read_at = now()
      WHERE customer_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2))`,
    [customerId, ids?.length ? ids : null]
  );
  return memberJson({ ok: true });
});
