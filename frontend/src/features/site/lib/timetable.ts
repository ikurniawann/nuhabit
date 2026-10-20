import { todayWib } from "@/lib/dates";
import { localDay } from "@/lib/timezone";

/**
 * Pure helpers for the public timetable panel. Dates are calendar days in
 * the branch zone as "YYYY-MM-DD"; weeks start on Monday, matching
 * GET /api/public/site/sessions?branch=&week=. The week window opens on the
 * WIB week; the API moves an earlier Monday to the branch's own week.
 */

/** How many weeks past the current one the API serves. */
export const WEEKS_AHEAD = 8;

export const DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** `color` is a scheduling colour token (see CLASS_COLOR in features/gym/scheduling/api). */
export interface PublicClassType {
  name: string;
  color: string;
}

export interface PublicSession {
  id: string;
  starts_at: string;
  ends_at: string;
  duration_min: number;
  class_type: PublicClassType;
  coach_name: string | null;
  capacity: number;
  seats_left: number;
  waitlist_open: boolean;
  /** The branch zone, copied from the timetable's branch by fetchSessionsAhead. */
  timezone?: string;
}

export interface PublicTimetable {
  branch: { slug: string; name: string; timezone?: string };
  week_start: string;
  sessions: PublicSession[];
}

function utcNoon(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function addDays(day: string, n: number): string {
  const date = utcNoon(day);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** 0 for Monday through 6 for Sunday. */
export function weekdayIndex(day: string): number {
  return (utcNoon(day).getUTCDay() + 6) % 7;
}

export function mondayOf(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

/** The seven calendar days of the week starting on monday. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The Mondays the API accepts: this week through WEEKS_AHEAD weeks ahead. */
export function weekWindow(now = new Date()): { first: string; last: string } {
  const first = mondayOf(todayWib(now));
  return { first, last: addDays(first, 7 * WEEKS_AHEAD) };
}

export function clampWeek(monday: string, window: { first: string; last: string }): string {
  if (monday < window.first) return window.first;
  if (monday > window.last) return window.last;
  return monday;
}

/** Sessions keyed by their day in the branch zone (WIB without one), in start order, for the week's seven days. */
export function groupByDay(sessions: PublicSession[], monday: string, timeZone?: string): Map<string, PublicSession[]> {
  const groups = new Map<string, PublicSession[]>(weekDays(monday).map((day) => [day, []]));
  for (const s of [...sessions].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    groups.get(localDay(s.starts_at, timeZone))?.push(s);
  }
  return groups;
}

/** "Oct 6" for a day tab. */
export function shortDate(day: string): string {
  return utcNoon(day).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function sessionHref(id: string): string {
  return `/member/classes/${encodeURIComponent(id)}`;
}
