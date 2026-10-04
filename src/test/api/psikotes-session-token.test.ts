/** Route token psikotes kandidat: token, status sesi/tes, dan deadline dijaga server. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const query = vi.fn();
const queryOne = vi.fn();

vi.mock("@/lib/db", () => ({
  query: (...a: unknown[]) => query(...a),
  queryOne: (...a: unknown[]) => queryOne(...a),
  withTransaction: vi.fn(),
}));

const TOKEN = "b".repeat(48);
const TEST_ID = "00000000-0000-0000-0000-0000000000aa";
const Q1 = "11111111-1111-4111-8111-111111111111";
const Q2 = "22222222-2222-4222-8222-222222222222";
const OTHER = "99999999-9999-4999-8999-999999999999";

let seq = 0;
const session = (status = "in_progress") => ({
  id: `sess-${++seq}`,
  candidate_id: "c-1",
  status,
  webcam_consent: true,
  invited_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  candidate_name: "Budi",
});
const test = (startedAgoMs: number, overrides: Record<string, unknown> = {}) => ({
  id: TEST_ID,
  status: "in_progress",
  answers: { question_ids: [Q1, Q2], answers: { [Q1]: "a" } },
  attachment_path: null,
  started_at: new Date(Date.now() - startedAgoMs).toISOString(),
  instrument_kind: "mcq",
  instrument_config: { duration_seconds: 600 },
  ...overrides,
});
const ctx = (token = TOKEN) => ({ params: Promise.resolve({ token, testId: TEST_ID }) });
const req = (body: unknown) =>
  new Request("http://x", { method: "PUT", body: JSON.stringify(body) }) as unknown as NextRequest;

beforeEach(() => {
  query.mockReset().mockResolvedValue([]);
  queryOne.mockReset();
});

describe("PUT tests/[testId]/answers", () => {
  const put = async (body: unknown, token?: string) =>
    (await import("@/app/api/psikotes/session/[token]/tests/[testId]/answers/route")).PUT(req(body), ctx(token));

  it("token salah format: 404 tanpa query", async () => {
    const res = await put({ answers: {} }, "zzz");
    expect(res.status).toBe(404);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("hanya jawaban soal hasil undian yang ditulis", async () => {
    queryOne
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(test(60_000))
      .mockResolvedValueOnce({ answers: { answers: { [Q1]: "a", [Q2]: "b" } } });
    const res = await put({ answers: { [Q2]: "b", [OTHER]: "c" } });
    expect(res.status).toBe(200);
    expect((await res.json()).data.saved).toBe(2);
    expect(JSON.parse(queryOne.mock.calls[2][1][1])).toEqual({ [Q2]: "b" });
  });

  it("lewat deadline + grace: 409 tanpa menulis", async () => {
    queryOne.mockResolvedValueOnce(session()).mockResolvedValueOnce(test(700_000));
    const res = await put({ answers: { [Q2]: "b" } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Waktu tes sudah habis");
    expect(queryOne).toHaveBeenCalledTimes(2);
  });

  it("sesi selesai: 409", async () => {
    queryOne.mockResolvedValueOnce(session("completed"));
    expect((await put({ answers: {} })).status).toBe(409);
  });
});

describe("POST tests/[testId]/finish", () => {
  it("MCQ diskor server-side dgn jawaban flush terakhir", async () => {
    queryOne
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(test(60_000))
      .mockResolvedValueOnce({ id: TEST_ID, status: "selesai", score: 100 });
    query.mockResolvedValueOnce([
      { id: Q1, options: [], answer_key: { correct: "a" } },
      { id: Q2, options: [], answer_key: { correct: "b" } },
    ]);
    const { POST } = await import("@/app/api/psikotes/session/[token]/tests/[testId]/finish/route");
    const res = await POST(req({ answers: { [Q2]: "b" } }), ctx());
    expect(res.status).toBe(200);
    const params = queryOne.mock.calls[2][1];
    expect(JSON.parse(params[1])).toEqual({ [Q1]: "a", [Q2]: "b" });
    expect(params[2]).toBe(100);
  });

  it("tes gambar tanpa unggahan sebelum deadline: 400", async () => {
    queryOne.mockResolvedValueOnce(session()).mockResolvedValueOnce(test(60_000, { instrument_kind: "drawing" }));
    const { POST } = await import("@/app/api/psikotes/session/[token]/tests/[testId]/finish/route");
    const res = await POST(req({}), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unggah hasil gambar terlebih dahulu");
  });
});
