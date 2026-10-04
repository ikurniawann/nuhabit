import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock("@/lib/whatsapp/gateway", () => ({ loadGatewayConfig: vi.fn(), sendGatewayText: vi.fn() }));
vi.mock("@/lib/sales-funnel/server", () => ({ isValidNormalizedPhone: vi.fn(), normalizePhone: vi.fn() }));

import { executeAction, type ActionContext } from "./workflow-engine";

const ctx: ActionContext = {
  ruleId: "rule-1",
  runId: null,
  eventId: null,
  companyId: null,
  branchId: null,
  subjectType: "lead",
  subjectId: "lead-1",
  record: { id: "lead-1" },
  template: {},
  actorUserId: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("aksi webhook workflow", () => {
  it("mengirim X-NuHabit-Signature dan header lama X-BCDCoffee-Signature dengan HMAC yang sama", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAction({ type: "webhook", url: "https://hooks.test/x", secret: "rahasia" }, ctx);

    expect(result).toEqual({ type: "webhook", ok: true, status: 200 });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const expected = createHmac("sha256", "rahasia").update(String(init.body)).digest("hex");
    expect(headers["X-NuHabit-Signature"]).toBe(expected);
    expect(headers["X-BCDCoffee-Signature"]).toBe(expected);
  });

  it("tanpa secret tidak mengirim header tanda tangan", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await executeAction({ type: "webhook", url: "https://hooks.test/x", secret: null }, ctx);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(["Content-Type"]);
  });
});
