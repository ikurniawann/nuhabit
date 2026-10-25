"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Tone } from "../ui";
import { memberApi } from "./api";

/** Data hooks and form rules of "Feedback & reports" (/api/member-portal/gym/feedback). */

export type FeedbackStatus = "received" | "in_progress" | "resolved" | "confirmed" | "reopened";
export type FeedbackKind = "problem" | "feedback";

/** Status label (dictionary key) and tone as the member sees it. */
export const FEEDBACK_STATUS: Record<FeedbackStatus, { label: string; tone: Tone }> = {
  received: { label: "Received", tone: "info" },
  in_progress: { label: "In progress", tone: "warn" },
  resolved: { label: "Resolved, please confirm", tone: "brand" },
  confirmed: { label: "Closed", tone: "neutral" },
  reopened: { label: "Reopened", tone: "danger" },
};

export interface FeedbackTicket {
  id: string;
  code: string;
  category: string;
  category_label: string;
  status: FeedbackStatus;
  title: string;
  description: string | null;
  coach_name: string | null;
  session_name: string | null;
  session_starts_at: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface FeedbackEvent {
  kind: "created" | "status" | "reply";
  to_status: FeedbackStatus | null;
  body: string | null;
  by_member: boolean;
  created_at: string;
}

export interface FeedbackDetail extends FeedbackTicket {
  events: FeedbackEvent[];
}

export interface RecentClass {
  session_id: string;
  name: string;
  starts_at: string;
  timezone: string;
  coach_id: string | null;
  coach_name: string | null;
}

export interface FeedbackOptions {
  categories: { code: string; label: string }[];
  classes: RecentClass[];
}

export interface FeedbackDraft {
  kind: FeedbackKind;
  category: string;
  message: string;
  session_id: string;
  coach_id: string;
}

export const EMPTY_DRAFT: FeedbackDraft = { kind: "problem", category: "", message: "", session_id: "", coach_id: "" };

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 2000;

/** The first thing to fix before sending, as a dictionary key; null when the draft can go. */
export function draftProblem(d: FeedbackDraft): string | null {
  if (!d.category) return "Choose a category.";
  const n = d.message.trim().length;
  if (n < MESSAGE_MIN) return "Tell us a little more (at least {min} characters).";
  if (n > MESSAGE_MAX) return "Keep it under {max} characters.";
  return null;
}

/** The coaches of the member's recent classes, once each, by name. */
export function recentCoaches(classes: RecentClass[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const c of classes) if (c.coach_id && c.coach_name && !seen.has(c.coach_id)) seen.set(c.coach_id, c.coach_name);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The request body: a picked class brings its coach unless the member chose one. */
export function draftPayload(d: FeedbackDraft, classes: RecentClass[]) {
  const picked = classes.find((c) => c.session_id === d.session_id);
  return {
    kind: d.kind,
    category: d.category,
    message: d.message.trim(),
    session_id: picked ? picked.session_id : null,
    coach_id: d.coach_id || picked?.coach_id || null,
  };
}

/** One history line as a dictionary key. */
export function eventLabel(e: FeedbackEvent): string {
  if (e.kind === "created") return "Report received";
  if (e.kind === "reply") return "Reply from the NüHabit team";
  switch (e.to_status) {
    case "in_progress":
      return "We're working on it";
    case "resolved":
      return "Marked as resolved";
    case "reopened":
      return e.by_member ? "You reopened it" : "Reopened";
    case "confirmed":
      return e.by_member ? "You confirmed it's resolved" : "Closed";
    default:
      return "Updated";
  }
}

const key = ["member-app", "feedback"] as const;

export function useMyFeedback() {
  return useQuery({ queryKey: [...key, "list"], queryFn: () => memberApi<FeedbackTicket[]>("/gym/feedback") });
}

export function useFeedback(id: string) {
  return useQuery({ queryKey: [...key, "detail", id], queryFn: () => memberApi<FeedbackDetail>(`/gym/feedback/${id}`) });
}

export function useFeedbackOptions() {
  return useQuery({ queryKey: [...key, "options"], queryFn: () => memberApi<FeedbackOptions>("/gym/feedback/options") });
}

export function useSendFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ReturnType<typeof draftPayload>) =>
      memberApi<{ id: string; code: string }>("/gym/feedback", { method: "POST", json: body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Confirm a resolved report, or reopen it with a reason. */
export function useAnswerFeedback(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (a: { action: "confirm" } | { action: "reopen"; reason: string }) =>
      memberApi<FeedbackDetail>(`/gym/feedback/${id}/${a.action}`, {
        method: "POST",
        json: a.action === "reopen" ? { reason: a.reason } : {},
      }),
    onSuccess: (data) => {
      queryClient.setQueryData([...key, "detail", id], data);
      void queryClient.invalidateQueries({ queryKey: [...key, "list"] });
    },
  });
}
