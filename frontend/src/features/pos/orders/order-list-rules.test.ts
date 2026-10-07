import { describe, expect, it } from "vitest";
import {
  cashierHandoffUrl,
  countByStatus,
  filterOrders,
  isPaid,
  isUnpaid,
  paginate,
  periodRange,
  shiftIsoDate,
  toOrderListParams,
} from "./order-list-rules";
import type { Order } from "./types";

const order = (over: Partial<Order>): Order => ({ id: "o", ...over });

describe("order list rules", () => {
  it("status bayar: void bukan lunas maupun belum bayar", () => {
    expect(isPaid(order({ payment_status: "paid", status: "pending" }))).toBe(true);
    expect(isPaid(order({ payment_status: "paid", status: "voided" }))).toBe(false);
    expect(isUnpaid(order({ payment_status: "unpaid", status: "pending" }))).toBe(true);
    expect(isUnpaid(order({ payment_status: "unpaid", status: "merged" }))).toBe(false);
  });

  it("hitung per status dan filter kata kunci + status", () => {
    const orders = [
      order({ id: "a", order_number: "ORD-1", payment_status: "paid", status: "preparing" }),
      order({ id: "b", order_number: "ORD-2", status: "voided" }),
      order({ id: "c", order_number: "ORD-3", status: "pending", customer: { name: "Sari" } as Order["customer"] }),
    ];
    expect(countByStatus(orders)).toEqual({ all: 3, paid: 1, unpaid: 1, kitchen_open: 2, voided: 1 });
    expect(filterOrders(orders, "sari", "all").map((o) => o.id)).toEqual(["c"]);
    expect(filterOrders(orders, "", "kitchen_open").map((o) => o.id)).toEqual(["a", "c"]);
  });

  it("periode WIB dan geser tanggal", () => {
    const now = new Date("2026-10-04T20:00:00Z"); // 5 Okt WIB
    expect(periodRange("today", now)).toEqual({ date_from: "2026-10-05", date_to: "2026-10-05" });
    expect(periodRange("7d", now).date_from).toBe("2026-09-29");
    expect(periodRange("month", now).date_from).toBe("2026-10-01");
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("filter → params, tolak rentang terbalik", () => {
    const draft = { date_from: "2026-10-01", date_to: "2026-10-04", payment_status: "", order_type: "dine_in", payment_method: "" };
    expect(toOrderListParams(draft)).toEqual({
      ok: true,
      params: { date_from: "2026-10-01", date_to: "2026-10-04", payment_status: undefined, order_type: "dine_in", payment_method: undefined, limit: 10_000 },
    });
    expect(toOrderListParams({ ...draft, date_from: "2026-10-05" }).ok).toBe(false);
  });

  it("paginasi menjepit halaman", () => {
    const rows = Array.from({ length: 30 }, (_, i) => i);
    expect(paginate(rows, 5, 25)).toMatchObject({ pageCount: 2, currentPage: 2, firstIndex: 26, lastIndex: 30 });
    expect(paginate([], 1, 25)).toMatchObject({ pageCount: 1, currentPage: 1, rows: [] });
  });
});

describe("cashierHandoffUrl", () => {
  it("menambah checkoutId atau orderId ke rute kasir", () => {
    expect(cashierHandoffUrl("/dashboard/pos/cashier-fullscreen?tablet=1", { checkoutId: "c1" })).toBe(
      "/dashboard/pos/cashier-fullscreen?tablet=1&checkoutId=c1"
    );
    expect(cashierHandoffUrl("/dashboard/pos", { orderId: "o1" })).toBe("/dashboard/pos?orderId=o1");
  });
});
