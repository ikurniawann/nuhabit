import { describe, expect, test } from "vitest";
import { buildTicketingReport, type ReportRows } from "./reports";

const empty: ReportRows = {
  ledger: [],
  ticketContexts: [],
  methods: [],
  gateDaily: [],
  visitDaily: [],
  bandsRecap: [],
  hanging: [],
  variantNames: [],
  channelNames: [],
  bundleNames: [],
  bookingDeposit: [],
  bookingForfeited: [],
};

describe("buildTicketingReport", () => {
  test("rentang kosong tetap punya deret harian berisi nol", () => {
    const report = buildTicketingReport("2026-10-01", "2026-10-03", empty);
    expect(report.daily.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(report.summary.tiket_net).toBe(0);
    expect(report.booking).toEqual({
      titipan_count: 0,
      titipan_total: 0,
      hangus_count: 0,
      hangus_total: 0,
    });
    expect(report.hanging).toEqual({ count: 0, total: 0, items: [] });
  });

  test("ledger net: kredit negatif jadi uang masuk, diskon jadi positif", () => {
    const report = buildTicketingReport("2026-10-01", "2026-10-01", {
      ...empty,
      ledger: [
        { day: "2026-10-01", eff_type: "tiket", net: "50000.004", qty: "2" },
        { day: "2026-10-01", eff_type: "fnb", net: "20000", qty: "1" },
        { day: "2026-10-01", eff_type: "pembayaran", net: "-60000", qty: "-1" },
        { day: "2026-10-01", eff_type: "deposit", net: "-10000", qty: "-1" },
        { day: "2026-10-01", eff_type: "diskon", net: "-5000", qty: "-1" },
        { day: "2026-10-01", eff_type: "refund-deposit", net: "2500", qty: "1" },
      ],
      visitDaily: [{ key: "2026-10-01", n: "4" }],
    });
    expect(report.summary).toMatchObject({
      visits_opened: 4,
      tiket_net: 50000,
      fnb_net: 20000,
      uang_masuk: 70000,
      refund_keluar: 2500,
      diskon_promo: 5000,
    });
    expect(report.daily[0]).toEqual({
      date: "2026-10-01",
      visits: 4,
      masuk: 0,
      masuk_lagi: 0,
      tiket_net: 50000,
      fnb_net: 20000,
      uang_masuk: 70000,
    });
  });

  test("traffic gate: masuk / masuk lagi / karyawan / sisanya ditolak", () => {
    const report = buildTicketingReport("2026-10-01", "2026-10-01", {
      ...empty,
      gateDaily: [
        { day: "2026-10-01", key: "masuk", n: "10" },
        { day: "2026-10-01", key: "masuk-lagi", n: "3" },
        { day: "2026-10-01", key: "masuk-karyawan", n: "2" },
        { day: "2026-10-01", key: "ditolak-plafon", n: "1" },
        { day: "2026-10-01", key: "ditolak-sudah-masuk", n: "4" },
      ],
    });
    expect(report.summary).toMatchObject({
      orang_masuk: 10,
      masuk_lagi: 3,
      masuk_karyawan: 2,
      tap_ditolak: 5,
    });
    expect(report.daily[0]).toMatchObject({ masuk: 10, masuk_lagi: 3 });
  });

  test("rincian tiket per produk/kanal/musim/paket, urut net terbesar", () => {
    const report = buildTicketingReport("2026-10-01", "2026-10-01", {
      ...empty,
      ticketContexts: [
        { variant_id: "v1", channel_id: "c1", season_kind: "high", bundle_product_id: null, net: "30000", qty: "2" },
        { variant_id: "v2", channel_id: null, season_kind: null, bundle_product_id: "b1", net: "45000", qty: "3" },
        { variant_id: null, channel_id: null, season_kind: null, bundle_product_id: null, net: "1000", qty: "1" },
      ],
      variantNames: [
        { id: "v1", variant_name: "Adult", product_name: "Kolam" },
        { id: "v2", variant_name: "Child", product_name: "Kolam" },
      ],
      channelNames: [{ id: "c1", name: "Walk-in" }],
      bundleNames: [],
    });
    expect(report.tickets.products.map((p) => p.label)).toEqual([
      "Kolam — Child",
      "Kolam — Adult",
      "(tanpa konteks)",
    ]);
    expect(report.tickets.channels).toEqual([
      { label: "(tanpa kanal)", qty: 4, net: 46000 },
      { label: "Walk-in", qty: 2, net: 30000 },
    ]);
    expect(report.tickets.seasons.map((s) => s.label)).toEqual([
      "alokasi paket",
      "high",
      "(tanpa musim)",
    ]);
    expect(report.tickets.bundles).toEqual([{ label: "(paket terhapus)", qty: 3, net: 45000 }]);
  });

  test("titipan & hangus booking, tab menggantung", () => {
    const report = buildTicketingReport("2026-10-01", "2026-10-01", {
      ...empty,
      bookingDeposit: [{ n: "2", total: "150000" }],
      bookingForfeited: [{ n: "1", total: "75000.005" }],
      hanging: [
        { id: "h1", contact_name: "Budi", payment_mode: "postpaid", opened_at: "x", outstanding: "12000.5" },
        { id: "h2", contact_name: "Ani", payment_mode: "postpaid", opened_at: "y", outstanding: "8000" },
      ],
      bandsRecap: [{ key: "tersedia", n: "40" }],
    });
    expect(report.booking).toEqual({
      titipan_count: 2,
      titipan_total: 150000,
      hangus_count: 1,
      hangus_total: 75000.01,
    });
    expect(report.hanging.count).toBe(2);
    expect(report.hanging.total).toBe(20000.5);
    expect(report.bands).toEqual([{ status: "tersedia", n: 40 }]);
  });
});
