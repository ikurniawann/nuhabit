// Respons offer kandidat: token dicek dulu, status final ditolak, jejak aktivitas atomik.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const queryOne = vi.fn();
const clientQuery = vi.fn();

vi.mock("@/lib/db", () => ({
  queryOne: (...a: unknown[]) => queryOne(...a),
  withTransaction: (fn: (client: { query: typeof clientQuery }) => unknown) => fn({ query: clientQuery }),
}));

const TOKEN = "a".repeat(48);
let offerSeq = 0;
const offer = (status: string) => ({
  id: `offer-${++offerSeq}`,
  candidate_id: "cand-1",
  version: 2,
  status,
  sent_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
});

const respond = async (body: unknown, token = TOKEN) => {
  const { POST } = await import("./route");
  const req = new Request(`http://x/api/offer/session/${token}/respond`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "cf-connecting-ip": "203.0.113.9" },
  }) as unknown as NextRequest;
  return POST(req, { params: Promise.resolve({ token }) });
};

beforeEach(() => {
  queryOne.mockReset();
  clientQuery.mockReset();
});

describe("POST /api/offer/session/[token]/respond", () => {
  it("token salah format: 404 tanpa query", async () => {
    const res = await respond({ action: "accept" }, "bukan-token");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Link penawaran tidak berlaku");
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("offer yang sudah diterima: 409", async () => {
    queryOne.mockResolvedValueOnce(offer("accepted"));
    const res = await respond({ action: "decline" });
    expect(res.status).toBe(409);
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it("nego tanpa catatan: 400", async () => {
    queryOne.mockResolvedValueOnce(offer("sent"));
    const res = await respond({ action: "negotiate", note: "  " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("catatan negosiasi");
  });

  it("terima: status, IP, dan jejak aktivitas tercatat", async () => {
    queryOne.mockResolvedValueOnce(offer("sent"));
    clientQuery
      .mockResolvedValueOnce({ rows: [{ id: "o", status: "accepted" }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await respond({ action: "accept", note: "Siap mulai" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe("accepted");
    expect(clientQuery.mock.calls[0][1]).toEqual([expect.any(String), "accepted", "Siap mulai", "203.0.113.9"]);
    expect(clientQuery.mock.calls[1][1][1]).toBe('Kandidat menerima offer v2 via portal — "Siap mulai"');
  });
});
