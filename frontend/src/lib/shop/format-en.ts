// English date formatting for the storefront and the wholesale portal.
// Shares the WIB anchor with @/lib/format so server and browser agree.

const LOCALE = "en-US";
const TIME_ZONE = "Asia/Jakarta";

type DateLike = Date | string | number | null | undefined;

function toDate(value: DateLike): Date | null {
  if (value === null || value === undefined || value === "") return null;
  // "YYYY-MM-DD" is a calendar date: anchor it to noon WIB so it never shifts.
  const d =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00+07:00`)
      : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function format(value: DateLike, options: Intl.DateTimeFormatOptions, fallback: string): string {
  const d = toDate(value);
  return d ? d.toLocaleString(LOCALE, { timeZone: TIME_ZONE, ...options }) : fallback;
}

/** "Oct 4, 2026" */
export const formatDateEn = (value: DateLike, fallback = "-") =>
  format(value, { month: "short", day: "numeric", year: "numeric" }, fallback);

/** "Oct 4, 2026, 2:30 PM" */
export const formatDateTimeEn = (value: DateLike, fallback = "-") =>
  format(value, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }, fallback);
