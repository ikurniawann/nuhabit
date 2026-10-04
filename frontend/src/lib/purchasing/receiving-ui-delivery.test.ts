import { describe, expect, it } from "vitest";
import {
  DELIVERY_STATUS_OPTIONS,
  deliveryItemRemaining,
  summarizeDeliveryItems,
  validateDeliveryForm,
} from "./receiving-ui-delivery";

describe("deliveryItemRemaining / summarizeDeliveryItems", () => {
  it("never returns a negative remaining qty", () => {
    expect(deliveryItemRemaining({ qty_ordered: 5, qty_received: 8 })).toBe(0);
    expect(deliveryItemRemaining({ qty_ordered: "5", qty_received: null })).toBe(5);
  });

  it("flags a reship only when something was received and something remains", () => {
    expect(summarizeDeliveryItems([{ qty_ordered: 10, qty_received: 0, subtotal: 1000 }])).toMatchObject({
      subtotal: 1000,
      isReship: false,
    });
    expect(
      summarizeDeliveryItems([
        { qty_ordered: 10, qty_received: 4, subtotal: "500" },
        { qty_ordered: 3, qty_received: 3, subtotal: 300 },
      ])
    ).toEqual({ subtotal: 800, totalReceived: 7, totalRemaining: 6, itemsWithRemaining: 1, isReship: true });
  });
});

describe("validateDeliveryForm", () => {
  const form = {
    no_surat_jalan: "SJ-1",
    kurir: "",
    no_resi: "",
    tanggal_kirim: "2026-10-04",
    tanggal_estimasi_tiba: "2026-10-06",
    catatan: "",
  };

  it("requires PO, surat jalan and both dates", () => {
    expect(validateDeliveryForm("", form)).toBe("Purchase order dan nomor surat jalan wajib diisi.");
    expect(validateDeliveryForm("po", { ...form, no_surat_jalan: "  " })).toBe(
      "Purchase order dan nomor surat jalan wajib diisi."
    );
    expect(validateDeliveryForm("po", { ...form, tanggal_kirim: "" })).toBe("Tanggal kirim wajib diisi.");
    expect(validateDeliveryForm("po", { ...form, tanggal_estimasi_tiba: "" })).toBe("Estimasi tanggal tiba wajib diisi.");
    expect(validateDeliveryForm("po", form)).toBeNull();
  });

  it("lists every status after the all option", () => {
    expect(DELIVERY_STATUS_OPTIONS.map((o) => o.value)).toEqual(["all", "pending", "shipped", "in_transit", "delivered", "cancelled"]);
  });
});
