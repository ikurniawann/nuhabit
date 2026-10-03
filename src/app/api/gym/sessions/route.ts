import { getPool, withTransaction } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { createSession, listSessions } from "@/lib/gym/booking-server";
import { SESSION_STATUSES, type SessionStatus } from "@/lib/gym/booking";
import { ok, optionalUuid, rangeParams, schedulingRoute } from "@/lib/gym/scheduling-route";
import { sessionCreateSchema } from "@/lib/gym/scheduling-schemas";

/** GET ?from&to&class_type_id&coach_id&branch_id&status=a,b — sesi + hitungan kursi. */
export const GET = schedulingRoute(IAM.gymScheduling, "Gagal memuat sesi", async (_userId, request: Request) => {
  const url = new URL(request.url);
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
});

/** POST — jadwalkan sesi; nilai kosong diambil dari jenis kelas, jendela booking dari aturan. */
export const POST = schedulingRoute(IAM.gymScheduling, "Gagal membuat sesi", async (userId, request: Request) => {
  const input = sessionCreateSchema.parse(await request.json());
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
      userId
    )
  );
  return ok({ id });
});
