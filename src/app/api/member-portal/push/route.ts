import { z } from "zod";
import { getPool } from "@/lib/db";
import { vapidConfig } from "@/lib/member-portal/push";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

/** GET — kunci publik VAPID (null bila push belum dikonfigurasi) + jumlah perangkat member. */
export const GET = withMemberSession("Gagal memuat status notifikasi", async (customerId) => {
  const { rows } = await getPool().query(
    `SELECT count(*)::int AS n FROM crm.member_push_subscriptions WHERE customer_id = $1`,
    [customerId]
  );
  return memberJson({ public_key: vapidConfig()?.publicKey ?? null, devices: rows[0]?.n ?? 0 });
});

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1_000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** POST — simpan langganan push perangkat ini (endpoint unik; pindah pemilik bila dipakai member lain). */
export const POST = withMemberSession("Gagal menyalakan notifikasi", async (customerId, request: Request) => {
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return memberError("Langganan notifikasi tidak valid");
  const { endpoint, keys } = parsed.data;
  await getPool().query(
    `INSERT INTO crm.member_push_subscriptions (customer_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       customer_id = EXCLUDED.customer_id, p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
    [customerId, endpoint, keys.p256dh, keys.auth, request.headers.get("user-agent")?.slice(0, 300) ?? null]
  );
  return memberJson({ ok: true });
});

const removeSchema = z.object({ endpoint: z.string().url().max(1_000) });

/** DELETE — matikan push di perangkat ini. */
export const DELETE = withMemberSession("Gagal mematikan notifikasi", async (customerId, request: Request) => {
  const parsed = removeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return memberError("Data tidak valid");
  await getPool().query(
    `DELETE FROM crm.member_push_subscriptions WHERE customer_id = $1 AND endpoint = $2`,
    [customerId, parsed.data.endpoint]
  );
  return memberJson({ ok: true });
});
