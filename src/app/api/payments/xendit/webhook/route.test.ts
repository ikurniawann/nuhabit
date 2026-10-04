// Webhook QRIS Xendit: token wajib (fail closed) dan nominal callback wajib
// sama dengan catatan pending sebelum top-up dikredit / order dilunasi.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const rows: Record<string, Record<string, unknown> | null> = {};
const loadConfig = vi.fn();
const creditPendingTopup = vi.fn();
const settleOrderQrisPayment = vi.fn();
const completeMixedCheckout = vi.fn();
const settleGym = vi.fn();
const queryOne = vi.fn();

vi.mock("@/lib/pg/create-client", () => ({
  createPgClient: () => ({
    from: (table: string) => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
      };
      return b;
    },
  }),
}));
vi.mock("@/lib/db", () => ({ queryOne: (...a: unknown[]) => queryOne(...a) }));
vi.mock("@/lib/pos/topup-credit", () => ({ creditPendingTopup: (...a: unknown[]) => creditPendingTopup(...a) }));
vi.mock("@/lib/pos/settle-order-qris", () => ({
  settleOrderQrisPayment: (...a: unknown[]) => settleOrderQrisPayment(...a),
}));
vi.mock("@/lib/gym/credit-payments-server", () => ({
  isGymPurchaseReference: (ref: string) => ref.startsWith("gymcp_"),
  settleGymPurchaseByReference: (...a: unknown[]) => settleGym(...a),
}));
vi.mock("@/lib/pos/create-mixed-checkout", async (orig) => ({
  ...(await orig<typeof import("@/lib/pos/create-mixed-checkout")>()),
  completeMixedCheckout: (...a: unknown[]) => completeMixedCheckout(...a),
}));
vi.mock("@/lib/payments/xendit", async (orig) => ({
  ...(await orig<typeof import("@/lib/payments/xendit")>()),
  loadActiveXenditConfig: () => loadConfig(),
}));

function makeRequest(body: unknown, token: string | null = "cb-token"): NextRequest {
  const headers = new Headers(token ? { "x-callback-token": token } : {});
  return { headers, json: async () => body } as unknown as NextRequest;
}

const paid = (amount: number, referenceId: string, qrId = "qr_1") => ({
  event: "qr.payment",
  data: { id: "qrpy_1", qr_id: qrId, reference_id: referenceId, status: "SUCCEEDED", amount },
});

async function post(body: unknown, token?: string | null) {
  const { POST } = await import("./route");
  const res = await POST(makeRequest(body, token));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  for (const key of Object.keys(rows)) delete rows[key];
  vi.clearAllMocks();
  loadConfig.mockResolvedValue({ secretKey: "sk", webhookToken: "cb-token", callbackUrl: null, environment: "sandbox" });
  creditPendingTopup.mockResolvedValue({ status: "credited", balance_after: 1 });
  settleOrderQrisPayment.mockResolvedValue({ status: "settled" });
});

describe("POST /api/payments/xendit/webhook", () => {
  it("webhook_secret belum diisi → 401, tidak ada yang dikredit", async () => {
    loadConfig.mockResolvedValue({ secretKey: "sk", webhookToken: null, callbackUrl: null, environment: "sandbox" });
    rows.pos_wallet_transactions = { id: "tx-1", amount: 50000 };
    const { status } = await post(paid(50000, "topup_a"), "apa-saja");
    expect(status).toBe(401);
    expect(creditPendingTopup).not.toHaveBeenCalled();
  });

  it("token salah → 401", async () => {
    expect((await post(paid(50000, "topup_a"), "salah")).status).toBe(401);
  });

  it("top-up: nominal callback beda dari baris pending → tidak dikredit", async () => {
    rows.pos_wallet_transactions = { id: "tx-1", amount: 500000 };
    const { status, json } = await post(paid(1000, "topup_a"));
    expect(status).toBe(200);
    expect(json).toMatchObject({ ignored: true, reason: "amount_mismatch" });
    expect(creditPendingTopup).not.toHaveBeenCalled();
  });

  it("top-up: nominal sama → dikredit", async () => {
    rows.pos_wallet_transactions = { id: "tx-1", amount: "50000.00" };
    await post(paid(50000, "topup_a"));
    expect(creditPendingTopup).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ transactionId: "tx-1" }));
  });

  it("order QRIS: nominal beda → tidak dilunasi; sama → dilunasi", async () => {
    rows.pos_orders = { id: "ord-1", total_amount: 75000 };
    await post(paid(100, "pos-ord-ord-1"));
    expect(settleOrderQrisPayment).not.toHaveBeenCalled();
    await post(paid(75000, "pos-ord-ord-1"));
    expect(settleOrderQrisPayment).toHaveBeenCalledWith(expect.anything(), "ord-1");
  });

  it("checkout gabungan: nominal beda → tidak diselesaikan", async () => {
    rows.pos_checkouts = { id: "co-1", total_amount: 120000 };
    const { json } = await post(paid(120, "pos-co"));
    expect(json).toMatchObject({ reason: "amount_mismatch" });
    expect(completeMixedCheckout).not.toHaveBeenCalled();
  });

  it("paket kredit gym: nominal beda → tidak dilunasi", async () => {
    queryOne.mockResolvedValue({ id: "gp-1", total_idr: "300000.00" });
    const { json } = await post(paid(3000, "gymcp_abc"));
    expect(json).toMatchObject({ reason: "amount_mismatch" });
    expect(settleGym).not.toHaveBeenCalled();

    settleGym.mockResolvedValue({ status: "paid", purchase_id: "gp-1" });
    await post(paid(300000, "gymcp_abc"));
    expect(settleGym).toHaveBeenCalled();
  });
});
