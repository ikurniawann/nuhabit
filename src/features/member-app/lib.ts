/** Helper & tipe Member App NüHabit (EPIC-057). UI berbahasa Inggris (keputusan owner 2026-10-02). */

import { toEnglish } from "./i18n";

export class MemberApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function memberFetch<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      cache: "no-store",
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) throw new MemberApiError(toEnglish(body.error ?? body.message), res.status);
    return body as T;
  } catch (e) {
    if (e instanceof MemberApiError) throw e;
    throw new MemberApiError("Connection problem. Please try again.", 0);
  } finally {
    clearTimeout(timer);
  }
}

export interface MemberProfile {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}

export interface ClassSlot {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  program_name: string;
  program_description: string | null;
  level_label: string | null;
  coach_id: string | null;
  coach_name: string | null;
  coach_photo: string | null;
  capacity: number;
  spots_left: number;
  waitlist_count: number;
  my_booking_id: string | null;
  my_status: "booked" | "waitlisted" | "attended" | null;
}

export interface ScheduleRules {
  cancel_window_hours: number;
  booking_open_days: number;
}

export interface MyBooking {
  id: string;
  status: "booked" | "waitlisted" | "attended" | "cancelled" | "late_cancelled" | "no_show";
  session_id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  program_name: string;
  program_kind: "class" | "pt";
  coach_name: string | null;
  pass_code: string | null;
  upcoming: boolean;
}

export interface MyPass {
  id: string;
  pass_code: string;
  product_name: string;
  category: string;
  class_credits_total: number;
  pt_credits_total: number;
  facility_access: boolean;
  class_left: number;
  pt_left: number;
  valid_from: string;
  valid_until: string;
  status: "active" | "scheduled" | "expired" | "exhausted" | "cancelled" | "pending_payment";
}

export interface CoachProfile {
  id: string;
  name: string;
  level: "coach" | "head_coach";
  photo_url: string | null;
  bio: string | null;
  certifications: string | null;
  specialties: string[] | null;
  offers_pt: boolean;
}

export interface PtCatalogEntry {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  level_label: string | null;
  coaches: { id: string; full_name: string; display_name: string | null; level: "coach" | "head_coach"; photo_url: string | null; bio: string | null; specialties: string[] | null }[];
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const asUtc = (date: string) => new Date(`${date}T00:00:00Z`);

/** Hari ini menurut zona venue (WIB). */
export function wibToday(): string {
  return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
}

export function addDaysIso(date: string, days: number): string {
  const d = asUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayName(date: string): string {
  return DAYS[asUtc(date).getUTCDay()];
}

export function dayShort(date: string): string {
  return DAYS_SHORT[asUtc(date).getUTCDay()];
}

/** "4 Oct" */
export function dateLabel(date: string): string {
  const d = asUtc(date);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Tanggal saja (angka) untuk strip hari. */
export function dayNumber(date: string): string {
  return String(asUtc(date).getUTCDate());
}

/** "Saturday, 4 Oct", or "Today" / "Tomorrow". */
export function friendlyDay(date: string): string {
  const today = wibToday();
  if (date === today) return "Today";
  if (date === addDaysIso(today, 1)) return "Tomorrow";
  return `${dayName(date)}, ${dateLabel(date)}`;
}

/** Jam 24-jam "06:30" (tampilan Inggris memakai titik dua). */
export function jam(t: string): string {
  return t.slice(0, 5);
}

export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "Athlete";
}

export function rupiah(v: number): string {
  return `Rp ${Math.round(v).toLocaleString("en-US")}`;
}

export function num(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}
