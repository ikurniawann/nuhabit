/** Notifikasi in-app milik user yang login (lonceng HRIS). */

import { z } from "zod";
import { createServerPgClient } from "@/lib/pg/create-client";
import { unwrap } from "./workforce-route";

export const notificationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  unread: z.string().optional(),
});

export const markReadSchema = z
  .object({
    notification_id: z.string().nullish(),
    mark_all: z.boolean().nullish(),
  })
  .refine((body) => body.mark_all || body.notification_id, {
    message: "notification_id or mark_all is required",
  });

export async function listNotifications(
  userId: string,
  q: z.infer<typeof notificationListQuerySchema>
) {
  const db = await createServerPgClient();
  let query = db
    .from("notifications")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (q.unread === "true") query = query.eq("is_read", false);

  const { data, error, count } = await query.limit(q.limit);
  if (error) throw new Error(error.message);
  return { data: data || [], pagination: { limit: q.limit, total: count || 0 } };
}

/** Tandai semua notifikasi belum dibaca, atau satu notifikasi milik user. */
export async function markNotificationsRead(userId: string, input: z.infer<typeof markReadSchema>) {
  const db = await createServerPgClient();
  const update = { is_read: true, read_at: new Date().toISOString() };
  if (input.mark_all) {
    unwrap(await db.from("notifications").update(update).eq("user_id", userId).eq("is_read", false));
    return { message: "All notifications marked as read" };
  }
  unwrap(
    await db
      .from("notifications")
      .update(update)
      .eq("id", input.notification_id)
      .eq("user_id", userId)
  );
  return { message: "Notification marked as read" };
}
