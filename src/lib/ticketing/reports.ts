// EPIC-023 Fase E — agregasi Laporan Ticketing (fungsi murni). Semua angka
// uang NET dari ledger ticket_visit_charges: baris void ('koreksi' kredit)
// sudah di-atribusikan ke jenis & konteks baris ASAL oleh query, jadi
// revenue tiket yang di-void tidak menggelembungkan laporan.

import { eachDayIso } from "./calendar";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LedgerRow {
  day: string;
  eff_type: string;
  /** signed: debit +, kredit − (deposit/pembayaran ⇒ negatif) */
  net: string;
  /** signed count */
  qty: string;
}

export interface TicketContextRow {
  variant_id: string | null;
  channel_id: string | null;
  season_kind: string | null;
  bundle_product_id: string | null;
  net: string;
  qty: string;
}

export interface MethodRow {
  charge_type: string;
  method: string;
  total: string;
}

export interface CountRow {
  key: string;
  n: string;
}

export interface HangingRow {
  id: string;
  contact_name: string;
  payment_mode: string;
  opened_at: string;
  outstanding: string;
}

export interface ReportRows {
  ledger: LedgerRow[];
  ticketContexts: TicketContextRow[];
  methods: MethodRow[];
  gateDaily: (CountRow & { day: string })[];
  visitDaily: CountRow[];
  bandsRecap: CountRow[];
  hanging: HangingRow[];
  variantNames: { id: string; variant_name: string; product_name: string }[];
  channelNames: { id: string; name: string }[];
  bundleNames: { id: string; name: string }[];
  bookingDeposit: { n: string; total: string }[];
  bookingForfeited: { n: string; total: string }[];
}

type Agg = { label: string; qty: number; net: number };

function aggInto(map: Map<string, Agg>, key: string, label: string, row: TicketContextRow) {
  const entry = map.get(key) ?? { label, qty: 0, net: 0 };
  entry.qty += Number(row.qty);
  entry.net += Number(row.net);
  map.set(key, entry);
}

const finishAgg = (map: Map<string, Agg>) =>
  [...map.values()].map((a) => ({ ...a, net: round2(a.net) })).sort((a, b) => b.net - a.net);

/** Rincian tiket per produk / kanal / musim / paket. */
function ticketBreakdown(rows: ReportRows) {
  const variantById = new Map(rows.variantNames.map((v) => [v.id, v]));
  const channelById = new Map(rows.channelNames.map((c) => [c.id, c.name]));
  const bundleById = new Map(rows.bundleNames.map((b) => [b.id, b.name]));
  const byProduct = new Map<string, Agg>();
  const byChannel = new Map<string, Agg>();
  const bySeason = new Map<string, Agg>();
  const byBundle = new Map<string, Agg>();
  for (const row of rows.ticketContexts) {
    const variant = row.variant_id ? variantById.get(row.variant_id) : null;
    aggInto(
      byProduct,
      row.variant_id ?? "-",
      variant ? `${variant.product_name} — ${variant.variant_name}` : "(tanpa konteks)",
      row
    );
    aggInto(
      byChannel,
      row.channel_id ?? "-",
      (row.channel_id && channelById.get(row.channel_id)) ?? "(tanpa kanal)",
      row
    );
    aggInto(
      bySeason,
      row.season_kind ?? (row.bundle_product_id ? "paket" : "-"),
      row.season_kind ?? (row.bundle_product_id ? "alokasi paket" : "(tanpa musim)"),
      row
    );
    if (row.bundle_product_id) {
      aggInto(
        byBundle,
        row.bundle_product_id,
        bundleById.get(row.bundle_product_id) ?? "(paket terhapus)",
        row
      );
    }
  }
  return {
    products: finishAgg(byProduct),
    channels: finishAgg(byChannel),
    seasons: finishAgg(bySeason),
    bundles: finishAgg(byBundle),
  };
}

