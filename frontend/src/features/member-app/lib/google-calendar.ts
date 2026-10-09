/** Open a prefilled Google Calendar event; the member saves it in Google. */
export function googleCalendarEventUrl(input: {
  title: string;
  startsAt: string;
  endsAt: string;
  branchName?: string | null;
  coachName?: string | null;
}): string | null {
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;

  const calendarTime = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", `NüHabit · ${input.title}`);
  url.searchParams.set("dates", `${calendarTime(start)}/${calendarTime(end)}`);
  if (input.branchName) url.searchParams.set("location", input.branchName);
  url.searchParams.set("details", ["NüHabit class booking", input.coachName && `Coach: ${input.coachName}`].filter(Boolean).join("\n"));
  return url.toString();
}
