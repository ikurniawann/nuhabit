import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { duplicateWeek } from "@/lib/gym/booking-server";
import { ok, schedulingRoute } from "@/lib/gym/scheduling-route";
import { weekStart } from "@/lib/gym/scheduling-schemas";

const schema = z.object({ source_week: weekStart, target_week: weekStart, publish: z.boolean().default(false) });

/** POST — salin jadwal satu minggu (Senin–Minggu WIB) ke minggu lain. */
export const POST = schedulingRoute(IAM.gymScheduling, "Gagal menyalin jadwal", async (userId, request: Request) => {
  const input = schema.parse(await request.json());
  const result = await withTransaction((client) =>
    duplicateWeek(client, {
      sourceWeekStart: input.source_week,
      targetWeekStart: input.target_week,
      publish: input.publish,
      createdBy: userId,
    })
  );
  return ok(result);
});
