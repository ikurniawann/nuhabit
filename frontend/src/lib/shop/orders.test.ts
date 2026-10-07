import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock("@/lib/shop/storefront-server", () => ({
  releaseExpiredReservations: vi.fn(),
  releaseOrderReservations: vi.fn(),
  restoreCommittedReservations: vi.fn(),
}));

const { allowedFromStatuses, assertOrderId, canShipOrder, parseShopOrderListFilter } = await import("./orders");

describe("aturan status pesanan toko", () => {
  it("transisi yang diizinkan", () => {
    expect(allowedFromStatuses("packing")).toEqual(["paid"]);
    expect(allowedFromStatuses("completed")).toEqual(["shipped"]);
    expect(allowedFromStatuses("cancelled")).toEqual(["pending", "paid", "packing"]);
    expect(allowedFromStatuses("shipped")).toBeNull();
    expect(allowedFromStatuses("toString")).toBeNull();
  });

  it("pengiriman hanya untuk order paid/packing", () => {
    expect(canShipOrder("paid")).toBe(true);
    expect(canShipOrder("packing")).toBe(true);
    expect(canShipOrder("pending")).toBe(false);
    expect(canShipOrder("shipped")).toBe(false);
  });

  it("id non-UUID diperlakukan sebagai order tidak ada", () => {
    expect(() => assertOrderId("abc")).toThrow("Order tidak ditemukan");
    expect(() => assertOrderId("7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f")).not.toThrow();
  });

  it("filter daftar: trim + batas limit 1..200 (default 100)", () => {
    expect(parseShopOrderListFilter(new URLSearchParams("status=%20paid%20&search=%20budi"))).toEqual({
      status: "paid",
      search: "budi",
      limit: 100,
    });
    expect(parseShopOrderListFilter(new URLSearchParams("limit=999")).limit).toBe(200);
    expect(parseShopOrderListFilter(new URLSearchParams("limit=-5")).limit).toBe(1);
  });
});
