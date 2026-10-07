// Buat booking publik — guard sebelum insert: rate limit per IP, validasi,
// jendela tanggal, Xendit wajib siap (503), slug tak dikenal 404 generik.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetRateLimits } from "@/lib/public/rate-limit";
import { addDaysIso } from "@/lib/ticketing/calendar";
import { todayInJakarta } from "@/lib/ticketing/booking";

const isXenditConfigured = vi.fn();
vi.mock("@/lib/xendit/client", () => ({
  isXenditConfigured: () => isXenditConfigured(),
  createInvoice: vi.fn(),
  getInvoiceExpiryHours: () => 24,
}));
const queryOne = vi.fn();
const withTransaction = vi.fn();
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: (...args: unknown[]) => queryOne(...args),
  withTransaction: (...args: unknown[]) => withTransaction(...args),
}));
vi.mock("@/lib/promo/promo-server", () => ({
  PromoRejectedError: class extends Error {},
  holdPromoRedemption: vi.fn(),
  releasePromoRedemption: vi.fn(),
}));

const { POST } = await import("./route");

const validBody = () => ({
  visit_date: addDaysIso(todayInJakarta(), 1),
  customer_name: "Budi Santoso",
  customer_phone: "0812-3456-7890",
  items: [{ variant_id: "3f0c8a8e-8a51-4c1e-9d55-0b6a1d2b4c11", qty: 2 }],
});

const create = (body: unknown, ip = "203.0.113.20") =>
  POST(
    new NextRequest("http://localhost/api/public/booking/kolam-ceria", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: "kolam-ceria" }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  isXenditConfigured.mockReturnValue(true);
});

describe("POST /api/public/booking/[slug]", () => {
  it("400 validasi dengan detail issue", async () => {
    const res = await create({ ...validBody(), customer_name: "B" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Validation failed");
    expect(Array.isArray(json.details)).toBe(true);
  });

  it("400 tanggal kunjungan sudah lewat", async () => {
    const res = await create({ ...validBody(), visit_date: addDaysIso(todayInJakarta(), -1) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Tanggal kunjungan sudah lewat");
  });

  it("400 varian duplikat", async () => {
    const body = validBody();
    const res = await create({ ...body, items: [...body.items, ...body.items] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Varian duplikat dalam pesanan");
  });

  it("503 bila Xendit belum siap — SEBELUM menyentuh DB", async () => {
    isXenditConfigured.mockReturnValue(false);
    const res = await create(validBody());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(
      "Pembayaran online belum tersedia — silakan beli di loket"
    );
    expect(queryOne).not.toHaveBeenCalled();
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("404 generik untuk slug tanpa venue", async () => {
    queryOne.mockResolvedValueOnce(null);
    const res = await create(validBody());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Not found" });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("429 setelah 5 percobaan per IP", async () => {
    for (let i = 0; i < 5; i++) await create({}, "192.0.2.50");
    const res = await create({}, "192.0.2.50");
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(
      "Terlalu banyak percobaan — coba lagi beberapa menit lagi"
    );
  });
});
