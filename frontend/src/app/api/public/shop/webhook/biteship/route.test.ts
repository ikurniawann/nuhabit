// Webhook Biteship: token rahasia dibanding waktu-konstan; boleh lewat header
// (disukai) atau query lama.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({ query: vi.fn(), queryOne: vi.fn(async () => null) }));
vi.mock("@/lib/shop/shop-wa", () => ({ sendShopOrderShippedWa: vi.fn() }));

const saved = process.env.BITESHIP_WEBHOOK_TOKEN;
beforeEach(async () => {
  process.env.BITESHIP_WEBHOOK_TOKEN = "bs-secret";
  (await import("@/lib/public/rate-limit")).resetRateLimits();
});
afterEach(() => {
  if (saved === undefined) delete process.env.BITESHIP_WEBHOOK_TOKEN;
  else process.env.BITESHIP_WEBHOOK_TOKEN = saved;
});

async function post(url: string, headers: Record<string, string> = {}) {
  const { POST } = await import("./route");
  const req = new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ order_id: "bs-1", status: "picked" }),
  });
  return (await POST(req)).status;
}

const URL_BASE = "http://localhost/api/public/shop/webhook/biteship";

describe("POST /api/public/shop/webhook/biteship", () => {
  it("token di header x-webhook-token atau Bearer diterima", async () => {
    expect(await post(URL_BASE, { "x-webhook-token": "bs-secret" })).toBe(200);
    expect(await post(URL_BASE, { authorization: "Bearer bs-secret" })).toBe(200);
  });

  it("token di query tetap diterima (URL lama di dashboard Biteship)", async () => {
    expect(await post(`${URL_BASE}?token=bs-secret`)).toBe(200);
  });

  it("token salah / absen → 401", async () => {
    expect(await post(`${URL_BASE}?token=bs-secre`)).toBe(401);
    expect(await post(URL_BASE, { "x-webhook-token": "salah" })).toBe(401);
    expect(await post(URL_BASE)).toBe(401);
  });

  it("env token kosong → 503", async () => {
    process.env.BITESHIP_WEBHOOK_TOKEN = "";
    expect(await post(URL_BASE, { "x-webhook-token": "" })).toBe(503);
  });
});
