import { getPool } from "@/lib/db";
import { attachCancelInfo, listSessions } from "@/lib/gym/booking-server";
import { getCreditBalance } from "@/lib/gym/credits-server";
import { memberSchedulingRoute, optionalUuid, rangeParams } from "@/lib/gym/scheduling-route";
import { memberJson } from "@/lib/member-portal/route";

/**
 * GET ?from&to (atau ?date=YYYY-MM-DD) &class_type_id&coach_id — kelas terbit
 * yang belum mulai, kursi tersisa, status booking member, saldo kredit, dan
 * jenis kelas untuk filter.
 */
export const GET = memberSchedulingRoute("Gagal memuat jadwal kelas", async (customerId, request: Request) => {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (date) {
    url.searchParams.set("from", date);
    url.searchParams.set("to", new Date(new Date(`${date}T00:00:00+07:00`).getTime() + 86_400_000).toISOString());
  }
  const range = rangeParams(url, 7);
  const now = new Date();
  const pool = getPool();
  const sessions = await listSessions(pool, {
    from: range.from < now ? now : range.from,
    to: range.to,
    classTypeId: optionalUuid(url, "class_type_id"),
    coachId: optionalUuid(url, "coach_id"),
    statuses: ["published", "full"],
    customerId,
  });
  const [withCancel, credits, { rows: classTypes }] = await Promise.all([
    attachCancelInfo(pool, sessions, (s) => s.my_booking?.status ?? null, now),
    getCreditBalance(pool, customerId),
    pool.query(`SELECT id, name, color FROM gym.class_types WHERE status = 'active' ORDER BY name`),
  ]);
  return memberJson({ sessions: withCancel, credits, class_types: classTypes });
});
