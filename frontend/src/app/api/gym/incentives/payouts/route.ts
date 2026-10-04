import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { isPeriodMonth } from "@/lib/gym/incentive";
import { createPayout, listPayouts } from "@/lib/gym/incentive-server";
import { ok, parseBody } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

const createSchema = z.object({
  coach_id: z.string().uuid(),
  month: z.string().refine(isPeriodMonth, "Bulan harus berformat YYYY-MM"),
});

/** GET [?month=YYYY-MM]: payout terbaru dulu, dengan nama coach. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.gymIncentives);
  const month = request.nextUrl.searchParams.get("month");
  if (month && !isPeriodMonth(month)) throw ApiError.badRequest("Bulan harus berformat YYYY-MM");
  return ok(await listPayouts(month));
}, "gym.incentives.payouts.GET");

/** POST: bekukan statement coach bulan itu jadi payout draf. 409 bila sudah ada payout aktif. */
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.gymIncentives);
  const input = await parseBody(request, createSchema);
  return ok({ id: await createPayout(user.id, input.coach_id, input.month) });
}, "gym.incentives.payouts.POST");
