import { describe, expect, it } from "vitest";
import { humanizeLedgerDescription, ledgerOrderIds } from "./ledger-description";

const ORDER_ID = "0b6f2c1e-5d4a-4c3b-9a8e-7f6d5c4b3a21";

describe("humanizeLedgerDescription", () => {
  it("deskripsi tanpa UUID dibiarkan", () => {
    const row = { description: "XP transaksi POS — order #A-1", reference_table: "pos_orders", reference_id: ORDER_ID, metadata: null };
    expect(humanizeLedgerDescription(row, new Map())).toBe("XP transaksi POS — order #A-1");
  });

  it("baris order memakai nomor order, fallback potongan UUID", () => {
    const row = { description: `XP transaksi POS untuk order ${ORDER_ID}`, reference_table: "pos_orders", reference_id: ORDER_ID, metadata: null };
    expect(humanizeLedgerDescription(row, new Map([[ORDER_ID, "A-77"]]))).toBe("XP transaksi POS — order #A-77");
    expect(humanizeLedgerDescription(row, new Map())).toBe("XP transaksi POS — order 0b6f2c1e");
  });

  it("baris non-order dengan nominal memakai rupiah PUEBI", () => {
    const row = { description: `XP topup ARK untuk ${ORDER_ID}`, reference_table: "pos_wallet_transactions", reference_id: "tx", metadata: { amount: "50000" } };
    expect(humanizeLedgerDescription(row, new Map())).toBe("XP topup ARK — Rp50.000");
  });

  it("tanpa nominal: UUID dipotong 8 karakter", () => {
    const row = { description: `Bonus ${ORDER_ID}`, reference_table: null, reference_id: null, metadata: null };
    expect(humanizeLedgerDescription(row, new Map())).toBe("Bonus 0b6f2c1e");
  });
});

describe("ledgerOrderIds", () => {
  it("unik dan hanya baris order", () => {
    const rows = [
      { description: null, reference_table: "pos_orders", reference_id: "a", metadata: null },
      { description: null, reference_table: "pos_orders", reference_id: "a", metadata: null },
      { description: null, reference_table: "pos_wallet_transactions", reference_id: "b", metadata: null },
    ];
    expect(ledgerOrderIds(rows)).toEqual(["a"]);
  });
});
