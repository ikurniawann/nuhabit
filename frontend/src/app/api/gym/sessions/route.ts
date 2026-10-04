import type { NextRequest } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getPool, withTransaction } from "@/lib/db";
import { SESSION_STATUSES, type SessionStatus } from "@/lib/gym/booking";
import { createSession, listSessions } from "@/lib/gym/booking-server";
import { optionalUuid, rangeParams } from "@/lib/gym/scheduling-route";
import { sessionCreateSchema } from "@/lib/gym/scheduling-schemas";
import { ok, parseBody } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

/** GET ?from&to&class_type_id&coach_id&branch_id&status=a,b: sesi + hitungan kursi. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.gymScheduling);
  const url = request.nextUrl;
  const statuses = (url.searchParams.get("status") ?? "")
    .split(",")
    .filter((s): s is SessionStatus => (SESSION_STATUSES as readonly string[]).includes(s));
  const sessions = await listSessions(getPool(), {
    ...rangeParams(url, 7),
    classTypeId: optionalUuid(url, "class_type_id"),
    coachId: optionalUuid(url, "coach_id"),
    branchId: optionalUuid(url, "branch_id"),
    statuses: statuses.length ? statuses : undefined,
  });
  return ok(sessions);
}, "gym.sessions.GET");

/** POST: jadwalkan sesi; nilai kosong diambil dari jenis kelas, jendela booking dari aturan. */
export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.gymScheduling);
  const input = await parseBody(request, sessionCreateSchema);
  const id = await withTransaction((client) =>
    createSession(
      client,
      {
        classTypeId: input.class_type_id,
        coachId: input.coach_id,
        branchId: input.branch_id,
        area: input.area,
        startsAt: input.starts_at,
        durationMin: input.duration_min,
        capacity: input.capacity,
        creditCost: input.credit_cost,
        notes: input.notes,
        publish: input.publish,
      },
      user.id
    )
  );
  return ok({ id });
}, "gym.sessions.POST");
