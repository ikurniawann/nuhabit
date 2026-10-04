/** Live Monitoring HR: grant menu dulu, tipe/id sesi divalidasi sebelum query. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const query = vi.fn();
const queryOne = vi.fn();
const requireIamMenuPrefix = vi.fn();

vi.mock("@/lib/db", () => ({
  query: (...a: unknown[]) => query(...a),
  queryOne: (...a: unknown[]) => queryOne(...a),
}));
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: (...a: unknown[]) => requireIamMenuPrefix(...a),
}));

const ID = "00000000-0000-0000-0000-000000000001";
const req = (url: string, body?: unknown) =>
  new Request(`http://x${url}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) as unknown as NextRequest;
const ctx = (type: string, id = ID) => ({ params: Promise.resolve({ type, id }) });

beforeEach(() => {
  query.mockReset().mockResolvedValue([]);
  queryOne.mockReset().mockResolvedValue(null);
  requireIamMenuPrefix.mockReset().mockResolvedValue({ id: "hr-1", full_name: "Rina", role: "hrd" });
});

describe("live-monitoring", () => {
  it("tanpa grant: 403 tanpa query", async () => {
    const { ApiError } = await import("@/lib/api/auth");
    requireIamMenuPrefix.mockRejectedValue(ApiError.forbidden());
    const { GET } = await import("@/app/api/recruitment/live-monitoring/route");
    expect((await GET()).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("daftar sesi online menggabungkan psikotes dan interview", async () => {
    query.mockResolvedValue([{ session_type: "psikotes" }]);
    const { GET } = await import("@/app/api/recruitment/live-monitoring/route");
    const res = await GET();
    expect((await res.json()).data).toEqual([{ session_type: "psikotes" }]);
    const [sql] = query.mock.calls[0];
    expect(sql).toContain("recruitment.psikotes_sessions");
    expect(sql).toContain("recruitment.interview_ai_sessions");
  });

  it("chat dgn tipe sesi asing: 404 tanpa query", async () => {
    const { GET } = await import("@/app/api/recruitment/live-monitoring/[type]/[id]/chat/route");
    const res = await GET(req("/chat"), ctx("payroll"));
    expect(res.status).toBe(404);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("chat HR tersimpan atas nama user", async () => {
    queryOne
      .mockResolvedValueOnce({ id: ID, status: "in_progress", candidate_name: "Budi" })
      .mockResolvedValueOnce({ id: "m1", sender: "hr", message: "Halo" });
    const { POST } = await import("@/app/api/recruitment/live-monitoring/[type]/[id]/chat/route");
    const res = await POST(req("/chat", { message: "  Halo  " }), ctx("interview"));
    expect(res.status).toBe(201);
    expect(queryOne.mock.calls[1][1]).toEqual(["interview", ID, "hr", "Rina", "Halo"]);
  });

  it("webrtc offer utk sesi yang tidak berjalan: 404", async () => {
    const { POST } = await import("@/app/api/recruitment/live-monitoring/[type]/[id]/webrtc/route");
    const res = await POST(req("/webrtc", { offer_id: "offer-123", sdp: "v=0" }), ctx("psikotes"));
    expect(res.status).toBe(404);
  });

  it("frame dgn id bukan UUID: 400", async () => {
    const { GET } = await import("@/app/api/recruitment/live-monitoring/[type]/[id]/frame/route");
    expect((await GET(req("/frame"), ctx("psikotes", "abc"))).status).toBe(400);
  });
});
