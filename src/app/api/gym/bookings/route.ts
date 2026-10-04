import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getPool, withTransaction } from "@/lib/db";
import { bookSession } from "@/lib/gym/booking-server";
import { optionalUuid, rangeParams } from "@/lib/gym/scheduling-route";
import { listBookings } from "@/lib/gym/session-queries";
import { ok, parseBody } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

/** GET ?from&to&status&q&session_id: booking per jadwal sesi. */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.gymScheduling);
  const url = request.nextUrl;
  const rows = await listBookings(getPool(), {
    ...rangeParams(url, 14),
    status: url.searchParams.get("status"),
    q: url.searchParams.get("q")?.trim() || null,
    sessionId: optionalUuid(url, "session_id") ?? null,
  });
  return ok(rows);
}, "gym.bookings.GET");

const bookSchema = z.object({ session_id: z.string().uuid(), customer_id: z.string().uuid() });

/** POST: staf mendaftarkan member (aturan sama dengan booking dari portal). */
export const POST = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.gymScheduling);
  const input = await parseBody(request, bookSchema);
  const result = await withTransaction((client) =>
    bookSession(client, { customerId: input.customer_id, sessionId: input.session_id, source: "admin" })
  );
  return ok(result);
}, "gym.bookings.POST");
