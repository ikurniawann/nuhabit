import { z } from "zod";
import { getPool } from "@/lib/db";
import { isPeriodMonth } from "@/lib/gym/incentive";
import { createPayout } from "@/lib/gym/incentive-server";
import { fail, gymStaffRoute, ok } from "@/lib/gym/training-route";
import { IAM } from "@/lib/iam/prefixes";

const createSchema = z.object({
  coach_id: z.string().uuid(),
  month: z.string().refine(isPeriodMonth, "Bulan harus berformat YYYY-MM"),
});

/** GET [?month=YYYY-MM] — payout terbaru dulu, dengan nama coach. */
export const GET = gymStaffRoute(IAM.gymIncentives, "Gagal memuat payout", async (_userId, request: Request) => {
  const month = new URL(request.url).searchParams.get("month");
  if (month && !isPeriodMonth(month)) return fail("Bulan harus berformat YYYY-MM");
  const { rows } = await getPool().query(
    `SELECT p.id, p.coach_id, c.name AS coach_name, to_char(p.period_month, 'YYYY-MM') AS month,
            p.total_idr::float AS total_idr, p.status, p.payment_reference, p.note,
            (p.statement->'totals'->>'sessions')::int AS sessions,
            p.created_at, p.approved_at, p.paid_at, p.voided_at
       FROM gym.coach_payouts p JOIN gym.coaches c ON c.id = p.coach_id
      WHERE ($1::text IS NULL OR p.period_month = ($1 || '-01')::date)
      ORDER BY p.period_month DESC, (p.status = 'void'), c.name
      LIMIT 200`,
    [month]
  );
  return ok(rows);
});

/** POST — bekukan statement coach bulan itu jadi payout draf. 409 bila sudah ada payout aktif. */
export const POST = gymStaffRoute(IAM.gymIncentives, "Gagal membuat payout", async (userId, request: Request) => {
  const input = createSchema.parse(await request.json());
  const outcome = await createPayout(userId, input.coach_id, input.month);
  if (!outcome.ok) return fail(outcome.error, outcome.status);
  return ok({ id: outcome.id });
});
