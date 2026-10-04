// Tagihan Member — POST cicilan: hak akses 'create' wajib, payload divalidasi,
// error domain (lebih bayar dsb.) diteruskan apa adanya, sukses → 201.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const requireIamAction = vi.fn();
const recordMemberBillPayment = vi.fn();

vi.mock("@/lib/api/auth", async () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { ApiError, requireIamAction: (...args: unknown[]) => requireIamAction(...args) };
});
vi.mock("@/lib/pos/member-bill-server", () => {
  class MemberBillError extends Error {
    constructor(message: string, public status = 400) {
      super(message);
    }
  }
  return { MemberBillError, recordMemberBillPayment: (...args: unknown[]) => recordMemberBillPayment(...args) };
});
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ allowed: true }) }));

const CUSTOMER = "11111111-1111-4111-8111-111111111111";

async function post(body: unknown, customerId = CUSTOMER) {
  const { POST } = await import("./route");
  const response = await POST({ json: async () => body } as unknown as NextRequest, {
    params: Promise.resolve({ customerId }),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  requireIamAction.mockReset();
  recordMemberBillPayment.mockReset();
  requireIamAction.mockResolvedValue({ id: "user-1", full_name: "Arip" });
});

describe("POST /api/pos/member-bills/[customerId]/payments", () => {
  it("tanpa hak 'create' → 403, tidak mencatat apa pun", async () => {
    const { ApiError } = await import("@/lib/api/auth");
    requireIamAction.mockRejectedValue(new (ApiError as unknown as new (s: number, m: string) => Error)(403, "Insufficient permissions"));
    const { status } = await post({ amount: 500000, payment_method_code: "cash" });
    expect(status).toBe(403);
    expect(recordMemberBillPayment).not.toHaveBeenCalled();
  });

  it("payload tidak valid (nominal pecahan / kosong / id member salah) → 400", async () => {
    expect((await post({ amount: 10.5, payment_method_code: "cash" })).status).toBe(400);
    expect((await post({ amount: 1000 })).status).toBe(400);
    expect((await post({ amount: 1000, payment_method_code: "cash" }, "bukan-uuid")).status).toBe(400);
    expect(recordMemberBillPayment).not.toHaveBeenCalled();
  });

  it("error domain (lebih bayar) diteruskan dengan status & pesannya", async () => {
    const { MemberBillError } = await import("@/lib/pos/member-bill-server");
    recordMemberBillPayment.mockRejectedValue(new MemberBillError("Nominal melebihi sisa tagihan"));
    const { status, json } = await post({ amount: 2_000_000, payment_method_code: "cash" });
    expect(status).toBe(400);
    expect(json.error).toBe("Nominal melebihi sisa tagihan");
  });

  it("sukses → 201, kasir & shift diteruskan ke server", async () => {
    recordMemberBillPayment.mockResolvedValue({ payment_id: "p1", settled_order_count: 0, notes: [] });
    const shift = "22222222-2222-4222-8222-222222222222";
    const { status, json } = await post({ amount: 500000, payment_method_code: "cash", shift_id: shift });
    expect(status).toBe(201);
    expect((json.data as Record<string, unknown>).payment_id).toBe("p1");
    expect(recordMemberBillPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: CUSTOMER,
        amount: 500000,
        paymentMethodCode: "cash",
        shiftId: shift,
        user: { id: "user-1", name: "Arip" },
      })
    );
  });
});
