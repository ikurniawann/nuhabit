import { describe, expect, it } from "vitest";
import {
  mapFrequentVisitorRow,
  mapTopSpenderRow,
  mapVenueReconciliationRow,
  resolveReportPeriod,
  sumReconciliation,
} from "@/lib/crm/reports";

describe("resolveReportPeriod", () => {
  const now = new Date("2026-07-19T10:30:00.000Z");

  it("default: awal bulan berjalan s/d hari ini (to eksklusif +1 hari)", () => {
    // Arrange + Act
    const period = resolveReportPeriod(null, null, now);

    // Assert
    expect(period).not.toBeNull();
    expect(period!.fromDate).toBe("2026-07-01");
    expect(period!.toDate).toBe("2026-07-19");
    expect(period!.fromIso).toBe("2026-07-01T00:00:00.000Z");
    expect(period!.toIso).toBe("2026-07-20T00:00:00.000Z");
  });

  it("menghormati from/to eksplisit", () => {
    const period = resolveReportPeriod("2026-06-01", "2026-06-30", now);

    expect(period!.fromDate).toBe("2026-06-01");
    expect(period!.toDate).toBe("2026-06-30");
    expect(period!.toIso).toBe("2026-07-01T00:00:00.000Z");
  });

  it("menolak format tanggal tidak valid", () => {
    expect(resolveReportPeriod("2026/06/01", null, now)).toBeNull();
    expect(resolveReportPeriod("abc", null, now)).toBeNull();
    expect(resolveReportPeriod("2026-13-45", null, now)).toBeNull();
  });

  it("menolak from > to", () => {
    expect(resolveReportPeriod("2026-07-10", "2026-07-01", now)).toBeNull();
  });

  it("menolak rentang lebih dari 366 hari", () => {
    expect(resolveReportPeriod("2024-01-01", "2026-07-01", now)).toBeNull();
  });

  it("rentang satu hari valid (from == to)", () => {
    const period = resolveReportPeriod("2026-07-19", "2026-07-19", now);

    expect(period).not.toBeNull();
    expect(period!.fromIso).toBe("2026-07-19T00:00:00.000Z");
    expect(period!.toIso).toBe("2026-07-20T00:00:00.000Z");
  });
});

describe("mapTopSpenderRow", () => {
  it("normalisasi angka string Postgres dan fallback default", () => {
    const row = mapTopSpenderRow({
      id: "c1",
      name: null,
      phone: null,
      membership_tier: null,
      member_type: null,
      order_count: "3",
      total_spend: "150000.00",
      ark_spend: "50000",
      last_order_at: "2026-07-18T12:00:00.000Z",
    });

    expect(row).toEqual({
      id: "c1",
      name: "Customer",
      phone: "",
      membership_tier: "regular",
      member_type: "registered",
      order_count: 3,
      total_spend: 150000,
      ark_spend: 50000,
      last_order_at: "2026-07-18T12:00:00.000Z",
    });
  });
});

describe("mapFrequentVisitorRow", () => {
  it("memetakan hitungan kunjungan periode + lifetime", () => {
    const row = mapFrequentVisitorRow({
      id: "c2",
      name: "Budi",
      phone: "0812",
      membership_tier: "gold",
      member_type: "card",
      order_count: "7",
      visit_days: "5",
      lifetime_visits: "42",
      last_visit_at: null,
    });

    expect(row.visit_days).toBe(5);
    expect(row.order_count).toBe(7);
    expect(row.lifetime_visits).toBe(42);
    expect(row.last_visit_at).toBeNull();
  });
});

describe("mapVenueReconciliationRow", () => {
  it("menghitung net_flow = topup + bonus - spend", () => {
    const row = mapVenueReconciliationRow({
      company_id: "co1",
      branch_id: "br1",
      company_name: "Sulu",
      branch_name: "Sulu Bandung",
      topup_amount: "1000000",
      bonus_amount: "100000",
      spend_amount: "400000",
      other_amount: "0",
      topup_count: "2",
      payment_count: "5",
    });

    expect(row.net_flow).toBe(700000);
    expect(row.topup_amount).toBe(1000000);
    expect(row.spend_amount).toBe(400000);
  });

  it("baris tanpa venue diberi label fallback", () => {
    const row = mapVenueReconciliationRow({
      company_id: null,
      branch_id: null,
      company_name: null,
      branch_name: null,
      topup_amount: 0,
      bonus_amount: 0,
      spend_amount: "25000",
      other_amount: 0,
      topup_count: 0,
      payment_count: 1,
    });

    expect(row.company_id).toBeNull();
    expect(row.company_name).toBe("Tanpa venue");
    expect(row.branch_name).toBe("-");
    expect(row.net_flow).toBe(-25000);
  });
});

describe("mapVenueReconciliationRow — topup FOC", () => {
  it("FOC dipisah dari topup berbayar tapi tetap menambah liabilitas (net)", () => {
    const row = mapVenueReconciliationRow({
      company_id: "co1", branch_id: "br1", company_name: "Sulu", branch_name: "Dago",
      topup_amount: "500000", foc_topup_amount: "150000", bonus_amount: "0",
      spend_amount: "100000", other_amount: "0",
      topup_count: "3", foc_topup_count: "1", payment_count: "2",
    });
    expect(row.topup_amount).toBe(500000);
    expect(row.foc_topup_amount).toBe(150000);
    expect(row.foc_topup_count).toBe(1);
    expect(row.net_flow).toBe(550000);
  });
});

describe("sumReconciliation", () => {
  it("menjumlahkan seluruh venue", () => {
    const totals = sumReconciliation([
      mapVenueReconciliationRow({
        company_id: "a", branch_id: "a1", company_name: "A", branch_name: "A1",
        topup_amount: 1000000, bonus_amount: 100000, spend_amount: 200000,
        other_amount: 0, topup_count: 1, payment_count: 2,
      }),
      mapVenueReconciliationRow({
        company_id: "b", branch_id: "b1", company_name: "B", branch_name: "B1",
        topup_amount: 0, bonus_amount: 0, spend_amount: 500000,
        other_amount: 0, topup_count: 0, payment_count: 4,
      }),
    ]);

    // Venue A surplus 900rb, venue B defisit 500rb → net platform 400rb.
    expect(totals.topup_amount).toBe(1000000);
    expect(totals.bonus_amount).toBe(100000);
    expect(totals.spend_amount).toBe(700000);
    expect(totals.net_flow).toBe(400000);
  });

  it("array kosong menghasilkan nol semua", () => {
    expect(sumReconciliation([])).toEqual({
      topup_amount: 0, bonus_amount: 0,
      foc_topup_amount: 0, spend_amount: 0, net_flow: 0,
    });
  });
});
