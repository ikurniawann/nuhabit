/**
 * "Add to Google Calendar" di Member App (revisi client 2026-10-22). Memakai
 * link template Google Calendar (calendar.google.com/calendar/render?action=TEMPLATE)
 * — tanpa OAuth/izin akun; member menyimpan sendiri dari Google Calendar.
 * Jam sesi disimpan sebagai WIB (UTC+7) lalu dikirim dalam UTC.
 */

export interface VenueInfo {
  name: string;
  address: string | null;
}

export const DEFAULT_VENUE: VenueInfo = { name: "NüHabit Hyrox Studio", address: null };

/** "2026-10-23" + "07:00" WIB → "20261023T000000Z". */
export function toGoogleUtc(date: string, time: string): string {
  const ms = Date.parse(`${date}T${time.slice(0, 5)}:00+07:00`);
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function googleCalendarUrl(e: {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  details?: string;
  venue?: VenueInfo;
}): string {
  const venue = e.venue ?? DEFAULT_VENUE;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${toGoogleUtc(e.date, e.startTime)}/${toGoogleUtc(e.date, e.endTime)}`,
    ctz: "Asia/Jakarta",
    location: venue.address ? `${venue.name}, ${venue.address}` : venue.name,
  });
  if (e.details) params.set("details", e.details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Event untuk sesi kelas / Personal Training yang sudah dibooking. */
export function sessionCalendarUrl(s: {
  programName: string;
  kind: "class" | "pt";
  date: string;
  startTime: string;
  endTime: string;
  coachName: string | null;
  cancelWindowHours: number;
  appUrl: string;
  venue?: VenueInfo;
}): string {
  const what = s.kind === "pt" ? `Personal Training — ${s.programName}` : s.programName;
  const details = [
    s.coachName ? `Coach: ${s.coachName}` : null,
    "Booked via the NüHabit Member App.",
    `Can't make it? Cancel in the Member App at least ${s.cancelWindowHours} hours before so your credit is returned.`,
    s.appUrl,
  ]
    .filter(Boolean)
    .join("\n");
  return googleCalendarUrl({ title: `NüHabit · ${what}`, date: s.date, startTime: s.startTime, endTime: s.endTime, details, venue: s.venue });
}
