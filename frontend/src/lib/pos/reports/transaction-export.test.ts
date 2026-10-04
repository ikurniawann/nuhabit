import { describe, expect, it } from "vitest";
import type { TransactionReport } from "@/lib/pos/reports/types";
import {
  buildTransactionExportSheets,
  transactionExportFileName,
} from "@/lib/pos/reports/transaction-export";

const sample: TransactionReport = {
  filters: {
    date_from: "2026-08-01",
    date_to: "2026-08-29",
    warehouse_id: null,
  },
  stall_options: [],
  stall_locked: false,
  summary: {
    transactions: 1,
    total_sales: 27000,
    total_ark_used: 0,
    revenue: 30000,
    discount: 3000,
    tax: 0,
    service: 0,
    nett: 27000,
  },
  per_stall: [
    {
      stall_code: "FNB",
      stall_name: "F&B",
      transactions: 1,
      quantity: 2,
      sales: 30000,
    },
  ],
  top_products: [{ product_name: "Es Teh", quantity: 2, revenue: 30000 }],
  daily: [{ date: "2026-08-29", nett: 27000, transactions: 1 }],
  rows: [
    {
      id: "ord-1",
      order_number: "POS-20260829-0001",
      ordered_at: "2026-08-29T10:00:00.000Z",
      status: "completed",
      payment_status: "paid",
      payment_method: "qris",
      payment_method_code: "qris",
      payment_method_name: "QRIS",
      subtotal: 30000,
      discount_amount: 3000,
      tax_amount: 0,
      service_charge_amount: 0,
      total_amount: 27000,
      ark_coins_used: 0,
      cashier_id: null,
      warehouse_id: "w1",
      stall_code: "FNB",
      stall_name: "F&B",
      checkout_id: null,
      checkout_number: null,
      sold_from: "stall",
      xendit_qr_id: null,
      xendit_external_id: null,
      comp_type: null,
      comp_approved_name: null,
    },
  ],
};

describe("transactionExportFileName", () => {
  it("bertanggal agar unduhan tidak saling menimpa", () => {
    expect(transactionExportFileName(sample.filters)).toBe(
      "transaksi-pos-2026-08-01_2026-08-29.xlsx"
    );
  });
});

describe("buildTransactionExportSheets", () => {
  it("menyusun ringkasan, stall, produk, harian, dan detail", () => {
    const sheets = buildTransactionExportSheets(sample);
    expect(sheets.map((s) => s.name)).toEqual([
      "Ringkasan",
      "Per Stall",
      "Top Produk",
      "Harian",
      "Transaksi",
    ]);
    const detail = sheets.find((s) => s.name === "Transaksi")!;
    expect(detail.rows[0]?.[0]).toBe("Order");
    expect(detail.rows[1]?.[0]).toBe("POS-20260829-0001");
    expect(detail.rows[1]?.[4]).toBe("QRIS");
    expect(detail.rows[1]?.[8]).toBe(27000);
  });
});
