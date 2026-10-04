import { describe, expect, it } from "vitest";
import { buildLines, planMixedSale, sliceLinesByStall } from "./rules";
import { MULTI_STALL_REQUIRED_MESSAGE, type CreateMixedCheckoutInput } from "./types";

const warehouseByProduct = new Map<string, string | null>([
  ["kopi", "bar"],
  ["roti", "bakery"],
  ["teh", "bar"],
]);
const items = [
  { product_id: "kopi", quantity: 2, unit_price: 20000 },
  { product_id: "roti", quantity: 1, unit_price: 15000, modifier_price_adjustment: 2000 },
  { product_id: "teh", quantity: 3, unit_price: 8000, variant_price_adjustment: 1000 },
];
const input = (overrides: Partial<CreateMixedCheckoutInput> = {}): CreateMixedCheckoutInput => ({
  items,
  warehouseByProduct,
  cashierId: "kasir",
  sessionUserId: "user",
  ...overrides,
});

describe("sliceLinesByStall", () => {
  it("mengelompokkan per stall menurut urutan kemunculan dan menjumlah subtotal", () => {
    const slices = sliceLinesByStall(buildLines(items, warehouseByProduct));
    expect(slices.map((slice) => [slice.warehouseId, slice.subtotal, slice.lines.length])).toEqual([
      ["bar", 40000 + 27000, 2],
      ["bakery", 17000, 1],
    ]);
  });
});

describe("planMixedSale", () => {
  it("tunai lunas: total server = subtotal - diskon + pajak, kembalian dihitung", () => {
    const plan = planMixedSale(input({ discountAmount: 4000, taxAmount: 8000, amountPaid: 100000 }));
    expect(plan).toMatchObject({
      serverSubtotal: 84000,
      serverTotal: 88000,
      paymentMethod: "cash",
      paymentStatus: "paid",
      insertChildren: true,
      isPaidSale: true,
      changeAmount: 12000,
      canCreateFreshCheckout: true,
    });
    expect(plan.snapshot.warehouseByProduct).toEqual({ kopi: "bar", roti: "bakery", teh: "bar" });
  });

  it("QRIS kurang bayar → unpaid tanpa anak-order", () => {
    const plan = planMixedSale(input({ paymentMethod: "qris", amountPaid: 0 }));
    expect(plan).toMatchObject({ paymentStatus: "unpaid", insertChildren: false, isPaidSale: false });
  });

  it("open bill: unpaid diminta tetap unpaid meski forceInsertChildren", () => {
    const plan = planMixedSale(input({ paymentStatus: "unpaid", forceInsertChildren: true, tableId: "t1" }));
    expect(plan).toMatchObject({ paymentStatus: "unpaid", insertChildren: true, requestedUnpaid: true });
  });

  it("satu stall hanya boleh bila melanjutkan meja/checkout", () => {
    const single = [items[0]!, items[2]!];
    expect(() => planMixedSale(input({ items: single, amountPaid: 1e6 }))).toThrow(MULTI_STALL_REQUIRED_MESSAGE);
    expect(planMixedSale(input({ items: single, tableId: "t1", amountPaid: 1e6 })).canCreateFreshCheckout).toBe(false);
  });

  it("ARK harus menutup seluruh total", () => {
    expect(() =>
      planMixedSale(input({ paymentMethod: "ark_coin", customerId: "c1", arkCoinsUsed: 1000, paymentStatus: "unpaid" }))
    ).toThrow("Pembayaran ARK Coin harus menutup seluruh total order");
  });
});
