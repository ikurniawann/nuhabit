import { describe, expect, it } from "vitest";
import { pickPaidXenditPayment } from "./topup-qris-reconcile";

describe("pickPaidXenditPayment", () => {
  it("memilih pembayaran berstatus SUCCEEDED/COMPLETED/PAID", () => {
    expect(
      pickPaidXenditPayment([
        { id: "p-1", status: "FAILED", amount: 50000 },
        { id: "p-2", status: "SUCCEEDED", amount: 50000 },
      ])
    ).toEqual({ id: "p-2", amount: 50000 });
    expect(pickPaidXenditPayment([{ id: "p-3", status: "completed", amount: "20000" }])).toEqual({
      id: "p-3",
      amount: 20000,
    });
  });

  it("null bila belum ada pembayaran berhasil atau daftar kosong", () => {
    expect(pickPaidXenditPayment([])).toBeNull();
    expect(pickPaidXenditPayment([{ id: "p", status: "PENDING" }])).toBeNull();
    expect(pickPaidXenditPayment([{ status: "EXPIRED" }])).toBeNull();
  });

  it("menerima payment_id sebagai pengganti id", () => {
    expect(pickPaidXenditPayment([{ payment_id: "pay-9", status: "PAID", amount: 1000 }])).toEqual({
      id: "pay-9",
      amount: 1000,
    });
  });
});
