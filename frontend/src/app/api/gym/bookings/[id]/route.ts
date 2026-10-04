import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { withTransaction } from "@/lib/db";
import { cancelBooking, checkInBookingManually, markNoShow } from "@/lib/gym/booking-server";
import { ok, parseBody, requireUuid } from "@/lib/gym/staff-route";
import { IAM } from "@/lib/iam/prefixes";

type Ctx = { params: Promise<{ id: string }> };
const actionSchema = z.object({ action: z.enum(["cancel", "no_show", "check_in"]) });

/**
 * POST {action}: staf membatalkan (aturan batal terlambat tetap berlaku),
 * menandai tidak hadir, atau meng-check-in manual (kredit dipotong).
 */
export const POST = apiHandler(async (request: NextRequest, ctx: Ctx) => {
  const user = await requireIamMenuPrefix(IAM.gymScheduling);
  const bookingId = requireUuid((await ctx.params).id);
  const { action } = await parseBody(request, actionSchema);
  const result = await withTransaction(async (client) => {
    if (action === "cancel") return cancelBooking(client, { bookingId });
    if (action === "no_show") return markNoShow(client, { bookingId });
    return checkInBookingManually(client, { bookingId, scannedBy: user.id });
  });
  return ok(result);
}, "gym.bookings.[id].POST");
