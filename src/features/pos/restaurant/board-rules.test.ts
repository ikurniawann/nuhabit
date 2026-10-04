import { describe, expect, it } from "vitest";
import type { Order } from "@/lib/pos-api";
import type { ReservationRow } from "@/features/pos/reservation/types";
import { boardBanner, countTableStatuses, orderMoveLines, waitingListFrom } from "./board-rules";

describe("restaurant board rules", () => {
  it("baris pindah: hanya item ber-id; harga satuan dari total bila unit kosong", () => {
    const order = {
      id: "o1",
      items: [
        { id: "i1", product_name: "Kopi", quantity: 2, total_amount: 30000 },
        { product_name: "Draft", quantity: 1, unit_price: 5000 },
        { id: "i3", quantity: 1, unit_price: 12000 },
      ],
    } as Order;
    expect(orderMoveLines(order)).toEqual([
      { id: "i1", name: "Kopi", quantity: 2, unitPrice: 15000 },
      { id: "i3", name: "Item 2", quantity: 1, unitPrice: 12000 },
    ]);
    expect(orderMoveLines(null)).toEqual([]);
  });

  it("hitungan meja: billing ikut terisi", () => {
    expect(countTableStatuses([{ status: "available" }, { status: "billing" }, { status: "occupied" }, { status: "reserved" }])).toEqual({
      availableCount: 1,
      occupiedCount: 2,
    });
  });

  it("daftar tunggu: pending/confirmed urut jam", () => {
    const row = (id: string, status: string, time_slot: string) => ({ id, status, time_slot }) as ReservationRow;
    expect(waitingListFrom([row("a", "seated", "10:00"), row("b", "confirmed", "13:00"), row("c", "PENDING", "11:00")]).map((r) => r.id)).toEqual([
      "c",
      "b",
    ]);
  });

  it("banner mode papan", () => {
    expect(boardBanner({ mode: "transfer", transferQty: 3, busy: false, sourceLabel: "A1" })).toEqual({
      title: "Move 3 items — tap a table",
      subtitle: "From A1",
    });
    expect(boardBanner({ mode: "merge", orderNumber: "ORD-9", transferQty: 0, busy: true, sourceLabel: null }).subtitle).toBe("Merging…");
  });
});
