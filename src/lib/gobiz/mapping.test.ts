import { describe, expect, it } from "vitest";
import {
  gofoodOrderTypeFromServiceType,
  mapGofoodItems,
  parseGofoodWebhook,
  posOrderNotes,
  shouldAdvanceStatus,
  statusFromEventName,
  summarizeGofoodOrder,
} from "./mapping";

// Contoh payload dari developer.gobiz.com/docs/api/event-list
const sampleEvent = {
  header: {
    event_name: "gofood.order.awaiting_merchant_acceptance",
    event_id: "c1be7fa1-645e-3d57-9ca3-f2cb54212345",
    version: 1,
    timestamp: "2019-08-24T14:15:22.557+07:00",
  },
  body: {
    customer: { id: "536D5047", name: "GoFood Customer" },
    driver: { name: "GoFood Driver" },
    service_type: "gofood",
    outlet: { id: "G123456789", external_outlet_id: "outlet01" },
    order: {
      status: "AWAITING_MERCHANT_ACCEPTANCE",
      pin: "1234",
      order_number: "F-123456789",
      order_total: 40000,
      currency: "IDR",
      order_items: [
        {
          id: "e44495da",
          external_id: "prod-1",
          name: "Hamburger",
          quantity: 2,
          price: 15000,
          notes: "pedas",
          variants: [{ id: "var-x", name: "Hamburger keju", external_id: "v-keju" }],
        },
        { id: "zz", external_id: "prod-unknown", name: "Misterius", quantity: 1, price: 10000 },
        { id: "yy", name: "Tanpa id", quantity: 1, price: 0 },
      ],
      cutlery_requested: true,
      takeaway_charges: 0,
      created_at: "2019-08-24T14:15:22.557+07:00",
      cancellation_detail: { reason: "" },
    },
  },
};

describe("parseGofoodWebhook", () => {
  it("menerima contoh payload resmi dan menolak bentuk asing", () => {
    expect(parseGofoodWebhook(sampleEvent)?.header.event_id).toBe(sampleEvent.header.event_id);
    expect(parseGofoodWebhook({ foo: 1 })).toBeNull();
    expect(parseGofoodWebhook(null)).toBeNull();
    expect(parseGofoodWebhook({ header: { event_name: "x" } })).toBeNull();
  });

  it("toleran terhadap body minimal (webhook_error / catalog events tanpa order)", () => {
    const parsed = parseGofoodWebhook({
      header: { event_name: "gofood.catalog.menu_mapping_updated", event_id: "e2" },
      body: { outlet: { id: "G1" } },
    });
    expect(parsed?.body.order).toBeUndefined();
  });
});

describe("summarizeGofoodOrder / order type", () => {
  it("meringkas kolom gofood_orders dari body", () => {
    const summary = summarizeGofoodOrder(parseGofoodWebhook(sampleEvent)!);
    expect(summary).toMatchObject({
      gofood_order_id: "F-123456789",
      gofood_order_type: "delivery",
      outlet_id: "G123456789",
      order_total: 40000,
      customer_name: "GoFood Customer",
      driver_name: "GoFood Driver",
      pin: "1234",
      cutlery_requested: true,
      cancel_reason: null,
    });
    expect(summary.items).toHaveLength(3);
  });

  it("service_type gofood_pickup → pickup", () => {
    expect(gofoodOrderTypeFromServiceType("gofood_pickup")).toBe("pickup");
    expect(gofoodOrderTypeFromServiceType("gofood")).toBe("delivery");
    expect(gofoodOrderTypeFromServiceType(undefined)).toBe("delivery");
  });
});

describe("mapGofoodItems", () => {
  const products = new Map([
    [
      "prod-1",
      {
        id: "prod-1",
        name: "Burger BCD",
        sku: "BRG-01",
        station: "kitchen",
        variants: [{ id: "v-keju", name: "Keju" }],
      },
    ],
  ]);

  it("memetakan via external_id, memakai harga GoFood, nama varian dari katalog POS; sisanya unmapped", () => {
    const { lines, unmapped } = mapGofoodItems(sampleEvent.body.order.order_items, products);
    expect(lines).toEqual([
      {
        product_id: "prod-1",
        product_name: "Burger BCD",
        product_sku: "BRG-01",
        quantity: 2,
        unit_price: 15000,
        variant_name: "Keju",
        notes: "pedas",
        station: "kitchen",
      },
    ]);
    expect(unmapped.map((u) => [u.name, u.reason])).toEqual([
      ["Misterius", "product_not_found"],
      ["Tanpa id", "no_external_id"],
    ]);
  });

  it("varian tak dikenal di katalog → pakai nama dari GoFood", () => {
    const { lines } = mapGofoodItems(
      [{ external_id: "prod-1", name: "x", quantity: 1, price: 1, variants: [{ name: "Extra" }] }],
      products
    );
    expect(lines[0].variant_name).toBe("Extra");
  });
});

describe("status machine", () => {
  it("memetakan nama event ke status internal", () => {
    expect(statusFromEventName("gofood.order.awaiting_merchant_acceptance")).toBe("awaiting_acceptance");
    expect(statusFromEventName("gofood.order.merchant_accepted")).toBe("accepted");
    expect(statusFromEventName("gofood.order.cancelled")).toBe("cancelled");
    expect(statusFromEventName("gofood.order.webhook_error")).toBeNull();
  });

  it("status hanya maju; terminal menang; setelah terminal tidak berubah", () => {
    expect(shouldAdvanceStatus("awaiting_acceptance", "accepted")).toBe(true);
    expect(shouldAdvanceStatus("accepted", "awaiting_acceptance")).toBe(false);
    expect(shouldAdvanceStatus("driver_arrived", "driver_otw_pickup")).toBe(false);
    expect(shouldAdvanceStatus("accepted", "cancelled")).toBe(true);
    expect(shouldAdvanceStatus("cancelled", "accepted")).toBe(false);
    expect(shouldAdvanceStatus("completed", "cancelled")).toBe(false);
    expect(shouldAdvanceStatus("accepted", "accepted")).toBe(false);
  });
});

describe("posOrderNotes", () => {
  it("menyusun catatan kasir/dapur", () => {
    expect(
      posOrderNotes({
        gofood_order_id: "F-1",
        gofood_order_type: "pickup",
        pin: "9999",
        customer_name: "Budi",
        cutlery_requested: false,
        unmappedCount: 1,
      })
    ).toBe("GoFood F-1 · Pickup · PIN 9999 · Pelanggan: Budi · 1 item TIDAK terpetakan — cek halaman GoFood");
  });
});
