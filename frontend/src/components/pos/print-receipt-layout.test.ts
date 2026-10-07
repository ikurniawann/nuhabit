import { describe, expect, it } from "vitest";

import {
  buildReceiptLines,
  type ReceiptPayload,
} from "./PrintReceipt";

/**
 * Tes ditulis lebih dulu — redesign isi struk (permintaan owner 2026-08-16):
 * struk customer harus memuat nama item + qty + HARGA, stall asal, Subtotal,
 * rincian diskon (jenis + nilai + total diskon), pajak ber-label persen, dan
 * total setelah pajak. Copy dapur/bar tetap tanpa harga.
 */

const basePayload = (over: Partial<ReceiptPayload> = {}): ReceiptPayload => ({
  orderId: "abc12345",
  orderNumber: "ORD-0001",
  queueNumber: null,
  orderType: "dine_in",
  table: null,
  items: [
    {
      id: "p1",
      productId: "p1",
      name: "Nasi Goreng",
      price: 25_000,
      quantity: 2,
    },
    {
      id: "p2",
      productId: "p2",
      name: "Es Teh",
      price: 8_000,
      quantity: 1,
    },
  ],
  notes: "",
  total: 55_000,
  change: 0,
  paymentMethod: "cash",
  discountAmount: 0,
  taxAmount: 0,
  ...over,
});

describe("buildReceiptLines — struk customer", () => {
  it("menampilkan harga per item: line total di kanan, harga satuan saat qty > 1", () => {
    const lines = buildReceiptLines(basePayload(), "CUSTOMER");
    const nasi = lines.find((l) => l.includes("2x Nasi Goreng"));
    expect(nasi).toBeDefined();
    expect(nasi).toMatch(/50\.000/); // 2 × 25.000, right-aligned
    // Harga satuan tampil untuk qty > 1
    expect(lines.some((l) => l.includes("@ Rp 25.000"))).toBe(true);
    // Qty 1 cukup line total, tanpa baris satuan
    const esTeh = lines.find((l) => l.includes("1x Es Teh"));
    expect(esTeh).toMatch(/8\.000/);
  });

  it("menampilkan Subtotal sebelum diskon/pajak", () => {
    const lines = buildReceiptLines(basePayload({ subtotal: 58_000 }), "CUSTOMER");
    const subtotal = lines.find((l) => l.startsWith("Subtotal"));
    expect(subtotal).toBeDefined();
    expect(subtotal).toMatch(/58\.000/);
  });

  it("merinci diskon per jenis + baris Total Diskon bila lebih dari satu", () => {
    const lines = buildReceiptLines(
      basePayload({
        subtotal: 58_000,
        discountAmount: 8_000,
        discountLines: [
          { label: "Diskon Member (5%)", amount: 3_000 },
          { label: "Diskon Manual (10%)", amount: 5_000 },
        ],
      }),
      "CUSTOMER"
    );
    expect(lines.some((l) => l.includes("Diskon Member (5%") && l.includes("-Rp 3.000"))).toBe(true);
    expect(lines.some((l) => l.includes("Diskon Manual (10%") && l.includes("-Rp 5.000"))).toBe(true);
    const totalDiskon = lines.find((l) => l.startsWith("Total Diskon"));
    expect(totalDiskon).toMatch(/-Rp 8\.000/);
  });

  it("satu jenis diskon → tanpa baris Total Diskon (tidak redundan)", () => {
    const lines = buildReceiptLines(
      basePayload({
        discountAmount: 5_000,
        discountLines: [{ label: "Diskon Manual (10%)", amount: 5_000 }],
      }),
      "CUSTOMER"
    );
    expect(lines.some((l) => l.includes("Diskon Manual"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Total Diskon"))).toBe(false);
  });

  it("tanpa rincian → fallback satu baris Diskon (payload lama tetap jalan)", () => {
    const lines = buildReceiptLines(basePayload({ discountAmount: 4_000 }), "CUSTOMER");
    expect(lines.some((l) => l.startsWith("Diskon") && l.includes("-Rp 4.000"))).toBe(true);
  });

  it("baris pajak memuat persen bila charge percent, dan TOTAL setelah pajak", () => {
    const lines = buildReceiptLines(
      basePayload({
        total: 63_800,
        chargesBreakdown: [
          { code: "TAX", name: "Tax", kind: "tax", amount: 5_800, rate: 10, calc_method: "percent" },
        ],
      }),
      "CUSTOMER"
    );
    expect(lines.some((l) => l.includes("Tax (10%)") && l.includes("5.800"))).toBe(true);
    const total = lines.find((l) => l.startsWith("TOTAL"));
    expect(total).toMatch(/63\.800/);
  });

  it("menampilkan stall asal di header bila ada", () => {
    const lines = buildReceiptLines(basePayload({ stallName: "Hikiniku Bar" }), "CUSTOMER");
    expect(lines.some((l) => l.includes("Stall: Hikiniku Bar"))).toBe(true);
  });

  it("copy dapur tetap tanpa harga & tanpa blok total", () => {
    const lines = buildReceiptLines(
      basePayload({ subtotal: 58_000, stallName: "Hikiniku Bar" }),
      "KITCHEN"
    );
    expect(lines.some((l) => l.includes("2x Nasi Goreng"))).toBe(true);
    expect(lines.some((l) => l.includes("25.000") || l.includes("50.000"))).toBe(false);
    expect(lines.some((l) => l.startsWith("Subtotal"))).toBe(false);
    // Stall tetap tampil — dapur perlu tahu asal order
    expect(lines.some((l) => l.includes("Stall: Hikiniku Bar"))).toBe(true);
  });
});

describe("buildReceiptLines — transaksi lintas stall (mode Semua Stall)", () => {
  it("item membawa stall asalnya saat header tanpa stall", () => {
    const lines = buildReceiptLines(
      basePayload({
        stallName: null,
        items: [
          { id: "1", productId: "1", name: "Nasi Goreng", price: 25_000, quantity: 1, stallName: "Hikiniku Bar" },
          { id: "2", productId: "2", name: "Es Teh", price: 8_000, quantity: 1, stallName: "Noodles Bar" },
        ],
      }),
      "CUSTOMER"
    );
    expect(lines.some((l) => l.includes("[Hikiniku Bar]"))).toBe(true);
    expect(lines.some((l) => l.includes("[Noodles Bar]"))).toBe(true);
  });

  it("stall tunggal (header sudah menyebut stall) → tanpa sub-baris redundan", () => {
    const lines = buildReceiptLines(
      basePayload({
        stallName: "Hikiniku Bar",
        items: [
          { id: "1", productId: "1", name: "Nasi Goreng", price: 25_000, quantity: 1, stallName: "Hikiniku Bar" },
        ],
      }),
      "CUSTOMER"
    );
    expect(lines.some((l) => l.includes("[Hikiniku Bar]"))).toBe(false);
    expect(lines.some((l) => l.includes("Stall: Hikiniku Bar"))).toBe(true);
  });

  it("copy dapur juga memuat stall per item — CO lintas stall terbaca", () => {
    const lines = buildReceiptLines(
      basePayload({
        stallName: null,
        items: [
          { id: "1", productId: "1", name: "Nasi Goreng", price: 25_000, quantity: 2, stallName: "Hikiniku Bar" },
        ],
      }),
      "KITCHEN"
    );
    expect(lines.some((l) => l.includes("[Hikiniku Bar]"))).toBe(true);
  });
});
