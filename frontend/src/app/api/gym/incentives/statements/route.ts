import type { NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { isPeriodMonth } from "@/lib/gym/incentive";
import { coachStatements } from "@/lib/gym/incentive-server";
import { ok, requireUuid } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

/**
 * GET ?month=YYYY-MM[&coach_id=]: statement insentif per coach dihitung
 * langsung dari kelas selesai dan booking-nya (belum dibekukan).
 */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.gymIncentives);
  const params = request.nextUrl.searchParams;
  const month = params.get("month") ?? "";
  if (!isPeriodMonth(month)) throw ApiError.badRequest("Bulan harus berformat YYYY-MM");
  const coachId = params.get("coach_id") ? requireUuid(params.get("coach_id"), "ID coach tidak valid") : null;
  return ok(await coachStatements(month, coachId));
}, "gym.incentives.statements.GET");
