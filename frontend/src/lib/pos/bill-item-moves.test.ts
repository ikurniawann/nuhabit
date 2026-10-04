import { describe, expect, it } from "vitest";
import { billBlocksItemMoves } from "./bill-item-moves";

describe("billBlocksItemMoves", () => {
  it("bill lunas / parsial / refund terkunci", () => {
    expect(billBlocksItemMoves({ payment_status: "paid", amount_paid: 92500 })).toContain(
      "dibayar"
    );
    expect(billBlocksItemMoves({ payment_status: "partial", amount_paid: 10000 })).toContain(
      "sebagian"
    );
    expect(billBlocksItemMoves({ payment_status: "refunded", amount_paid: 0 })).toContain(
      "refund"
    );
  });

  it("amount_paid > 0 mengunci meski status belum rapi", () => {
    expect(billBlocksItemMoves({ payment_status: "unpaid", amount_paid: 5000 })).toBe(
      "sudah menerima pembayaran"
    );
    expect(billBlocksItemMoves({ payment_status: "unpaid", amount_paid: "5000.00" })).toBe(
      "sudah menerima pembayaran"
    );
  });

  it("open bill belum bayar bebas dipindah/digabung", () => {
    expect(billBlocksItemMoves({ payment_status: "unpaid", amount_paid: 0 })).toBeNull();
    expect(billBlocksItemMoves({ payment_status: null, amount_paid: null })).toBeNull();
    expect(billBlocksItemMoves({})).toBeNull();
  });
});
