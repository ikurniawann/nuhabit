import { describe, expect, it } from "vitest";
import {
  stripNulls,
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

  it("add-on GoFood (external_id = id pos_modifiers) → modifiers POS dgn grup & harga GoFood", () => {
    const withAddons = new Map([
      [
        "prod-latte",
        {
          id: "prod-latte",
          name: "Iced Latte",
          sku: "LATTE",
          station: "bar",
          variants: [],
          modifiers: [
            { id: "m-shot", name: "Extra Shot Espresso", groupName: "Tambahan Espresso", price: 12000 },
            { id: "m-oat", name: "Oat Milk", groupName: "Pilihan Susu", price: 6000 },
          ],
        },
      ],
    ]);
    const { lines } = mapGofoodItems(
      [
        {
          external_id: "prod-latte",
          name: "Iced Latte",
          quantity: 1,
          price: 48000,
          variants: [
            { external_id: "m-shot", name: "Extra Shot Espresso" },
            { external_id: "m-oat", name: "Oat Milk" },
            { external_id: "m-hilang", name: "Less Ice" },
          ],
        },
        { external_id: "prod-latte", name: "Iced Latte", quantity: 1, price: 30000 },
      ],
      withAddons
    );
    expect(lines[0].modifiers).toEqual([
      { name: "Extra Shot Espresso", group: "Tambahan Espresso", price: 12000 },
      { name: "Oat Milk", group: "Pilihan Susu", price: 6000 },
    ]);
    // pilihan tak dikenal tetap tampil sbg teks varian; harga item tetap dari GoFood
    expect(lines[0].variant_name).toBe("Less Ice");
    expect(lines[0].unit_price).toBe(48000);
    // tanpa add-on: kunci modifiers tidak ada (bentuk lama tidak berubah)
    expect(lines[1]).not.toHaveProperty("modifiers");
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

describe("parseGofoodWebhook — payload asli sandbox GoBiz (2026-09-28)", () => {
  // Diambil dari log produksi: kolom kosong dikirim sebagai null.
  const real = {
    header: {
      version: 1,
      timestamp: "2026-09-28T21:22:50.446+07:00",
      event_name: "gofood.order.merchant_accepted",
      event_id: "d6e031a7-bedc-3e5b-add0-10b6cedc931e",
    },
    body: {
      service_type: "gofood",
      outlet: { id: "G799456240", external_outlet_id: null },
      customer: { id: "c-1", name: null },
      driver: null,
      order: {
        takeaway_charges: 0,
        status: "MERCHANT_ACCEPTED",
        scheduled_flag: null,
        pin: "7767",
        order_total: 338000,
        order_number: "F-885936681",
        cancellation_detail: null,
        order_items: [
          { variants: [], sku_promo_id: null, quantity: 1, price: 108000, notes: "Less sugar", name: "1 Litre Iced Bold", external_id: "p-1" },
          {
            variants: [{ id: "v-1", name: "Extra Shot Espresso", external_id: "m-shot" }],
            sku_promo_id: null,
            quantity: 2,
            price: 40000,
            notes: null,
            name: "Iced Bold",
            external_id: "p-2",
          },
        ],
      },
    },
  };

  it("null tidak lagi membuat event ditolak; isi order utuh", () => {
    const event = parseGofoodWebhook(real);
    expect(event).not.toBeNull();
    expect(event!.body.outlet?.id).toBe("G799456240");
    expect(event!.body.order?.order_number).toBe("F-885936681");
    expect(event!.body.order?.order_items).toHaveLength(2);
    expect(event!.body.order?.order_items?.[1].variants?.[0].external_id).toBe("m-shot");
    expect(event!.body.order?.order_items?.[0].notes).toBe("Less sugar");
  });

  it("event katalog (menu_mapping_updated) juga lolos parsing", () => {
    const event = parseGofoodWebhook({
      header: { version: 1, event_name: "gofood.catalog.menu_mapping_updated", event_id: "e-cat" },
      body: { request_id: "r", outlet: { id: "G799456240", external_outlet_id: null }, menus: [{ id: "m", external_menu_id: "x" }] },
    });
    expect(event?.header.event_name).toBe("gofood.catalog.menu_mapping_updated");
  });

  it("stripNulls membuang null bersarang & elemen array null", () => {
    expect(stripNulls({ a: null, b: { c: null, d: 1 }, e: [null, { f: null }] })).toEqual({ b: { d: 1 }, e: [{}] });
  });
});
