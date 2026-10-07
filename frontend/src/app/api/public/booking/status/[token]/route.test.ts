// Status booking publik — token 64 hex wajib, token salah/tak dikenal 404
// generik (anti-enumerasi), rate limit per IP, bentuk respons tetap.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetRateLimits } from "@/lib/public/rate-limit";

const query = vi.fn();
const queryOne = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => query(...args),
  queryOne: (...args: unknown[]) => queryOne(...args),
  withTransaction: vi.fn(),
}));
vi.mock("@/lib/promo/promo-server", () => ({ releasePromoRedemption: vi.fn() }));

const { GET } = await import("./route");

const TOKEN = "a".repeat(64);

const get = (token: string, ip = "198.51.100.7") =>
  GET(
    new NextRequest(`http://localhost/api/public/booking/status/${token}`, {
      headers: { "x-forwarded-for": ip },
    }),
    { params: Promise.resolve({ token }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
});

describe("GET /api/public/booking/status/[token]", () => {
  it("token bukan 64 hex → 404 tanpa query", async () => {
    const res = await get("BK-ABC234");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Not found" });
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("token tak dikenal → 404 generik", async () => {
    queryOne.mockResolvedValueOnce(null);
    const res = await get(TOKEN);
    expect(res.status).toBe(404);
  });

  it("booking terbayar: payable = total − promo, jam slot HH:MM, tanpa link bayar", async () => {
    queryOne.mockResolvedValueOnce({
      id: "b-1",
      booking_code: "BK-ABC234",
      visit_date: "2026-10-04",
      customer_name: "Budi",
      status: "terbayar",
      total: "150000.00",
      discount_amount: "25000.00",
      promo_code: "HEMAT",
      gift_recipient_name: null,
      slot_label: "Pagi",
      slot_start_time: "08:00:00",
      slot_end_time: "10:00:00",
      xendit_invoice_url: "https://invoice",
      expires_at: null,
      paid_at: "2026-10-03 10:00:00+07",
      used_at: null,
    });
    query
      .mockResolvedValueOnce([
        {
          variant_id: "v1",
          ticket_product_id: "p1",
          product_name: "Kolam",
          variant_name: "Adult",
          qty: 2,
          unit_price: "75000.00",
          season_kind: "regular",
          subtotal: "150000.00",
        },
      ])
      .mockResolvedValueOnce([{ guest_name: "Budi", variant_name: "Adult" }]);

    const res = await get(TOKEN);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({
      booking_code: "BK-ABC234",
      status: "terbayar",
      total: 150000,
      discount_amount: 25000,
      payable: 125000,
      slot_start_time: "08:00",
      slot_end_time: "10:00",
      invoice_url: null,
    });
    expect(data.items).toEqual([
      {
        product_name: "Kolam",
        variant_name: "Adult",
        qty: 2,
        unit_price: 75000,
        season_kind: "regular",
        subtotal: 150000,
      },
    ]);
  });

  it("429 setelah 30 permintaan per menit dari IP yang sama", async () => {
    for (let i = 0; i < 30; i++) await get("x", "192.0.2.1");
    const res = await get("x", "192.0.2.1");
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("Terlalu banyak permintaan — coba lagi sebentar");
  });
});