/** Bentuk respons laporan dari baris query untuk rentang [from..to]. */
export function buildTicketingReport(from: string, to: string, rows: ReportRows) {
  // ── Ringkasan + deret harian dari ledger net ────────────────────
  const netByType = new Map<string, number>();
  const dailyMap = new Map<string, { tiket_net: number; fnb_net: number; uang_masuk: number }>();
  for (const row of rows.ledger) {
    const net = Number(row.net);
    netByType.set(row.eff_type, (netByType.get(row.eff_type) ?? 0) + net);
    const entry = dailyMap.get(row.day) ?? { tiket_net: 0, fnb_net: 0, uang_masuk: 0 };
    dailyMap.set(row.day, entry);
    if (row.eff_type === "tiket") entry.tiket_net += net;
    if (row.eff_type === "fnb") entry.fnb_net += net;
    // kredit tersimpan negatif → uang masuk = −net
    if (row.eff_type === "deposit" || row.eff_type === "pembayaran") entry.uang_masuk += -net;
  }

  const gateByDay = new Map<string, Record<string, number>>();
  let masuk = 0;
  let masukLagi = 0;
  let masukKaryawan = 0;
  let ditolak = 0;
  for (const row of rows.gateDaily) {
    const n = Number(row.n);
    const perDay = gateByDay.get(row.day) ?? {};
    perDay[row.key] = n;
    gateByDay.set(row.day, perDay);
    if (row.key === "masuk") masuk += n;
    else if (row.key === "masuk-lagi") masukLagi += n;
    else if (row.key === "masuk-karyawan") masukKaryawan += n;
    else ditolak += n;
  }
  const visitsByDay = new Map(rows.visitDaily.map((r) => [r.key, Number(r.n)]));

  const daily = eachDayIso(from, to).map((d) => {
    const money = dailyMap.get(d);
    const gate = gateByDay.get(d) ?? {};
    return {
      date: d,
      visits: visitsByDay.get(d) ?? 0,
      masuk: gate["masuk"] ?? 0,
      masuk_lagi: gate["masuk-lagi"] ?? 0,
      tiket_net: round2(money?.tiket_net ?? 0),
      fnb_net: round2(money?.fnb_net ?? 0),
      uang_masuk: round2(money?.uang_masuk ?? 0),
    };
  });

  const uangMasuk = -(netByType.get("deposit") ?? 0) - (netByType.get("pembayaran") ?? 0);
  const deposit = rows.bookingDeposit[0];
  const forfeited = rows.bookingForfeited[0];

  return {
    range: { from, to },
    summary: {
      visits_opened: rows.visitDaily.reduce((s, r) => s + Number(r.n), 0),
      orang_masuk: masuk,
      masuk_lagi: masukLagi,
      masuk_karyawan: masukKaryawan,
      tap_ditolak: ditolak,
      tiket_net: round2(netByType.get("tiket") ?? 0),
      fnb_net: round2(netByType.get("fnb") ?? 0),
      denda_net: round2(netByType.get("denda") ?? 0),
      uang_masuk: round2(uangMasuk),
      refund_keluar: round2(netByType.get("refund-deposit") ?? 0),
      // EPIC-032 B3 — potongan promo terpakai saat redeem (kredit
      // non-uang; net-void aware karena lewat jalur eff_type yang sama)
      diskon_promo: round2(-(netByType.get("diskon") ?? 0)),
    },
    methods: rows.methods.map((m) => ({
      charge_type: m.charge_type,
      method: m.method,
      total: Number(m.total),
    })),
    daily,
    tickets: ticketBreakdown(rows),
    // Pengakuan revenue booking (keputusan owner 2026-07-23): terbayar
    // belum redeem = titipan (bukan revenue); hangus = revenue hangus di
    // tanggal forfeited_at
    booking: {
      titipan_count: Number(deposit?.n ?? 0),
      titipan_total: round2(Number(deposit?.total ?? 0)),
      hangus_count: Number(forfeited?.n ?? 0),
      hangus_total: round2(Number(forfeited?.total ?? 0)),
    },
    bands: rows.bandsRecap.map((b) => ({ status: b.key, n: Number(b.n) })),
    hanging: {
      count: rows.hanging.length,
      total: round2(rows.hanging.reduce((s, h) => s + Number(h.outstanding), 0)),
      items: rows.hanging.map((h) => ({
        id: h.id,
        contact_name: h.contact_name,
        payment_mode: h.payment_mode,
        opened_at: h.opened_at,
        outstanding: Number(h.outstanding),
      })),
    },
  };
}
