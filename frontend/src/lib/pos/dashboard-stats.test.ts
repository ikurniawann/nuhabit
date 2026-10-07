import { describe, expect, it } from "vitest";
import {
  buildTrend,
  customRange,
  isRevenueOrder,
  periodRange,
  previousRange,
  summarizeSales,
  topProducts,
  type DashboardOrderRow,
} from "./dashboard-stats";

// Senin 5 Okt 2026 01:30 WIB = Minggu 4 Okt 18:30 UTC — tanggal UTC & WIB beda.
const now = new Date("2026-10-04T18:30:00Z");
const order = (over: Partial<DashboardOrderRow>): DashboardOrderRow => ({
  id: "o",
  ordered_at: "2026-10-04T18:00:00Z",
  payment_status: "paid",
  status: "pending",
  ...over,
});

describe("dashboard periods (WIB)", () => {
  it("hari ini/minggu/bulan dimulai tengah malam WIB", () => {
    expect(periodRange("today", now).startDate.toISOString()).toBe("2026-10-04T17:00:00.000Z");
    expect(periodRange("week", now).startDate.toISOString()).toBe("2026-10-04T17:00:00.000Z");
    expect(periodRange("month", now).startDate.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    const wednesday = new Date("2026-10-07T05:00:00Z");
    expect(periodRange("week", wednesday).startDate.toISOString()).toBe("2026-10-04T17:00:00.000Z");
  });

  it("custom: inklusif, tolak terbalik/format salah/>366 hari", () => {
    expect(customRange("2026-10-01", "2026-10-02")?.endDate.toISOString()).toBe("2026-10-02T16:59:59.999Z");
    expect(customRange("2026-10-02", "2026-10-01")).toBeNull();
    expect(customRange("2026-1-1", "2026-10-01")).toBeNull();
    expect(customRange("2025-01-01", "2026-10-01")).toBeNull();
  });

  it("periode pembanding berdurasi sama tepat sebelumnya", () => {
    const { prevStart, prevEnd } = previousRange(new Date(1000), new Date(5000));
    expect([prevStart.getTime(), prevEnd.getTime()]).toEqual([-3000, 999]);
  });
});

describe("summarizeSales & topProducts", () => {
  it("revenue hanya order lunas non-void; perubahan dibulatkan 1 desimal", () => {
    const orders = [
      order({ id: "a", total_amount: 30000, cashier_id: "k1" }),
      order({ id: "b", total_amount: "20000", cashier_id: "k2" }),
      order({ id: "c", total_amount: 99999, status: "voided", cashier_id: "k1" }),
      order({ id: "d", total_amount: 5000, payment_status: "unpaid", cashier_id: "k3" }),
    ];
    expect(orders.filter(isRevenueOrder).map((o) => o.id)).toEqual(["a", "b"]);
    expect(summarizeSales(orders, { revenue: 30000, orders: 3 })).toEqual({
      todayRevenue: 50000,
      todayOrders: 2,
      averageOrderValue: 25000,
      activeCashiers: 3,
      revenueChange: 66.7,
      ordersChange: -33.3,
    });
  });

  it("produk terlaris dari item order lunas saja", () => {
    const items = [
      { order_id: "a", product_id: "kopi", product_name: "Kopi", quantity: 2, total_amount: 40000 },
      { order_id: "b", product_id: "kopi", product_name: "Kopi", quantity: "1", total_amount: 20000 },
      { order_id: "x", product_id: "teh", product_name: "Teh", quantity: 9, total_amount: 9000 },
    ];
    expect(topProducts(items, new Set(["a", "b"]))).toEqual([{ id: "kopi", name: "Kopi", sold: 3, revenue: 60000 }]);
  });
});

describe("buildTrend", () => {
  it("per jam WIB sampai jam sekarang", () => {
    const trend = buildTrend({
      period: "today",
      startDate: periodRange("today", now).startDate,
      endDate: now,
      paidOrders: [order({ total_amount: 15000, ordered_at: "2026-10-04T18:10:00Z", ark_coins_used: 5000 })],
      xpRows: [{ xp_earned: 3, created_at: "2026-10-04T17:20:00Z" }],
      now,
    });
    expect(trend.map((p) => p.label)).toEqual(["00:00", "01:00"]);
    expect(trend[0]).toMatchObject({ xpEarned: 3, revenue: 0 });
    expect(trend[1]).toMatchObject({ revenue: 15000, orders: 1, arkUsed: 5000 });
  });

  it("per hari WIB, hari kosong tetap muncul", () => {
    const range = customRange("2026-10-01", "2026-10-03")!;
    const trend = buildTrend({
      period: "custom",
      ...range,
      paidOrders: [order({ total_amount: 1000, ordered_at: "2026-10-02T20:00:00Z" })],
      xpRows: [],
    });
    expect(trend.map((p) => p.revenue)).toEqual([0, 0, 1000]);
    expect(trend).toHaveLength(3);
  });
});
