import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { withTransaction } from "@/lib/db";
import { duplicateWeek } from "@/lib/gym/booking-server";
import { weekStart } from "@/lib/gym/scheduling-schemas";
import { ok, parseBody } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

const schema = z.object({ source_week: weekStart, target_week: weekStart, publish: z.boolean().default(false) });

/** POST: salin jadwal satu minggu (Senin s.d. Minggu WIB) ke minggu lain. */
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.gymScheduling);
  const input = await parseBody(request, schema);
  const result = await withTransaction((client) =>
    duplicateWeek(client, {
      sourceWeekStart: input.source_week,
      targetWeekStart: input.target_week,
      publish: input.publish,
      createdBy: user.id,
    })
  );
  return ok(result);
}, "gym.sessions.duplicate-week.POST");
