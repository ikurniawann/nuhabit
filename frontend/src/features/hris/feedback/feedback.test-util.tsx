import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import { expect, vi } from "vitest";
import type { FeedbackCategory, FeedbackCycle, MyFeedbackDetail } from "./types";

export function cycle(over: Partial<FeedbackCycle> = {}): FeedbackCycle {
  return {
    id: "c-1",
    name: "Review Q4 2026",
    period_label: "Q4 2026",
    start_date: "2026-10-01T00:00:00.000Z",
    end_date: "2026-12-31T00:00:00.000Z",
    status: "active",
    kpi_weight: "70.00",
    feedback_weight: "30.00",
    is_anonymous: true,
    allow_self_assessment: true,
    require_manager_review: true,
    created_by: { id: "e-hr", full_name: "HR" },
    assignments_count: [{ count: 4 }],
    summaries_count: [{ count: 1 }],
    completed_count: 1,
    ...over,
  };
}

export const CATEGORIES: FeedbackCategory[] = [
  {
    id: "cat-1",
    name: "Leadership",
    description: null,
    weight: "20.00",
    criteria: [
      { id: "cr-1", name: "Menetapkan arah", description: null },
      { id: "cr-2", name: "Memotivasi", description: null },
    ],
  },
  { id: "cat-2", name: "Communication", description: null, weight: "20.00", criteria: [{ id: "cr-3", name: "Mendengarkan", description: null }] },
];

export function detail(over: Partial<MyFeedbackDetail> = {}): MyFeedbackDetail {
  return {
    id: "a-1",
    status: "in_progress",
    relationship_type: "peer",
    due_date: "2026-11-15T00:00:00.000Z",
    submitted_at: null,
    rejection_reason: null,
    manager_comments: null,
    answered: 1,
    employee: { id: "e-2", full_name: "Budi", department: { name: "Operasional" } },
    cycle: { id: "c-1", name: "Review Q4 2026", period_label: "Q4 2026", end_date: "2026-12-31T00:00:00.000Z", is_anonymous: true },
    editable: true,
    categories: CATEGORIES,
    responses: [{ criteria_id: "cr-1", rating: 4, comments: "Jelas" }],
    ...over,
  };
}

export type Call = { method: string; url: string; body: unknown };

/** fetch palsu: `routes` memetakan "METHOD /path" (tanpa query) ke body JSON. */
export function mockFetch(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      const key = `${method} ${url.split("?")[0]}`;
      if (!(key in routes)) return new Response(JSON.stringify({ error: `unmocked ${key}` }), { status: 404 });
      return new Response(JSON.stringify(routes[key]), { status: 200, headers: { "Content-Type": "application/json" } });
    })
  );
  return calls;
}

export function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Tidak ada pelanggaran axe WCAG 2 A/AA berdampak serius atau kritis. */
export async function expectAxeClean(container: HTMLElement) {
  const result = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    // Warna dihitung dari token CSS yang tidak dimuat jsdom.
    rules: { "color-contrast": { enabled: false } },
  });
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}
