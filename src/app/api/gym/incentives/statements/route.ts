import { isPeriodMonth } from "@/lib/gym/incentive";
import { coachStatements } from "@/lib/gym/incentive-server";
import { fail, gymStaffRoute, ok, uuidParam } from "@/lib/gym/training-route";
import { IAM } from "@/lib/iam/prefixes";

/**
 * GET ?month=YYYY-MM[&coach_id=] — statement insentif per coach dihitung
 * langsung dari kelas selesai dan booking-nya (belum dibekukan).
 */
export const GET = gymStaffRoute(IAM.gymIncentives, "Gagal menghitung statement", async (_userId, request: Request) => {
  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? "";
  const coachId = params.get("coach_id");
  if (!isPeriodMonth(month)) return fail("Bulan harus berformat YYYY-MM");
  if (coachId && !uuidParam.safeParse(coachId).success) return fail("ID coach tidak valid");
  return ok(await coachStatements(month, coachId));
});
