// EPIC-049 — webhook GoBiz: token path wajib cocok, payload asing diabaikan
// (tetap 200 agar GoBiz tidak retry), event_id dobel tidak diproses dua kali,
// error pemrosesan tidak bocor sebagai 5xx.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const recordGofoodEvent = vi.fn();
const processGofoodEvent = vi.fn();
const loadGobizConfig = vi.fn();

vi.mock("@/lib/gobiz/service", () => ({
  recordGofoodEvent: (...args: unknown[]) => recordGofoodEvent(...args),
  processGofoodEvent: (...args: unknown[]) => processGofoodEvent(...args),
}));
vi.mock("@/lib/gobiz/config", () => ({
  loadGobizConfig: () => loadGobizConfig(),
}));

const sampleEvent = {
  header: { event_name: "gofood.order.awaiting_merchant_acceptance", event_id: "evt-1" },
  body: { service_type: "gofood", order: { order_number: "F-1", order_total: 10000, order_items: [] } },
};

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return { json: async () => JSON.parse(raw), text: async () => raw, headers: new Headers(headers) } as unknown as NextRequest;
}

async function post(token: string, body: unknown, headers?: Record<string, string>) {
  const { POST } = await import("./route");
  const response = await POST(makeRequest(body, headers), { params: Promise.resolve({ token }) });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  recordGofoodEvent.mockReset();
  processGofoodEvent.mockReset();
  loadGobizConfig.mockReset();
  loadGobizConfig.mockResolvedValue({ webhookToken: "secret-token" });
});

describe("POST /api/integrations/gobiz/webhook/[token]", () => {
  it("token salah → 401 tanpa menyentuh service", async () => {
    const { status } = await post("wrong", sampleEvent);
    expect(status).toBe(401);
    expect(recordGofoodEvent).not.toHaveBeenCalled();
  });

  it("token belum dibuat (kosong) → 401 (bukan cocok dgn string kosong)", async () => {
    loadGobizConfig.mockResolvedValue({ webhookToken: "" });
    const { status } = await post("", sampleEvent);
    expect(status).toBe(401);
  });

  it("payload tidak dikenali → 200 ignored", async () => {
    const { status, json } = await post("secret-token", { hello: "world" });
    expect(status).toBe(200);
    expect(json).toMatchObject({ success: true, ignored: true, reason: "unrecognized_payload" });
    expect(recordGofoodEvent).not.toHaveBeenCalled();
  });

  it("event valid → dicatat (dgn X-Go-Idempotency-Key) lalu diproses", async () => {
    recordGofoodEvent.mockResolvedValue("row-1");
    processGofoodEvent.mockResolvedValue("auto_accepted");
    const { status, json } = await post("secret-token", sampleEvent, { "x-go-idempotency-key": "idem-9" });
    expect(status).toBe(200);
    expect(recordGofoodEvent).toHaveBeenCalledWith(expect.objectContaining({ header: expect.objectContaining({ event_id: "evt-1" }) }), "idem-9");
    expect(processGofoodEvent).toHaveBeenCalledWith(expect.anything(), "row-1");
    expect(json).toEqual({ success: true, data: { result: "auto_accepted" } });
  });

  it("event_id dobel → 200 duplicate_event, tidak diproses ulang", async () => {
    recordGofoodEvent.mockResolvedValue(null);
    const { json } = await post("secret-token", sampleEvent);
    expect(json).toMatchObject({ success: true, ignored: true, reason: "duplicate_event" });
    expect(processGofoodEvent).not.toHaveBeenCalled();
  });

  it("pemrosesan gagal → tetap 200 (event tersimpan utk diproses ulang), processed=false", async () => {
    recordGofoodEvent.mockResolvedValue("row-2");
    processGofoodEvent.mockRejectedValue(new Error("db down"));
    const { status, json } = await post("secret-token", sampleEvent);
    expect(status).toBe(200);
    expect(json).toMatchObject({ success: true, processed: false });
  });
});

describe("X-Go-Signature (Relay secret)", () => {
  const secret = "relay-secret-test";
  const sign = async (body: unknown) => {
    const { computeGobizSignature } = await import("@/lib/gobiz/signature");
    return computeGobizSignature(JSON.stringify(body), secret);
  };

  it("mode tegak: tanda tangan salah / absen → 401 tanpa menyentuh service", async () => {
    loadGobizConfig.mockResolvedValue({ webhookToken: "secret-token", relaySecret: secret, enforceSignature: true });
    expect((await post("secret-token", sampleEvent, { "x-go-signature": "deadbeef" })).status).toBe(401);
    expect((await post("secret-token", sampleEvent)).status).toBe(401);
    expect(recordGofoodEvent).not.toHaveBeenCalled();
  });

  it("mode tegak: tanda tangan HMAC-SHA256 hex raw body yang benar → diproses", async () => {
    loadGobizConfig.mockResolvedValue({ webhookToken: "secret-token", relaySecret: secret, enforceSignature: true });
    recordGofoodEvent.mockResolvedValue("row-1");
    processGofoodEvent.mockResolvedValue("processed");
    const { status } = await post("secret-token", sampleEvent, { "x-go-signature": await sign(sampleEvent) });
    expect(status).toBe(200);
    expect(processGofoodEvent).toHaveBeenCalled();
  });

  it("secret terisi: tanda tangan salah ditolak walau flag enforce mati", async () => {
    loadGobizConfig.mockResolvedValue({ webhookToken: "secret-token", relaySecret: secret, enforceSignature: false });
    const { status } = await post("secret-token", sampleEvent, { "x-go-signature": "deadbeef" });
    expect(status).toBe(401);
    expect((await post("secret-token", sampleEvent)).status).toBe(401);
    expect(recordGofoodEvent).not.toHaveBeenCalled();
  });

  it("secret kosong: hanya token path yang menjaga, event diproses", async () => {
    loadGobizConfig.mockResolvedValue({ webhookToken: "secret-token", relaySecret: "" });
    recordGofoodEvent.mockResolvedValue("row-1");
    processGofoodEvent.mockResolvedValue("processed");
    expect((await post("secret-token", sampleEvent)).status).toBe(200);
    expect((await post("salah", sampleEvent, { "x-go-signature": await sign(sampleEvent) })).status).toBe(401);
  });
});
