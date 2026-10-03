"use client";

import { useQuery } from "@tanstack/react-query";
import type { BookingStatus } from "@/lib/gym/booking";
import { memberApi } from "../mobile-api";

/** Data portal untuk jadwal kelas gym, booking, dan coach (API /api/member-portal/gym/*). */

export interface CancelInfo {
  deadline: string;
  late: boolean;
  penalty_credits: number;
  policy: "forfeit" | "free";
}

export interface MyBooking {
  id: string;
  status: BookingStatus;
  waitlist_position: number | null;
  promotion_offered_at: string | null;
}

export interface GymClass {
  id: string;
  class_type_id: string;
  class_type_name: string;
  coach_id: string | null;
  coach_name: string | null;
  area: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  credit_cost: number;
  status: "published" | "full";
  confirmed_count: number;
  waitlist_count: number;
  seats_left: number;
  my_booking: MyBooking | null;
  cancel_info: CancelInfo | null;
}

export interface GymClassDetail extends GymClass {
  description: string | null;
  coach_specialization: string | null;
  coach_bio: string | null;
}

export interface MyClass {
  id: string;
  status: BookingStatus;
  waitlist_position: number | null;
  late_cancel: boolean;
  promotion_offered_at: string | null;
  checked_in_at: string | null;
  session_id: string;
  starts_at: string;
  ends_at: string;
  area: string | null;
  credit_cost: number;
  class_type_name: string;
  coach_name: string | null;
  cancel_info: CancelInfo | null;
}

export interface GymCoach {
  id: string;
  name: string;
  bio: string;
  specialization: string;
  photo_url: string | null;
  upcoming_sessions: number;
}

export const GYM_MEMBER_KEYS = {
  all: ["member-portal", "gym-classes"],
  sessions: (date: string, classTypeId: string) => ["member-portal", "gym-classes", "sessions", date, classTypeId],
  session: (id: string) => ["member-portal", "gym-classes", "session", id],
  mine: (scope: "upcoming" | "past") => ["member-portal", "gym-classes", "mine", scope],
  coaches: ["member-portal", "gym-classes", "coaches"],
  coach: (id: string) => ["member-portal", "gym-classes", "coach", id],
} as const;

export const useGymClasses = (date: string, classTypeId: string) =>
  useQuery({
    queryKey: GYM_MEMBER_KEYS.sessions(date, classTypeId),
    queryFn: () =>
      memberApi<{ sessions: GymClass[]; credits: number; class_types: { id: string; name: string }[] }>(
        `/api/member-portal/gym/sessions?${new URLSearchParams({ date, ...(classTypeId ? { class_type_id: classTypeId } : {}) })}`
      ),
  });

export const useGymClass = (id: string) =>
  useQuery({
    queryKey: GYM_MEMBER_KEYS.session(id),
    queryFn: () => memberApi<GymClassDetail>(`/api/member-portal/gym/sessions/${id}`),
  });

export const useMyClasses = (scope: "upcoming" | "past") =>
  useQuery({
    queryKey: GYM_MEMBER_KEYS.mine(scope),
    queryFn: () => memberApi<MyClass[]>(`/api/member-portal/gym/bookings?scope=${scope}`),
  });

export const useGymCoaches = () =>
  useQuery({ queryKey: GYM_MEMBER_KEYS.coaches, queryFn: () => memberApi<GymCoach[]>("/api/member-portal/gym/coaches") });

export const useGymCoach = (id: string) =>
  useQuery({
    queryKey: GYM_MEMBER_KEYS.coach(id),
    queryFn: () => memberApi<GymCoach & { sessions: Omit<GymClass, "cancel_info">[] }>(`/api/member-portal/gym/coaches/${id}`),
  });

/** "YYYY-MM-DD" hari ini dan N hari berikutnya, dalam WIB. */
export function wibDays(count: number, from = new Date()): string[] {
  const start = new Date(from.getTime() + 7 * 3_600_000);
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i)).toISOString().slice(0, 10)
  );
}

export const jamWib = (iso: string, locale = "id-ID") =>
  new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
