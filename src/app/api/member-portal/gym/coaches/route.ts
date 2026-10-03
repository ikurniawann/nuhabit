import { getPool } from "@/lib/db";
import { memberSchedulingRoute } from "@/lib/gym/scheduling-route";
import { memberJson } from "@/lib/member-portal/route";

/** GET — coach aktif + jumlah kelas terbit dalam 7 hari ke depan. */
export const GET = memberSchedulingRoute("Gagal memuat coach", async () => {
  const { rows } = await getPool().query(
    `SELECT c.id, c.name, c.bio, c.specialization, c.photo_url,
            (SELECT count(*)::int FROM gym.class_sessions s
              WHERE s.coach_id = c.id AND s.status IN ('published', 'full')
                AND s.starts_at > now() AND s.starts_at < now() + interval '7 days') AS upcoming_sessions
       FROM gym.coaches c
      WHERE c.status = 'active'
      ORDER BY c.name`
  );
  return memberJson(rows);
});
