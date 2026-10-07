/**
 * Date and time formatting for the public site: US English, always in WIB
 * so the server (UTC) and the browser print the same thing.
 */

const LOCALE = "en-US";
const TIME_ZONE = "Asia/Jakarta";

function format(iso: string, options: Intl.DateTimeFormatOptions): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(LOCALE, { timeZone: TIME_ZONE, ...options });
}

/** "Oct 7, 2026" */
export const formatSiteDate = (iso: string) => format(iso, { day: "numeric", month: "short", year: "numeric" });

/** "06:30" (24-hour) */
export const formatSiteTime = (iso: string) => format(iso, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "Oct 7, 2026, 06:30" */
export const formatSiteDateTime = (iso: string) => `${formatSiteDate(iso)}, ${formatSiteTime(iso)}`;
