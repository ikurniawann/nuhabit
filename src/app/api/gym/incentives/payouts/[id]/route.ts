import { z } from "zod";
import { getPool } from "@/lib/db";
import { PAYOUT_ACTIONS } from "@/lib/gym/incentive";
import { actOnPayout } from "@/lib/gym/incentive-server";
import { fail, gymStaffRoute, ok, uuidParam } from "@/lib/gym/training-route";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ id: string }> };

const actionSchema = z.object({
  action: z.enum(PAYOUT_ACTIONS),
  payment_reference: z.string().max(120).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

/** GET — satu payout beserta statement yang dibekukan. */
export const GET = gymStaffRoute(IAM.gymIncentives, "Gagal memuat payout", async (_userId, _request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!uuidParam.safeParse(id).success) return fail("ID tidak valid");
  const { rows } = await getPool().query(
    `SELECT p.id, p.coach_id, c.name AS coach_name, to_char(p.period_month, 'YYYY-MM') AS month, p.statement,
            p.total_idr::float AS total_idr, p.status, p.payment_reference, p.note,
            p.created_at, p.approved_at, p.paid_at, p.voided_at
       FROM gym.coach_payouts p JOIN gym.coaches c ON c.id = p.coach_id
      WHERE p.id = $1`,
    [id]
  );
  if (!rows[0]) return fail("Payout tidak ditemukan", 404);
  return ok(rows[0]);
});

/** POST — approve | pay (wajib payment_reference) | void (wajib note). */
export const POST = gymStaffRoute(IAM.gymIncentives, "Gagal memproses payout", async (userId, request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!uuidParam.safeParse(id).success) return fail("ID tidak valid");
  const input = actionSchema.parse(await request.json());
  const outcome = await actOnPayout(userId, id, input.action, {
    paymentReference: input.payment_reference,
    note: input.note,
  });
  if (!outcome.ok) return fail(outcome.error, outcome.status);
  return ok({ id });
});
