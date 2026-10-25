import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ERROR_MESSAGES } from "./error-codes";
import { ID } from "./i18n";
import {
  EMPTY_DRAFT,
  FEEDBACK_STATUS,
  draftPayload,
  draftProblem,
  eventLabel,
  recentCoaches,
  type FeedbackEvent,
  type RecentClass,
} from "./queries-feedback";

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join();

const FILES = ["../feedback/feedback-page.tsx", "../feedback/feedback-form-page.tsx", "../feedback/feedback-detail-page.tsx", "../profile/profile-page.tsx"];

const event = (e: Partial<FeedbackEvent>): FeedbackEvent => ({ kind: "status", to_status: null, body: null, by_member: false, created_at: "", ...e });

describe("feedback screen dictionary", () => {
  const keys = new Set<string>();
  for (const file of FILES) {
    const source = readFileSync(path.resolve(__dirname, file), "utf8");
    for (const match of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(match[1]);
  }
  const helperKeys = [
    "Report a problem",
    "Send feedback",
    ...Object.values(FEEDBACK_STATUS).map((s) => s.label),
    draftProblem(EMPTY_DRAFT)!,
    draftProblem({ ...EMPTY_DRAFT, category: "kelas" })!,
    draftProblem({ ...EMPTY_DRAFT, category: "kelas", message: "x".repeat(2001) })!,
    ...(["created", "reply"] as const).map((kind) => eventLabel(event({ kind }))),
    ...(["in_progress", "resolved", "reopened", "confirmed"] as const).flatMap((to_status) => [
      eventLabel(event({ to_status })),
      eventLabel(event({ to_status, by_member: true })),
    ]),
    eventLabel(event({})),
  ];
  const errorKeys = Object.entries(ERROR_MESSAGES)
    .filter(([code]) => code.startsWith("FEEDBACK_") || code.startsWith("COMPLAINT_"))
    .map(([, key]) => key);
  const all = [...keys, ...helperKeys, ...errorKeys];

  it("finds the screen's keys", () => {
    expect(keys.has("Send feedback or report a problem")).toBe(true);
    expect(errorKeys.length).toBe(7);
  });

  it("translates every key with the same placeholders", () => {
    expect(all.filter((key) => !(key in ID))).toEqual([]);
    expect(all.filter((key) => key in ID && placeholders(ID[key]) !== placeholders(key))).toEqual([]);
  });
});

const classes: RecentClass[] = [
  { session_id: "s1", name: "HYROX Engine", starts_at: "2026-10-25T11:00:00.000Z", timezone: "Asia/Jakarta", coach_id: "c2", coach_name: "Raka" },
  { session_id: "s2", name: "Strength", starts_at: "2026-10-24T11:00:00.000Z", timezone: "Asia/Jakarta", coach_id: "c1", coach_name: "Ayu" },
  { session_id: "s3", name: "Run Club", starts_at: "2026-10-23T11:00:00.000Z", timezone: "Asia/Jakarta", coach_id: "c2", coach_name: "Raka" },
  { session_id: "s4", name: "Open Gym", starts_at: "2026-10-22T11:00:00.000Z", timezone: "Asia/Jakarta", coach_id: null, coach_name: null },
];

describe("feedback form helpers", () => {
  it("asks for a category, then a long enough message", () => {
    expect(draftProblem(EMPTY_DRAFT)).toBe("Choose a category.");
    expect(draftProblem({ ...EMPTY_DRAFT, category: "kelas", message: "  terlalu  " })).toBe("Tell us a little more (at least {min} characters).");
    expect(draftProblem({ ...EMPTY_DRAFT, category: "kelas", message: "Kelas mulai terlambat" })).toBeNull();
    expect(draftProblem({ ...EMPTY_DRAFT, category: "kelas", message: "x".repeat(2001) })).toBe("Keep it under {max} characters.");
  });

  it("lists each recent coach once, by name", () => {
    expect(recentCoaches(classes)).toEqual([
      { id: "c1", name: "Ayu" },
      { id: "c2", name: "Raka" },
    ]);
    expect(recentCoaches([])).toEqual([]);
  });

  it("sends the class with its coach unless the member picked one", () => {
    const base = { ...EMPTY_DRAFT, category: "coach", message: "  Coach tidak memberi pemanasan  " };
    expect(draftPayload({ ...base, session_id: "s2" }, classes)).toEqual({
      kind: "problem",
      category: "coach",
      message: "Coach tidak memberi pemanasan",
      session_id: "s2",
      coach_id: "c1",
    });
    expect(draftPayload({ ...base, session_id: "s2", coach_id: "c2" }, classes).coach_id).toBe("c2");
    expect(draftPayload({ ...base, kind: "feedback" }, classes)).toMatchObject({ kind: "feedback", session_id: null, coach_id: null });
    expect(draftPayload({ ...base, session_id: "gone" }, classes)).toMatchObject({ session_id: null, coach_id: null });
  });
});
