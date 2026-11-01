import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { cycle, mockFetch, Providers } from "./feedback.test-util";
import { useCreateFeedbackAssignments, useSaveFeedbackCycle } from "./mutations";
import { useFeedbackAssignments, useFeedbackCycles, useMyFeedback } from "./queries";

describe("feedback hooks", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads cycles and waits for a cycle before reading its assignments", async () => {
    const calls = mockFetch({
      "GET /api/hris/feedback-cycles": { data: [cycle()] },
      "GET /api/hris/feedback-assignments": { data: [] },
    });
    const { result } = renderHook(
      () => ({ cycles: useFeedbackCycles(), none: useFeedbackAssignments(""), some: useFeedbackAssignments("c-1") }),
      { wrapper: Providers }
    );
    await waitFor(() => expect(result.current.cycles.data).toHaveLength(1));
    await waitFor(() => expect(result.current.some.data).toEqual([]));
    expect(result.current.none.fetchStatus).toBe("idle");
    expect(calls.map((c) => c.url)).toEqual([
      "/api/hris/feedback-cycles?limit=100",
      "/api/hris/feedback-assignments?cycle_id=c-1&limit=500",
    ]);
  });

  it("updates an existing cycle with PUT, creates with POST and refreshes the feedback queries", async () => {
    const calls = mockFetch({
      "GET /api/hris/me/feedback-360": { data: [], criteria_total: 0 },
      "PUT /api/hris/feedback-cycles/c-1": { data: cycle() },
      "POST /api/hris/feedback-assignments": { data: [] },
    });
    const { result } = renderHook(
      () => ({ mine: useMyFeedback(), save: useSaveFeedbackCycle(), assign: useCreateFeedbackAssignments() }),
      { wrapper: Providers }
    );
    await waitFor(() => expect(result.current.mine.isSuccess).toBe(true));
    await act(() => result.current.save.mutateAsync({ id: "c-1", payload: { status: "closed" } }));
    await act(() =>
      result.current.assign.mutateAsync([
        { cycle_id: "c-1", employee_id: "e-1", reviewer_id: "e-2", relationship_type: "peer", due_date: null },
      ])
    );
    await waitFor(() => expect(calls.filter((c) => c.url === "/api/hris/me/feedback-360")).toHaveLength(3));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ status: "closed" });
    expect(calls.find((c) => c.method === "POST")?.body).toHaveLength(1);
  });
});
