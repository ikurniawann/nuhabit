import { getPool } from "@/lib/db";
import { attachCancelInfo, getSession } from "@/lib/gym/booking-server";
import { memberSchedulingRoute, uuid } from "@/lib/gym/scheduling-route";
import { memberError, memberJson } from "@/lib/member-portal/route";

type Ctx = { params: Promise<{ id: string }> };

/** GET — detail kelas: deskripsi, coach, kursi, booking member + pratinjau batal. */
export const GET = memberSchedulingRoute("Gagal memuat kelas", async (customerId, _request: Request, ctx: Ctx) => {
  const id = uuid.safeParse((await ctx.params).id);
  if (!id.success) return memberError("ID kelas tidak valid");
  const pool = getPool();
  const session = await getSession(pool, id.data, customerId);
  if (!session || session.status === "draft") return memberError("Kelas tidak ditemukan", 404);
  const [[withCancel], { rows: details }] = await Promise.all([
    attachCancelInfo(pool, [session], (s) => s.my_booking?.status ?? null),
    pool.query(
      `SELECT t.description, c.specialization AS coach_specialization, c.bio AS coach_bio, c.photo_url AS coach_photo_url
         FROM gym.class_types t LEFT JOIN gym.coaches c ON c.id = $2
        WHERE t.id = $1`,
      [session.class_type_id, session.coach_id]
    ),
  ]);
  return memberJson({ ...withCancel, ...details[0] });
});
