// Kirim WA tagihan member: pratinjau tidak mengirim; nomor & angka dari DB;
// tanpa sisa tagihan / nomor rusak ditolak; gateway gagal → 502.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const requireIamAction = vi.fn();
const getMemberBillDetail = vi.fn();
const sendWhatsAppText = vi.fn();

vi.mock("@/lib/api/auth", () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { ApiError, requireIamAction: (...args: unknown[]) => requireIamAction(...args) };
});
vi.mock("@/lib/pos/member-bill-server", () => ({
  MemberBillError: class extends Error {},
  getMemberBillDetail: (...args: unknown[]) => getMemberBillDetail(...args),
}));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppText: (...args: unknown[]) => sendWhatsAppText(...args) }));
vi.mock("@/lib/db", () => ({ queryOne: async () => ({ name: "BCD Coffee" }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ allowed: true }) }));

const CUSTOMER = "11111111-1111-4111-8111-111111111111";

function detail(overrides: { phone?: string | null; outstanding?: number } = {}) {
  return {
    customer: { id: CUSTOMER, name: "Budi", phone: "phone" in overrides ? overrides.phone : "0812-3456-7890" },
    balance: { openTotal: 647000, credit: 400000, outstanding: overrides.outstanding ?? 247000, surplus: 0, canSettle: false },
    open_orders: [{ id: "o1", order_number: "POS-1", ordered_at: "2026-10-01T10:00:00.000Z", total_amount: 647000 }],
  };
}

async function post(body: unknown) {
  const { POST } = await import("./route");
  const response = await POST({ json: async () => body } as unknown as NextRequest, {
    params: Promise.resolve({ customerId: CUSTOMER }),
  });
  return { status: response.status, json: (await response.json()) as { data?: Record<string, unknown>; error?: string } };
}

beforeEach(() => {
  requireIamAction.mockReset().mockResolvedValue({ id: "user-1", full_name: "Arip" });
  getMemberBillDetail.mockReset().mockResolvedValue(detail());
  sendWhatsAppText.mockReset().mockResolvedValue({ success: true });
});

describe("POST /api/pos/member-bills/[customerId]/send-wa", () => {
  it("preview: kembalikan pesan & nomor ternormalisasi, TIDAK mengirim", async () => {
    const { status, json } = await post({ preview: true });
    expect(status).toBe(200);
    expect(json.data?.phone).toBe("6281234567890");
    expect(String(json.data?.message)).toContain("*Sisa tagihan: Rp 247.000*");
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("kirim: ke nomor profil member, dicatat atas nama kasir", async () => {
    const { status, json } = await post({});
    expect(status).toBe(200);
    expect(json.data?.sent).toBe(true);
    expect(sendWhatsAppText).toHaveBeenCalledWith(
      expect.objectContaining({ target: "6281234567890" }),
      expect.objectContaining({ sentByUserId: "user-1" })
    );
  });

  it("tanpa sisa tagihan / nomor rusak → 400 tanpa kirim", async () => {
    getMemberBillDetail.mockResolvedValueOnce(detail({ outstanding: 0 }));
    expect((await post({})).status).toBe(400);
    getMemberBillDetail.mockResolvedValueOnce(detail({ phone: "123" }));
    expect((await post({})).status).toBe(400);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("gateway gagal → 502 dgn alasan", async () => {
    sendWhatsAppText.mockResolvedValue({ success: false, reason: "WA gateway offline" });
    const { status, json } = await post({});
    expect(status).toBe(502);
    expect(json.error).toBe("WA gateway offline");
  });
});
