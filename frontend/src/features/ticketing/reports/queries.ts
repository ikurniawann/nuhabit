"use client";

import { useQuery } from "@tanstack/react-query";

// Fase E — tipe & query laporan ticketing (bentuk = response
// /api/ticketing/reports).

export interface ReportAggRow {
  label: string;
  qty: number;
  net: number;
}

export interface TicketingReport {
  range: { from: string; to: string };
  summary: {
    visits_opened: number;
    orang_masuk: number;
    masuk_lagi: number;
    masuk_karyawan: number;
    tap_ditolak: number;
    tiket_net: number;
    fnb_net: number;
    denda_net: number;
    uang_masuk: number;
    refund_keluar: number;
    /** EPIC-032 B3 — potongan promo terpakai (redeem) dalam rentang. */
    diskon_promo: number;
  };
  methods: { charge_type: string; method: string; total: number }[];
  daily: {
    date: string;
    visits: number;
    masuk: number;
    masuk_lagi: number;
    tiket_net: number;
    fnb_net: number;
    uang_masuk: number;
  }[];
  tickets: {
    products: ReportAggRow[];
    channels: ReportAggRow[];
    seasons: ReportAggRow[];
    bundles: ReportAggRow[];
  };
  /** Pengakuan revenue booking: titipan (kini) & hangus (dalam rentang). */
  booking: {
    titipan_count: number;
    titipan_total: number;
    hangus_count: number;
    hangus_total: number;
  };
  bands: { status: string; n: number }[];
  hanging: {
    count: number;
    total: number;
    items: {
      id: string;
      contact_name: string;
      payment_mode: string;
      opened_at: string;
      outstanding: number;
    }[];
  };
}

async function fetchReport(from: string, to: string): Promise<TicketingReport> {
  const res = await fetch(
    `/api/ticketing/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
  const body = (await res.json()) as {
    success?: boolean;
    data?: TicketingReport;
    error?: string;
  };
  if (!res.ok || !body.success || !body.data) {
    throw new Error(body.error ?? "Gagal memuat laporan");
  }
  return body.data;
}

export const useTicketingReport = (from: string, to: string) =>
  useQuery({
    queryKey: ["ticketing", "reports", from, to] as const,
    queryFn: () => fetchReport(from, to),
    enabled: !!from && !!to && from <= to,
  });

// EPIC-031 Fase C2 — okupansi kuota harian (endpoint /api/ticketing/occupancy)
export interface ReportOccupancyDay {
  date: string;
  online: number;
  walk_in: number;
  capacity: number | null;
}

async function fetchOccupancy(
  from: string,
  to: string
): Promise<ReportOccupancyDay[]> {
  const res = await fetch(
    `/api/ticketing/occupancy?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
  const body = (await res.json()) as {
    success?: boolean;
    data?: { days: ReportOccupancyDay[] };
    error?: string;
  };
  if (!res.ok || !body.success || !body.data) {
    throw new Error(body.error ?? "Gagal memuat okupansi");
  }
  return body.data.days;
}

export const useReportOccupancy = (from: string, to: string) =>
  useQuery({
    queryKey: ["ticketing", "occupancy", from, to] as const,
    queryFn: () => fetchOccupancy(from, to),
    enabled: !!from && !!to && from <= to,
  });
