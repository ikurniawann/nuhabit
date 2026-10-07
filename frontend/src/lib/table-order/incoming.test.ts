import { describe, expect, it } from "vitest";
import {
  isSelfOrder,
  pickIncomingSelfOrders,
  selfOrderPaymentFlow,
  selfOrderTableCode,
  splitByRecency,
  timeAgoText,
} from "./incoming";
import { TABLE_ORDER_TAG } from "./server";

const self = (id: string, status: string, at: string, payment = "cashier") => ({
  id,
  status,
  ordered_at: at,
  special_requests: `Self-service table order WIT-OFFICE-BDG; payment=${payment}`,
});

describe("incoming self-order", () => {
  it("prefix sama dgn tag yang ditulis route self-order", () => {
    expect(TABLE_ORDER_TAG).toBe("Self-service table order");
  });

  it("hanya self-order pending, urut terlama dulu", () => {
    const orders = [
      self("b", "pending", "2026-10-01T10:05:00Z"),
      self("a", "pending", "2026-10-01T10:01:00Z"),
      self("c", "confirmed", "2026-10-01T10:00:00Z"),
      { id: "kasir", status: "pending", ordered_at: "2026-10-01T09:00:00Z", special_requests: null },
      { id: "gofood", status: "pending", ordered_at: "2026-10-01T09:00:00Z", special_requests: "GoFood F-1; type=delivery" },
    ];
    expect(pickIncomingSelfOrders(orders).map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("kode meja & alur bayar dari special_requests", () => {
    expect(selfOrderTableCode(self("x", "pending", ""))).toBe("WIT-OFFICE-BDG");
    expect(selfOrderPaymentFlow(self("x", "pending", "", "static_qris"))).toBe("static_qris");
    expect(isSelfOrder({ special_requests: "GoFood F-1" })).toBe(false);
    expect(selfOrderTableCode({ special_requests: null })).toBeNull();
  });
});

describe("recency & waktu", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  it("pesanan > 12 jam dilipat", () => {
    const { recent, older } = splitByRecency(
      [self("lama", "pending", "2026-09-28T10:00:00Z"), self("baru", "pending", "2026-10-01T11:50:00Z")],
      now
    );
    expect(recent.map((o) => o.id)).toEqual(["baru"]);
    expect(older.map((o) => o.id)).toEqual(["lama"]);
  });
  it("teks waktu manusiawi", () => {
    expect(timeAgoText("2026-10-01T11:59:45Z", now)).toBe("baru saja");
    expect(timeAgoText("2026-10-01T11:48:00Z", now)).toBe("12 mnt lalu");
    expect(timeAgoText("2026-10-01T09:00:00Z", now)).toBe("3 jam lalu");
    expect(timeAgoText("2026-09-28T12:00:00Z", now)).toBe("3 hari lalu");
    expect(timeAgoText(null, now)).toBe("");
  });
});
