import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { cancelBooking, confirmWaitlistOffer } from "@/lib/gym/booking-server";
import { memberSchedulingRoute, uuid } from "@/lib/gym/scheduling-route";
import { memberJson } from "@/lib/member-portal/route";

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE — batalkan booking sendiri. Hasil menyebut apakah batal terlambat
 * dan berapa kredit hangus; pratinjaunya ada di `cancel_info` daftar kelas.
 */
export const DELETE = memberSchedulingRoute("Gagal membatalkan booking", async (customerId, _request: Request, ctx: Ctx) => {
  const bookingId = uuid.parse((await ctx.params).id);
  const result = await withTransaction((client) => cancelBooking(client, { bookingId, customerId }));
  return memberJson({ late: result.late, deadline: result.deadline, penalty_credits: result.penaltyCredits });
});

const actionSchema = z.object({ action: z.literal("confirm_offer") });

/** POST {action: "confirm_offer"} — terima kursi yang ditawarkan dari waitlist. */
export const POST = memberSchedulingRoute("Gagal mengonfirmasi kursi", async (customerId, request: Request, ctx: Ctx) => {
  const bookingId = uuid.parse((await ctx.params).id);
  actionSchema.parse(await request.json());
  await withTransaction((client) => confirmWaitlistOffer(client, { bookingId, customerId }));
  return memberJson({ id: bookingId, status: "confirmed" });
});
