/** Route token interview AI: token & status sesi dijaga sebelum AI/penyimpanan disentuh. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const query = vi.fn();
const queryOne = vi.fn();
const transcribe = vi.fn();

vi.mock("@/lib/db", () => ({
  query: (...a: unknown[]) => query(...a),
  queryOne: (...a: unknown[]) => queryOne(...a),
  withTransaction: vi.fn(),
}));
vi.mock("@/lib/recruitment/interview-ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/recruitment/interview-ai")>()),
  transcribeInterviewAudio: (...a: unknown[]) => transcribe(...a),
}));

const TOKEN = "c".repeat(48);
let seq = 0;
const session = (status: string) => ({
  id: `int-${++seq}`,
  candidate_id: "c-1",
  status,
  config: null,
  invited_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  candidate_name: "Sari",
});
const answer = async (form: FormData, token = TOKEN) => {
  const { POST } = await import("@/app/api/interview/session/[token]/answer/route");
  const req = new Request("http://x", { method: "POST", body: form }) as unknown as NextRequest;
  return POST(req, { params: Promise.resolve({ token }) });
};

beforeEach(() => {
  query.mockReset().mockResolvedValue([]);
  queryOne.mockReset();
  transcribe.mockReset();
});

describe("POST /api/interview/session/[token]/answer", () => {
  it("token tidak dikenal: 404", async () => {
    queryOne.mockResolvedValueOnce(null);
    const res = await answer(new FormData());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Link interview tidak berlaku");
  });

  it("sesi belum berjalan: 409 sebelum body dibaca", async () => {
    queryOne.mockResolvedValueOnce(session("sent"));
    expect((await answer(new FormData())).status).toBe(409);
  });

  it("mode tidak dikenal: 400 tanpa transkrip", async () => {
    queryOne.mockResolvedValueOnce(session("in_progress"));
    const form = new FormData();
    form.set("turn_id", "00000000-0000-0000-0000-000000000001");
    form.set("mode", "video");
    const res = await answer(form);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Payload tidak valid");
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("pertanyaan yang sudah dijawab: 409", async () => {
    queryOne
      .mockResolvedValueOnce(session("in_progress"))
      .mockResolvedValueOnce({ id: "t1", answered_at: new Date().toISOString() });
    const form = new FormData();
    form.set("turn_id", "00000000-0000-0000-0000-000000000001");
    form.set("mode", "text");
    form.set("answer_text", "Halo");
    expect((await answer(form)).status).toBe(409);
  });
});
