import { describe, expect, it } from "vitest";
import {
  buildOfflineOrderPayload,
  canPayOffline,
  classifySyncFailure,
  isOfflineReceiptNumber,
  offlineReceiptNumber,
  shouldAutoSync,
} from "@/lib/pos/offline-sync";
import type { BillChargesResult } from "@/lib/pos/billing-settings";

describe("classifySyncFailure", () => {
  it("jaringan putus (fetch melempar TypeError) → retry, item tetap pending", () => {
    expect(classifySyncFailure(new TypeError("Failed to fetch"))).toBe("retry");
  });
  it("server tumbang tanpa JSON (SyntaxError) atau 5xx → retry", () => {
    expect(classifySyncFailure(new SyntaxError("Unexpected token <"))).toBe("retry");
    expect(classifySyncFailure(new Error("API error: 502"))).toBe("retry");
  });
  it("ditolak server dengan alasan bisnis → failed (butuh keputusan kasir)", () => {
    expect(classifySyncFailure(new Error("Stok Es Kopi Susu tidak cukup"))).toBe("failed");
    expect(classifySyncFailure(new Error("API error: 400"))).toBe("failed");
  });
});

describe("shouldAutoSync", () => {
  it("hanya saat online, ada antrian, dan tidak sedang sinkron", () => {
    expect(shouldAutoSync({ online: true, pendingCount: 2, syncing: false })).toBe(true);
    expect(shouldAutoSync({ online: false, pendingCount: 2, syncing: false })).toBe(false);
    expect(shouldAutoSync({ online: true, pendingCount: 0, syncing: false })).toBe(false);
    expect(shouldAutoSync({ online: true, pendingCount: 2, syncing: true })).toBe(false);
  });
});

describe("nomor struk offline & metode bayar", () => {
  it("nomor OFFLINE-… dikenali kembali", () => {
    const n = offlineReceiptNumber(1_700_000_000_000);
    expect(n.startsWith("OFFLINE-")).toBe(true);
    expect(isOfflineReceiptNumber(n)).toBe(true);
    expect(isOfflineReceiptNumber("POS-20260916-0001")).toBe(false);
  });
  it("tunai/QRIS/kartu boleh offline; ARK, NFC, gift card, FOC tidak", () => {
    expect(canPayOffline("cash")).toBe(true);
    expect(canPayOffline("qris")).toBe(true);
    expect(canPayOffline("ark_coin")).toBe(false);
    expect(canPayOffline("gift_card")).toBe(false);
  });
});

describe("buildOfflineOrderPayload", () => {
  const billCharges: BillChargesResult = {
    subtotal_after_discount: 47_000,
    tax_amount: 4_700,
    service_charge_amount: 0,
    other_charges_amount: 0,
    total: 51_700,
    breakdown: [{ code: "PPN", name: "PPN 10%", kind: "tax", amount: 4_700 }],
  } as unknown as BillChargesResult;

  it("memisahkan harga dasar dari penyesuaian varian/modifier seperti use-pos-checkout", () => {
    const payload = buildOfflineOrderPayload({
      items: [
        {
          id: "p1::Ice — Oat Milk::Extra Shot",
          productId: "p1",
          name: "Es Kopi Susu",
          price: 25_000 + 8_000 + 5_000,
          quantity: 1,
          variantName: "Ice — Oat Milk",
          variantPriceAdj: 8_000,
          modifierNames: ["Extra Shot"],
          modifierPriceAdj: 5_000,
        },
        { id: "p2", productId: "p2", name: "Es Teh", price: 12_000, quantity: 1 },
      ],
      orderType: "takeaway",
      cashierId: "cashier",
      customerId: null,
      method: "cash",
      cashReceived: "100000",
      discountStack: {
        gross_subtotal: 50_000,
        discount_amount: 3_000,
        line_results: [
          { discount_amount: 3_000, total_amount: 35_000 },
          { discount_amount: 0, total_amount: 12_000 },
        ],
      },
      billCharges,
      includeTax: true,
      membershipDiscountPct: 0,
      manualDiscountType: "fixed",
      manualDiscountValue: 3_000,
      notes: "",
      shiftId: null,
    });

    expect(payload.items[0]).toMatchObject({
      unit_price: 25_000,
      variant_price_adjustment: 8_000,
      modifier_price_adjustment: 5_000,
      variants: [{ name: "Ice — Oat Milk", group: "Size", price: 8_000 }],
      modifiers: [{ name: "Extra Shot", group: "Option-0" }],
      discount_amount: 3_000,
      total_amount: 35_000,
    });
    expect(payload.subtotal).toBe(50_000);
    expect(payload.discount_amount).toBe(3_000);
    expect(payload.total_amount).toBe(51_700);
    expect(payload.amount_paid).toBe(100_000);
    expect(payload.payment_method).toBe("cash");
    expect(payload.ark_coins_used).toBe(0);
  });

  it("kartu kredit dipetakan ke 'credit' dan amount_paid = total (bukan tunai)", () => {
    const payload = buildOfflineOrderPayload({
      items: [{ id: "p2", productId: "p2", name: "Es Teh", price: 12_000, quantity: 2 }],
      orderType: "dine_in",
      cashierId: "cashier",
      method: "credit_card",
      cashReceived: "",
      discountStack: { gross_subtotal: 24_000, discount_amount: 0, line_results: [{ discount_amount: 0, total_amount: 24_000 }] },
      billCharges: { ...billCharges, total: 24_000 },
      includeTax: false,
      membershipDiscountPct: 0,
      manualDiscountType: null,
      manualDiscountValue: null,
      notes: "",
    });
    expect(payload.payment_method).toBe("credit");
    expect(payload.amount_paid).toBe(24_000);
    expect(payload.items[0].subtotal).toBe(24_000);
  });
});
