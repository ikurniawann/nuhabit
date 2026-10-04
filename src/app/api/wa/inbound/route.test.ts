// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  normalizeInbound: vi.fn(),
  recordGatewayMessage: vi.fn(),
  onInboundMessage: vi.fn(),
  sendWhatsAppText: vi.fn(),
}));

vi.mock("@/lib/whatsapp/inbound", () => ({ normalizeInbound: mocks.normalizeInbound }));
vi.mock("@/lib/whatsapp/store", () => ({ recordGatewayMessage: mocks.recordGatewayMessage }));
vi.mock("@/lib/crm/cs-server", () => ({ onInboundMessage: mocks.onInboundMessage }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppText: mocks.sendWhatsAppText }));

import { POST } from "./route";

const inbound = (body: string, token = "rahasia") =>
  POST(
    new NextRequest("http://localhost/api/wa/inbound", {
      method: "POST",
      headers: { "x-gateway-token": token },
      body,
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WA_GATEWAY_TOKEN", "rahasia");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/wa/inbound", () => {
  it("401 untuk token salah", async () => {
    expect((await inbound("{}", "salah")).status).toBe(401);
  });

  it("400 untuk JSON rusak", async () => {
    expect((await inbound("{bukan json")).status).toBe(400);
  });

  it("merekam pesan masuk dan mengirim auto-reply CS", async () => {
    mocks.normalizeInbound.mockImplementation((p: { ok: boolean }) =>
      p.ok ? { direction: "in", channel: "whatsapp", phone: "62812", body: "halo", sentAt: null } : null
    );
    mocks.recordGatewayMessage.mockResolvedValue({ stored: true, conversationId: "conv-1" });
    mocks.onInboundMessage.mockResolvedValue({ autoReplyText: "Terima kasih" });

    const res = await inbound(JSON.stringify({ messages: [{ ok: true }, { ok: false }] }));

    expect(await res.json()).toEqual({ success: true, stored: 1, skipped: 1 });
    expect(mocks.sendWhatsAppText).toHaveBeenCalledWith(
      { target: "62812", message: "Terima kasih" },
      { messageType: "system", conversationId: "conv-1" }
    );
  });
});
