import { ApiError, requireApiUser } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import type { BookingActor } from "@/lib/studio/booking-server";

/**
 * Coach Portal (EPIC-056): user login → hris.employees.user_id → studio.coaches.employee_id.
 * Coach hanya melihat & mengubah data sesi miliknya.
 */
export interface CoachContext {
  userId: string;
  coach: { id: string; full_name: string; display_name: string | null; level: "coach" | "head_coach"; photo_url: string | null; company_id: string; branch_id: string };
  actor: BookingActor;
}

export async function findCoachForUser(userId: string) {
  return queryOne<CoachContext["coach"]>(
    `SELECT c.id, c.full_name, c.display_name, c.level, c.photo_url, c.company_id, c.branch_id
     FROM studio.coaches c JOIN hris.employees e ON e.id = c.employee_id
     WHERE e.user_id = $1 AND c.is_active
     ORDER BY c.created_at LIMIT 1`,
    [userId]
  );
}

export async function requireCoach(): Promise<CoachContext> {
  const user = await requireApiUser();
  const coach = await findCoachForUser(user.id);
  if (!coach) throw ApiError.forbidden("Akun ini belum ditautkan ke profil coach — hubungi admin");
  return { userId: user.id, coach, actor: { companyId: coach.company_id, branchId: coach.branch_id, actorId: user.id, staff: true } };
}

/** Pastikan sesi milik coach ini. */
export async function assertOwnSession(coachId: string, sessionId: string) {
  const s = await queryOne<{ id: string; session_date: string; status: string }>(
    `SELECT id, session_date::text AS session_date, status FROM studio.class_sessions WHERE id = $1 AND coach_id = $2`,
    [sessionId, coachId]
  );
  if (!s) throw ApiError.notFound("Sesi tidak ditemukan");
  return s;
}
