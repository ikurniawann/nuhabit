import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), queryOne: vi.fn() }));

const { toPublicOrderStatus } = await import("./order-status");

const order = {
  id: "o1",
  order_number: "SHP-001",
  status: "pending",
  customer_name: "Budi",
  shipping_area_label: "Coblong, Bandung",
  shipping_address: "Jl. Dago 1",
  courier_code: "jne",
  courier_service: "reg",
  subtotal: "100000",
  shipping_cost: "12000",
  total: "112000",
  xendit_invoice_url: "https://invoice.example/abc",
  waybill: null,
  paid_at: null,
  created_at: "2026-10-04T05:00:00Z",
};

describe("toPublicOrderStatus", () => {
  it("angka jadi Number, kurir digabung, nama varian ditempel", () => {
    const view = toPublicOrderStatus(order, [
      { product_name: "Kaos", sku_name: "L", quantity: "2", unit_price: "50000", total: "100000" },
    ]);
    expect(view).toMatchObject({
      courier: "jne — reg",
      subtotal: 100_000,
      shipping_cost: 12_000,
      total: 112_000,
      invoice_url: "https://invoice.example/abc",
      items: [{ name: "Kaos — L", quantity: 2, unit_price: 50_000, total: 100_000 }],
    });
    expect(view).not.toHaveProperty("id");
  });

  it("link invoice disembunyikan setelah tidak pending", () => {
    expect(toPublicOrderStatus({ ...order, status: "paid" }, []).invoice_url).toBeNull();
  });
});
