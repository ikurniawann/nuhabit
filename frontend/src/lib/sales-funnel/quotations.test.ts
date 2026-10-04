import { describe, expect, it, test } from "vitest";
import {
  allocateTermAmounts,
  buildQuotationWaMessage,
  quotationPayloadSchema,
  termProgress,
} from "./quotations";

const basePayload = {
  use_ppn: false,
  ppn_persen: 0,
  items: [{ item_type: "bebas", description: "Sewa venue", qty: 1, unit_price: 10_000_000 }],
};

describe("skema termin (Fase G)", () => {
  test("tanpa termin sah (default [])", () => {
    const parsed = quotationPayloadSchema.safeParse(basePayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.terms).toEqual([]);
  });

  test("Σ persen 100 sah — termasuk pecahan 33.33+33.33+33.34", () => {
    const parsed = quotationPayloadSchema.safeParse({
      ...basePayload,
      terms: [
        { label: "DP", percent: 33.33 },
        { label: "Termin 2", percent: 33.33 },
        { label: "Pelunasan", percent: 33.34 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  test("Σ persen ≠ 100 ditolak", () => {
    const parsed = quotationPayloadSchema.safeParse({
      ...basePayload,
      terms: [
        { label: "DP", percent: 50 },
        { label: "Pelunasan", percent: 40 },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("allocateTermAmounts (pembulatan kumulatif)", () => {
  test("Σ nominal selalu persis = total, termasuk pecahan tak habis", () => {
    const amounts = allocateTermAmounts(10_000_000, [33.33, 33.33, 33.34]);
    expect(amounts.reduce((s, a) => s + a, 0)).toBe(10_000_000);
    expect(amounts[0]).toBe(3_333_000);
    expect(amounts[1]).toBe(3_333_000);
    expect(amounts[2]).toBe(3_334_000);
  });

  test("total ber-sen tidak menyisakan selisih", () => {
    const amounts = allocateTermAmounts(1000.01, [50, 50]);
    expect(Math.round(amounts.reduce((s, a) => s + a, 0) * 100) / 100).toBe(1000.01);
  });

  test("tanpa termin → kosong", () => {
    expect(allocateTermAmounts(5000, [])).toEqual([]);
  });
});

describe("termProgress (waterfall pembayaran → status per termin)", () => {
  const terms = [
    { label: "DP", due_date: null, percent: 50 },
    { label: "Pelunasan", due_date: "2026-08-01", percent: 50 },
  ];

  test("belum ada pembayaran → semua belum", () => {
    const progress = termProgress(terms, 10_000_000, 0);
    expect(progress.map((p) => p.status)).toEqual(["belum", "belum"]);
    expect(progress[0].amount).toBe(5_000_000);
  });

  test("bayar pas DP → DP lunas, pelunasan belum", () => {
    const progress = termProgress(terms, 10_000_000, 5_000_000);
    expect(progress[0].status).toBe("lunas");
    expect(progress[1].status).toBe("belum");
  });

  test("bayar melewati DP → sisa mengalir ke termin berikut (sebagian)", () => {
    const progress = termProgress(terms, 10_000_000, 7_000_000);
    expect(progress[0]).toMatchObject({ status: "lunas", paid: 5_000_000 });
    expect(progress[1]).toMatchObject({ status: "sebagian", paid: 2_000_000 });
  });

  test("lunas total → semua lunas; kelebihan bayar tidak meledak", () => {
    const progress = termProgress(terms, 10_000_000, 12_000_000);
    expect(progress.map((p) => p.status)).toEqual(["lunas", "lunas"]);
    expect(progress[1].paid).toBe(5_000_000);
  });
});

describe("buildQuotationWaMessage", () => {
  it("ringkasan item, PPN, total, dan baris opsional", () => {
    const message = buildQuotationWaMessage(
      {
        quote_number: "QT-2610-0001",
        branch_name: "Lembang",
        pic_name: "Budi",
        deal_title: "Gathering Akhir Tahun",
        org_name: "PT Maju",
        use_ppn: true,
        ppn_persen: "11",
        subtotal: "1000000",
        ppn_nominal: "110000",
        total: "1110000",
        event_date: "2026-11-07",
        valid_until: null,
        notes: null,
      },
      [{ description: "Paket Makan", item_type: "produk", qty: "50", unit_price: "20000", line_total: "1000000" }]
    );
    expect(message.split("\n")).toEqual([
      "*PENAWARAN QT-2610-0001*",
      "_Lembang_",
      "",
      "Halo Budi, berikut ringkasan penawaran untuk *Gathering Akhir Tahun* (PT Maju):",
      "",
      "• Paket Makan — 50 pax @ Rp20.000 = *Rp1.000.000*",
      "",
      "Subtotal: Rp1.000.000",
      "PPN 11%: Rp110.000",
      "*TOTAL: Rp1.110.000*",
      "",
      "Tanggal acara: Sabtu, 7 November 2026",
      "",
      "Bila sudah sesuai, mohon konfirmasinya ya 🙏",
    ]);
  });
});
