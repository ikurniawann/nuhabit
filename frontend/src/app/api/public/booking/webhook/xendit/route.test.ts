// Webhook Xendit booking/pass — token wajib (401), payload dicek (400),
// callback sah selalu 200 (termasuk yang diabaikan), nominal kurang
// ditolak + alert, galat proses → 500 supaya Xendit mengulang.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetRateLimits } from "@/lib/public/rate-limit";

const isValidWebhookToken = vi.fn();
vi.mock("@/lib/xendit/client", () => ({
  isValidWebhookToken: (token: string | null) => isValidWebhookToken(token),
}));

const query = vi.fn();
const queryOne = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => query(...args),
  queryOne: (...args: unknown[]) => queryOne(...args),
  withTransaction: vi.fn(async (fn: (client: unknown) => unknown) => fn({})),
}));
const capturePromoRedemption = vi.fn();
vi.mock("@/lib/promo/promo-server", () => ({
  capturePromoRedemption: (...args: unknown[]) => capturePromoRedemption(...args),
  releasePromoRedemption: vi.fn(),
}));
const sendBookingPaidWa = vi.fn();
const sendBookingGiftWa = vi.fn();
vi.mock("@/lib/ticketing/booking-wa", () => ({
  sendBookingPaidWa: (...args: unknown[]) => sendBookingPaidWa(...args),
  sendBookingGiftWa: (...args: unknown[]) => sendBookingGiftWa(...args),
}));
const sendPassPaidWa = vi.fn();
vi.mock("@/lib/ticketing/pass-wa", () => ({
  sendPassPaidWa: (...args: unknown[]) => sendPassPaidWa(...args),
}));

const { POST } = await import("./route");

const BOOKING_ID = "3f0c8a8e-8a51-4c1e-9d55-0b6a1d2b4c11";

const callback = (body: unknown, token = "rahasia") =>
  POST(
    new NextRequest("http://localhost/api/public/booking/webhook/xendit", {
      method: "POST",
      headers: { "x-callback-token": token, "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify(body),
    })
  );

const paid = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  external_id: `tkt-booking-${BOOKING_ID}`,
  status: "PAID",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  isValidWebhookToken.mockImplementation((token: string | null) => token === "rahasia");
});

describe("POST /api/public/booking/webhook/xendit", () => {
  it("401 bila token salah — tanpa menyentuh DB", async () => {
    const res = await callback(paid(), "palsu");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("400 payload tak dikenal", async () => {
    const res = await callback({ status: "PAID" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Payload tidak dikenal");
  });

  it("external_id produk lain / uuid liar → 200 ignored", async () => {
    for (const externalId of ["topup-123", "tkt-booking-bukan-uuid", "tkt-pass-x"]) {
      const res = await callback(paid({ external_id: externalId }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, ignored: true });
    }
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("PAID → terbayar, promo di-capture, WA pemesan & penerima hadiah", async () => {
    const row = {
      id: BOOKING_ID,
      booking_code: "BK-ABC234",
      gift_recipient_phone: "6282",
    };
    queryOne.mockResolvedValueOnce(row);
    const res = await callback(paid());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(queryOne.mock.calls[0][1]).toEqual([BOOKING_ID, null, "inv-1"]);
    expect(capturePromoRedemption).toHaveBeenCalledWith({}, "ticket_booking", BOOKING_ID);
    expect(sendBookingPaidWa).toHaveBeenCalledWith(row);
    expect(sendBookingGiftWa).toHaveBeenCalledWith(row);
  });

  it("nominal kurang dari tagihan − promo → alert, tidak ditandai lunas", async () => {
    queryOne.mockResolvedValueOnce({ total: "150000", discount_amount: "25000" });
    const res = await callback(paid({ amount: 100000 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, ignored: true });
    expect(queryOne).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([
      BOOKING_ID,
      "Xendit melapor PAID dengan nominal Rp100.000 — kurang dari tagihan booking Rp125.000. Pembayaran TIDAK ditandai lunas; periksa dashboard Xendit.",
    ]);
    expect(sendBookingPaidWa).not.toHaveBeenCalled();
  });

  it("galat DB → 500 (Xendit mengulang), termasuk galat constraint", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queryOne.mockRejectedValueOnce(Object.assign(new Error("check"), { code: "23514" }));
    const res = await callback(paid());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Webhook gagal diproses" });
  });
});
