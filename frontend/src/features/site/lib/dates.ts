/**
 * Date and time formatting for the public site: US English, in the branch's
 * zone (WIB without one) so the server (UTC) and the browser print the same
 * thing. Class times outside WIB carry the zone ("06:30 WITA").
 */

import { zoneName, zoneSuffix } from "@/lib/timezone";

const LOCALE = "en-US";

function format(iso: string, options: Intl.DateTimeFormatOptions, timeZone?: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(LOCALE, { timeZone: zoneName(timeZone), ...options });
}

/** "Oct 7, 2026" */
export const formatSiteDate = (iso: string, timeZone?: string) =>
  format(iso, { day: "numeric", month: "short", year: "numeric" }, timeZone);

/** "06:30" (24-hour), "06:30 WITA" outside WIB */
export const formatSiteTime = (iso: string, timeZone?: string) => {
  const time = format(iso, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, timeZone);
  return time && time + zoneSuffix(timeZone);
};

/** "Oct 7, 2026, 06:30" */
export const formatSiteDateTime = (iso: string, timeZone?: string) =>
  `${formatSiteDate(iso, timeZone)}, ${formatSiteTime(iso, timeZone)}`;

/** "Wednesday" */
export const formatSiteWeekday = (iso: string, timeZone?: string) => format(iso, { weekday: "long" }, timeZone);
