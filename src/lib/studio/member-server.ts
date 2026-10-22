import { ApiError } from "@/lib/api/auth";
import { getMemberSession } from "@/lib/member-portal/session";
import type { BookingActor } from "@/lib/studio/booking-server";
import { defaultVenue } from "@/lib/studio/server";
import { getSettings, SETTING_KEYS } from "@/lib/settings/app-settings";

/** Konteks member Member App: sesi OTP + venue default (member tidak punya scope bisnis). */
export async function requireMemberStudio(): Promise<{ customerId: string; actor: BookingActor }> {
  const session = await getMemberSession();
  if (!session) throw ApiError.unauthorized("Please sign in to the Member App");
  const venue = await defaultVenue();
  return { customerId: session.customerId, actor: { ...venue, actorId: null, staff: false } };
}

/**
 * Nama & alamat venue untuk event "Add to Google Calendar" (revisi client
 * 2026-10-22). Alamat dari Profil perusahaan (company_address + company_city);
 * kosong → hanya nama venue.
 */
export async function memberVenueInfo(): Promise<{ name: string; address: string | null }> {
  const s = await getSettings([SETTING_KEYS.COMPANY_ADDRESS, SETTING_KEYS.COMPANY_CITY]);
  const address = [s[SETTING_KEYS.COMPANY_ADDRESS], s[SETTING_KEYS.COMPANY_CITY]].map((v) => v?.trim()).filter(Boolean).join(", ");
  return { name: "NüHabit Hyrox Studio", address: address || null };
}
