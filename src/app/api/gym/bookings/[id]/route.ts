import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { cancelBooking, checkInBookingManually, markNoShow } from "@/lib/gym/booking-server";
import { ok, schedulingRoute, uuid } from "@/lib/gym/scheduling-route";

type Ctx = { params: Promise<{ id: string }> };
const actionSchema = z.object({ action: z.enum(["cancel", "no_show", "check_in"]) });

/**
 * POST {action} — staf membatalkan (aturan batal terlambat tetap berlaku),
 * menandai tidak hadir, atau meng-check-in manual (kredit dipotong).
 */
export const POST = schedulingRoute(IAM.gymScheduling, "Gagal memproses booking", async (userId, request: Request, ctx: Ctx) => {
  const bookingId = uuid.parse((await ctx.params).id);
  const { action } = actionSchema.parse(await request.json());
  const result = await withTransaction(async (client) => {
    if (action === "cancel") return cancelBooking(client, { bookingId });
    if (action === "no_show") return markNoShow(client, { bookingId });
    return checkInBookingManually(client, { bookingId, scannedBy: userId });
  });
  return ok(result);
});
