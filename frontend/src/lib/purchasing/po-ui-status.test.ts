import { describe, expect, it } from "vitest";
import {
  canCancelPurchaseOrder,
  canReshipPurchaseOrder,
  canTrackShipment,
  paymentStatusBadge,
  poLifecycleBadge,
  poStatusBadge,
  vendorPoStatusBadge,
} from "./po-ui-status";

describe("poStatusBadge", () => {
  it("normalizes case and labels received per context", () => {
    expect(poStatusBadge("RECEIVED").label).toBe("Selesai");
    expect(poStatusBadge("received", "detail").label).toBe("Diterima Penuh");
    expect(poStatusBadge("partially_received").label).toBe("Diterima Sebagian");
  });

  it("falls back to the raw status with a neutral style", () => {
    expect(poStatusBadge("weird")).toEqual({ label: "weird", className: "bg-gray-100 text-gray-800" });
  });
});

describe("lifecycle and payment badges", () => {
  it("defaults missing values", () => {
    expect(poLifecycleBadge(undefined).label).toBe("Sedang Berjalan");
    expect(paymentStatusBadge(null).label).toBe("Belum Dibayar");
    expect(paymentStatusBadge("paid").label).toBe("Lunas");
  });

  it("humanizes unknown vendor PO statuses", () => {
    expect(vendorPoStatusBadge("sent").label).toBe("Dikirim");
    expect(vendorPoStatusBadge("on_hold").label).toBe("on hold");
  });
});

describe("PO action rules", () => {
  it("tracks shipments only between approval and full receipt", () => {
    expect(canTrackShipment("approved")).toBe(true);
    expect(canTrackShipment("PARTIAL")).toBe(true);
    expect(canTrackShipment("draft")).toBe(false);
    expect(canTrackShipment("received")).toBe(false);
  });

  it("reships a partially received PO without an active delivery", () => {
    expect(canReshipPurchaseOrder({ status: "partially_received" })).toBe(true);
    expect(canReshipPurchaseOrder({ status: "partial", active_delivery_id: "d1" })).toBe(false);
    expect(canReshipPurchaseOrder({ status: "sent" })).toBe(false);
  });

  it("blocks cancelling received/cancelled POs and closed ones unless allowed", () => {
    expect(canCancelPurchaseOrder("draft")).toBe(true);
    expect(canCancelPurchaseOrder("received")).toBe(false);
    expect(canCancelPurchaseOrder("cancelled", { allowClosed: true })).toBe(false);
    expect(canCancelPurchaseOrder("closed")).toBe(false);
    expect(canCancelPurchaseOrder("closed", { allowClosed: true })).toBe(true);
  });
});
