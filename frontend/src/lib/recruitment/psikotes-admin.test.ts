import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const queryOneMock = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  queryOne: (...args: unknown[]) => queryOneMock(...args),
  withTransaction: vi.fn(),
}));
vi.mock("@/lib/storage-private", () => ({ readPrivateFile: vi.fn() }));

const { getTestAnswerDetail } = await import("./psikotes-admin");

beforeEach(() => {
  queryMock.mockReset();
  queryOneMock.mockReset();
});

describe("getTestAnswerDetail (PAPI)", () => {
  it("reads each pair's choice from answers.answers", async () => {
    queryOneMock.mockResolvedValue({
      id: "t1",
      instrument_id: "papi",
      instrument_kind: "forced_choice",
      score_detail: null,
      answers: { question_ids: ["q1", "q2", "q3"], answers: { q1: "a", q2: "b", q3: "x" } },
    });
    queryMock.mockResolvedValue([
      { id: "q1", body: "Pair 1", options: null },
      { id: "q2", body: "Pair 2", options: null },
      { id: "q3", body: "Pair 3", options: null },
    ]);

    const detail = await getTestAnswerDetail("t1");

    expect(detail).toEqual({
      kind: "forced_choice",
      items: [
        { id: "q1", body: "Pair 1", options: null, given: "a" },
        { id: "q2", body: "Pair 2", options: null, given: "b" },
        { id: "q3", body: "Pair 3", options: null, given: null },
      ],
    });
  });
});
