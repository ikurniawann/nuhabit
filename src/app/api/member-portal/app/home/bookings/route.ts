import { getPool } from "@/lib/db";
import { CHECKIN_LATE_MIN } from "@/lib/gym/booking";
import type { BookingView } from "@/lib/member-app/home-views";
import { memberJson, withMemberSession } from "@/lib/member-portal/route";

/**
 * GET — booking aktif member (terkonfirmasi, waitlist, sudah check-in) yang
 * kelasnya belum lewat jendela check-in, dengan nama cabang. Dipakai rel
 * "Mendatang" di beranda dan kartu gate di layar QR.
 */
export const GET = withMemberSession("Gagal memuat booking", async (customerId) => {
  const { rows } = await getPool().query(
    `SELECT b.id, b.status, b.waitlist_position,
            s.id AS session_id, s.class_type_id, s.starts_at, s.ends_at, s.credit_cost, s.area,
            t.name AS class_type_name, br.name AS branch_name
       FROM gym.bookings b
       JOIN gym.class_sessions s ON s.id = b.session_id
       JOIN gym.class_types t ON t.id = s.class_type_id
       LEFT JOIN configuration.branches br ON br.id = s.branch_id
      WHERE b.customer_id = $1
        AND b.status IN ('confirmed', 'waitlist', 'checked_in')
        AND s.ends_at >= now() - make_interval(mins => $2)
      ORDER BY s.starts_at
      LIMIT 50`,
    [customerId, CHECKIN_LATE_MIN]
  );
  return memberJson(
    rows.map(
      (r): BookingView => ({
        booking: { id: r.id, status: r.status.toUpperCase(), waitlistPosition: r.waitlist_position },
        session: {
          id: r.session_id,
          classTypeId: r.class_type_id,
          startsAt: new Date(r.starts_at).toISOString(),
          endsAt: new Date(r.ends_at).toISOString(),
          creditCost: r.credit_cost,
        },
        classTypeName: r.class_type_name,
        branchName: r.branch_name ?? r.area ?? "Studio",
      })
    )
  );
});
