import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { PAYOUT_ACTIONS } from "@/lib/gym/incentive";
import { actOnPayout, getPayout } from "@/lib/gym/incentive-server";
import { ok, parseBody, requireUuid } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ id: string }> };

const actionSchema = z.object({
  action: z.enum(PAYOUT_ACTIONS),
  payment_reference: z.string().max(120).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

/** GET: satu payout beserta statement yang dibekukan. */
export const GET = apiHandler(async (_request: NextRequest, ctx: Ctx) => {
  await requireIamMenuPrefix(IAM.gymIncentives);
  const id = requireUuid((await ctx.params).id);
  return ok(await getPayout(id));
}, "gym.incentives.payouts.[id].GET");

/** POST: approve | pay (wajib payment_reference) | void (wajib note). */
export const POST = apiHandler(async (request: NextRequest, ctx: Ctx) => {
  const user = await requireIamMenuPrefix(IAM.gymIncentives);
  const id = requireUuid((await ctx.params).id);
  const input = await parseBody(request, actionSchema);
  await actOnPayout(user.id, id, input.action, { paymentReference: input.payment_reference, note: input.note });
  return ok({ id });
}, "gym.incentives.payouts.[id].POST");
