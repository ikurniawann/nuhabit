// Tagihan member: hanya milik sesi sendiri, tanpa data internal kasir.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMemberSession = vi.fn();
const getMemberBillDetail = vi.fn();

vi.mock("@/lib/member-portal/session", () => ({ getMemberSession: () => getMemberSession() }));
vi.mock("@/lib/pos/member-bill-server", () => ({
  getMemberBillDetail: (...a: unknown[]) => getMemberBillDetail(...a),
}));

const detail = {
  customer: { id: "c1", name: "Sari", phone: "0812", membership_tier: null },
  balance: { openTotal: 50000, credit: 20000, outstanding: 30000, surplus: 0, canSettle: false },
  open_orders: [
    {
      id: "o1",
      order_number: "A-1",
      queue_number: "12",
      ordered_at: "2026-10-01T03:00:00.000Z",
      order_type: "dine_in",
      status: "served",
      total_amount: 50000,
      items: [{ name: "Latte", quantity: 2, total_amount: 50000, options: ["Oat"] }],
    },
  ],
  settled_orders: [],
  payments: [
    {
      id: "p1",
      amount: 20000,
      payment_method: "qris",
      payment_method_name: "QRIS",
      reference_number: "REF-9",
      notes: "titip",
      received_by_name: "Kasir Budi",
      settlement_id: null,
      created_at: "2026-10-02T03:00:00.000Z",
    },
  ],
};

async function get() {
  const { GET } = await import("./route");
  const res = await GET();
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  getMemberSession.mockReset();
  getMemberBillDetail.mockReset().mockResolvedValue(detail);
});

describe("GET /api/member-portal/bills", () => {
  it("rejects requests without a member session", async () => {
    getMemberSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(getMemberBillDetail).not.toHaveBeenCalled();
  });

  it("loads the bill of the signed-in member and drops cashier-only fields", async () => {
    getMemberSession.mockResolvedValue({ customerId: "c1" });
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(getMemberBillDetail).toHaveBeenCalledWith("c1");
    expect(body.data).toEqual({
      balance: detail.balance,
      open_orders: [
        {
          id: "o1",
          order_number: "A-1",
          ordered_at: "2026-10-01T03:00:00.000Z",
          total_amount: 50000,
          items: detail.open_orders[0].items,
        },
      ],
      payments: [{ id: "p1", amount: 20000, method: "QRIS", created_at: "2026-10-02T03:00:00.000Z" }],
    });
  });
});
