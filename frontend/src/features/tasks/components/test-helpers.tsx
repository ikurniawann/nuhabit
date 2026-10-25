import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import { expect, vi } from "vitest";
import { IamAccessProvider } from "@/components/iam/iam-access-provider";
import type { TaskItem, TaskMeta } from "../types";

export const TODAY = "2026-10-26";

export const meta: TaskMeta = {
  me: {
    user_id: "u-alice",
    name: "Alice",
    employee_id: "e-alice",
    department_id: "d-ops",
    has_subordinates: true,
    is_hr: false,
    team_all: false,
    kpi_all: false,
    timezone: "Asia/Jakarta",
  },
  team_scope: "heads",
  departments: [{ id: "d-ops", name: "Operasional" }],
  members: [
    { id: "e-alice", full_name: "Alice", department_id: "d-ops" },
    { id: "e-bob", full_name: "Bob", department_id: "d-ops" },
  ],
  indicators: [{ id: "k-1", code: "lead_baru", name: "Lead baru", unit: "lead", direction: "higher_better", department_ids: ["d-ops"] }],
  today: TODAY,
};

export function item(over: Partial<TaskItem>): TaskItem {
  return {
    occurrence_id: "o-" + Math.random().toString(36).slice(2, 8),
    task_id: "t-1",
    title: "Tugas",
    description: "",
    department_id: "d-ops",
    department_name: "Operasional",
    assignee_employee_id: "e-alice",
    assignee_name: "Alice",
    created_by_user_id: "u-alice",
    created_by_name: "Alice",
    occurrence_date: TODAY,
    status: "pending",
    progress_percent: null,
    started_at: null,
    done_at: null,
    done_by_name: null,
    review_notes: null,
    reviewed_by_name: null,
    recurrence: "once",
    priority: "normal",
    review_required: false,
    timezone: "Asia/Jakarta",
    kpi_indicator_id: null,
    kpi_indicator_code: null,
    kpi_indicator_name: null,
    kpi_contribution: null,
    subtask_count: 0,
    comment_count: 0,
    attachment_count: 0,
    last_note: null,
    last_note_by: null,
    last_note_at: null,
    progress: 0,
    overdue: false,
    mine: true,
    can_work: true,
    can_review: false,
    can_manage: true,
    ...over,
  };
}

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, data }), { status, headers: { "Content-Type": "application/json" } });

/** fetch palsu: meta dan daftar; POST/PATCH dicatat dan dijawab 200. */
export function mockApi(items: TaskItem[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method, url, body });
    if (url.startsWith("/api/hris/dept-tasks/meta")) return ok(meta);
    if (method === "POST" && url === "/api/hris/dept-tasks")
      return new Response(JSON.stringify({ message: "Task dibuat", data: { id: "t-new" } }), { status: 201 });
    if (method === "PATCH") return new Response(JSON.stringify({ message: "ok" }), { status: 200 });
    if (url.startsWith("/api/hris/dept-tasks/items?")) return ok(items);
    return ok(null, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

export function Providers({ children, actions = ["read", "create", "update"] }: { children: ReactNode; actions?: string[] }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <IamAccessProvider grantedCodes={["tasks"]} grantedActions={{ tasks: actions }}>
        {children}
      </IamAccessProvider>
    </QueryClientProvider>
  );
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
