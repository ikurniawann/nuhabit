// Checkout multi-stall: guard keranjang, lalu FOC wajib PIN supervisor ber-batas percobaan.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const approve = vi.fn();
const create = vi.fn();
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => "kasir-1"),
}));
vi.mock("@/lib/api/scope", () => ({ getApiUserScope: async () => ({ role: "pos" }) }));
vi.mock("@/lib/crm/loyalty-features-server", () => ({ rejectIfArkCoinDisabled: async () => null }));
vi.mock("@/lib/crm/product-privilege", () => ({ checkProductPrivileges: async () => ({ allowed: true }) }));
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: () => ({}) }));
vi.mock("@/lib/pos/pos-sell-stall-server", () => ({
  loadCentralCashierGate: async () => ({ hasCentralMenu: true, canCentralCheckout: true, activeMode: "all" }),
  loadPosProductWarehouseIds: async () =>
    new Map([
      ["p1", "w-a"],
      ["p2", "w-b"],
    ]),
}));
vi.mock("@/lib/pos/supervisor-pin-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/pos/supervisor-pin-server")>()),
  approveWithSupervisorPin: (...a: unknown[]) => approve(...a),
}));
vi.mock("@/lib/pos/create-mixed-checkout", async (orig) => ({
  ...(await orig<typeof import("@/lib/pos/create-mixed-checkout")>()),
  createMixedCheckout: (...a: unknown[]) => create(...a),
}));

const items = [
  { product_id: "p1", quantity: 1, unit_price: 10000, subtotal: 10000 },
  { product_id: "p2", quantity: 1, unit_price: 5000, subtotal: 5000 },
];
async function post(body: unknown) {
  const { POST } = await import("./route");
  const res = await POST({ json: async () => body } as unknown as NextRequest);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  approve.mockReset();
  create.mockReset();
});

describe("POST /api/pos/checkouts", () => {
  it("keranjang kosong → 400", async () => {
    expect((await post({ items: [] })).status).toBe(400);
  });

  it("FOC: tanpa customer 400, PIN terkunci 429 tanpa membuat checkout", async () => {
    const foc = { items, payment_method_code: "foc", payment_method_name: "FOC", supervisor_pin: "1234" };
    expect((await post(foc)).status).toBe(400);
    approve.mockResolvedValue({ ok: false, reason: "locked", retryMinutes: 5 });
    const res = await post({ ...foc, customer_id: "c1" });
    expect(res.status).toBe(429);
    expect(approve).toHaveBeenCalledWith({ callerId: "kasir-1", pin: "1234" });
    expect(create).not.toHaveBeenCalled();
  });
});
