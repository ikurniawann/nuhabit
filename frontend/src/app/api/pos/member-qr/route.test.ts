import { beforeEach, describe, expect, it, vi } from "vitest";

const scan = vi.fn();
const guard = { error: null as Response | null };
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  requirePosMenu: vi.fn(async () => (guard.error ? { error: guard.error } : { error: null, userId: "kasir-1" })),
}));
vi.mock("@/lib/crm/engagement/server", () => ({ scanMemberQr: (...a: unknown[]) => scan(...a) }));
vi.mock("@/lib/crm/engagement/rules", () => ({ QR_PROBLEM_LABEL: { expired: "QR kedaluwarsa" } }));
vi.mock("@/lib/db", () => ({ withTransaction: async (fn: (c: unknown) => unknown) => fn({}) }));
vi.mock("@/lib/gym/booking-server", () => ({ checkInBooking: async () => ({ status: "no_booking" }) }));

async function post(body: unknown) {
  const { POST } = await import("./route");
  const res = await POST({ json: async () => body } as unknown as Request);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  scan.mockReset();
  guard.error = null;
});

describe("POST /api/pos/member-qr", () => {
  it("token pendek → 400 'QR tidak valid'", async () => {
    expect(await post({ token: "x" })).toMatchObject({ status: 400, json: { error: "QR tidak valid" } });
  });

  it("QR ditolak → 409 dengan label masalah", async () => {
    scan.mockResolvedValue({ ok: false, problem: "expired" });
    expect(await post({ token: "token-123456" })).toMatchObject({ status: 409, json: { error: "QR kedaluwarsa" } });
  });

  it("QR sah → customer + keputusan check-in gym", async () => {
    scan.mockResolvedValue({ ok: true, customerId: "c1", name: "Ana", phone: "0811" });
    expect(await post({ token: "token-123456" })).toMatchObject({
      status: 200,
      json: { data: { customer_id: "c1", name: "Ana", gym: { status: "no_booking" } } },
    });
    expect(scan).toHaveBeenCalledWith("token-123456", "kasir-1");
  });

  it("guard menu POS menolak → respons guard", async () => {
    guard.error = Response.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    expect((await post({ token: "token-123456" })).status).toBe(403);
  });
});
