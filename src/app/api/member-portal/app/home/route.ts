import { getPool } from "@/lib/db";
import { listSessions } from "@/lib/gym/booking-server";
import { daysUntil } from "@/lib/gym/races";
import { goLinkHref } from "@/lib/member-app/go-link";
import { pickRailDay, raceImage } from "@/lib/member-app/home";
import type { AnnouncementView, HomeFeedView } from "@/lib/member-app/home-views";
import { memberJson, withMemberSession } from "@/lib/member-portal/route";

/**
 * GET — isi beranda aplikasi member: pengumuman terbaru, rel kelas hari ini
 * (atau besok), dan race sorotan. Promo diambil klien dari /promos.
 */
export const GET = withMemberSession("Gagal memuat beranda", async (customerId) => {
  const pool = getPool();
  const now = new Date();
  const [announcements, sessions, races] = await Promise.all([
    pool.query(
      `SELECT a.id, a.title, a.body, a.link_url, a.image_url, COALESCE(a.sent_at, a.created_at) AS created_at
         FROM crm.member_notifications n
         JOIN crm.member_announcements a ON a.id = n.announcement_id
        WHERE n.customer_id = $1
        ORDER BY n.created_at DESC
        LIMIT 4`,
      [customerId]
    ),
    listSessions(pool, {
      from: now,
      to: new Date(now.getTime() + 2 * 86_400_000),
      statuses: ["published", "full"],
      customerId,
    }),
    pool.query(
      `SELECT e.id, e.name, e.city, e.image_url, e.starts_at, r.goal_sec, (r.id IS NOT NULL) AS joined
         FROM gym.race_events e
         LEFT JOIN gym.member_races r
           ON r.race_event_id = e.id AND r.customer_id = $1 AND r.status = 'training'
        WHERE e.status NOT IN ('completed', 'cancelled') AND e.starts_at >= now()
        ORDER BY (r.id IS NULL), e.starts_at
        LIMIT 1`,
      [customerId]
    ),
  ]);

  const rail = pickRailDay(
    sessions.map((s) => ({ ...s, startsAt: s.starts_at })),
    now
  );
  const branchIds = [...new Set(rail.sessions.map((s) => s.branch_id).filter((id): id is string => Boolean(id)))];
  const { rows: branches } = branchIds.length
    ? await pool.query(`SELECT id, name FROM configuration.branches WHERE id = ANY($1)`, [branchIds])
    : { rows: [] };
  const branchName = new Map<string, string>(branches.map((b) => [b.id, b.name]));

  const race = races.rows[0];
  const feed: HomeFeedView = {
    announcements: announcements.rows.map(
      (a): AnnouncementView => ({
        id: a.id,
        title: a.title,
        message: a.body,
        deepLink: goLinkHref(a.link_url),
        imageUrl: a.image_url,
        createdAt: new Date(a.created_at).toISOString(),
      })
    ),
    railDay: rail.railDay,
    todaySessions: rail.sessions.map((s) => ({
      session: { id: s.id, classTypeId: s.class_type_id, startsAt: new Date(s.starts_at).toISOString() },
      classTypeName: s.class_type_name,
      branchName: (s.branch_id && branchName.get(s.branch_id)) || s.area || "Studio",
      coachName: s.coach_name ?? "-",
      spotsLeft: s.seats_left,
      myBooking: s.my_booking !== null && s.my_booking.status !== "waitlist",
    })),
    spotlightRace: race
      ? {
          raceEventId: race.id,
          name: race.name,
          city: race.city,
          imageUrl: raceImage(race.image_url, race.city),
          startsAt: new Date(race.starts_at).toISOString(),
          daysToRace: daysUntil(race.starts_at, now),
          joined: race.joined,
          goalSec: race.goal_sec,
        }
      : null,
  };
  return memberJson(feed);
});
