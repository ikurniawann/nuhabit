import { ApiError } from "@/lib/api/auth";
import { getMemberSession } from "@/lib/member-portal/session";
import type { BookingActor } from "@/lib/studio/booking-server";
import { defaultVenue } from "@/lib/studio/server";

/** Konteks member Member App: sesi OTP + venue default (member tidak punya scope bisnis). */
export async function requireMemberStudio(): Promise<{ customerId: string; actor: BookingActor }> {
  const session = await getMemberSession();
  if (!session) throw ApiError.unauthorized("Please sign in to the Member App");
  const venue = await defaultVenue();
  return { customerId: session.customerId, actor: { ...venue, actorId: null, staff: false } };
}
