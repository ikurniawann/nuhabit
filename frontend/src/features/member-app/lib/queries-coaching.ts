"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Assessment } from "@/lib/gym/assessments";
import type { Tone } from "../ui";
import { memberApi } from "./api";

/** Data hooks for personal training and fitness assessments (/api/member-portal/gym/pt, /gym/assessments). */

export type PtStatus = "requested" | "confirmed" | "completed" | "cancelled" | "no_show";

/** Status label (dictionary key) and tone of a PT session. */
export const PT_STATUS: Record<PtStatus, { label: string; tone: Tone }> = {
  requested: { label: "Waiting for coach", tone: "warn" },
  confirmed: { label: "Confirmed", tone: "ok" },
  completed: { label: "Completed", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "danger" },
  no_show: { label: "No-show", tone: "danger" },
};

export interface PtType {
  id: string;
  name: string;
  description: string;
  duration_min: number;
  credit_cost: number;
  capacity: number;
  credits_available: number;
}

export interface PtCoach {
  id: string;
  name: string;
  specialization: string;
  bio: string;
  photo_url: string | null;
}

export interface PtOptions {
  class_types: PtType[];
  coaches: PtCoach[];
  earliest_start: string;
  horizon_days: number;
}

export interface PtSession {
  participant_id: string;
  appointment_id: string;
  status: PtStatus;
  appointment_status: PtStatus;
  late_cancel: boolean;
  credits_charged: number;
  coach_id: string;
  coach_name: string;
  coach_photo_url: string | null;
  class_type_name: string;
  branch_name: string | null;
  starts_at: string;
  ends_at: string;
  credit_cost: number;
  capacity: number;
  notes: string;
  cancel_reason: string | null;
  free_cancel_until: string;
}

export interface PtSlot {
  starts_at: string;
  ends_at: string;
}

const keys = {
  options: ["member-app", "pt", "options"] as const,
  sessions: ["member-app", "pt", "sessions"] as const,
  slots: (coachId: string, typeId: string, from: string) => ["member-app", "pt", "slots", coachId, typeId, from] as const,
  assessments: ["member-app", "assessments"] as const,
};

export function usePtOptions() {
  return useQuery({ queryKey: keys.options, queryFn: () => memberApi<PtOptions>("/gym/pt/options") });
}

export function useMyPtSessions() {
  return useQuery({ queryKey: keys.sessions, queryFn: () => memberApi<PtSession[]>("/gym/pt/appointments") });
}

/** Free slots of one coach for one PT type, a week from `from` (YYYY-MM-DD, WIB). */
export function usePtSlots(coachId: string, typeId: string, from: string) {
  return useQuery({
    queryKey: keys.slots(coachId, typeId, from),
    queryFn: () =>
      memberApi<PtSlot[]>(
        `/gym/pt/slots?${new URLSearchParams({ coach_id: coachId, class_type_id: typeId, from, days: "7" })}`
      ),
    enabled: Boolean(coachId && typeId),
  });
}

function useRefreshPt() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["member-app", "pt"] });
}

export function useRequestPt() {
  const refresh = useRefreshPt();
  return useMutation({
    mutationFn: (input: { coach_id: string; class_type_id: string; starts_at: string; notes: string }) =>
      memberApi<{ id: string }>("/gym/pt/appointments", { method: "POST", json: input }),
    onSuccess: refresh,
  });
}

export function useCancelPt() {
  const refresh = useRefreshPt();
  return useMutation({
    mutationFn: (appointmentId: string) =>
      memberApi<{ late: boolean; penalty: number }>(`/gym/pt/appointments/${appointmentId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
}

export function useMyAssessments() {
  return useQuery({ queryKey: keys.assessments, queryFn: () => memberApi<Assessment[]>("/gym/assessments") });
}
