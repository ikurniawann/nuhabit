"use client";

import { useState } from "react";
import { BedDouble, Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDate, formatRupiah } from "@/lib/format";
import { REPORT_PERIOD_LABELS, REPORT_PERIOD_SHORTCUTS, resolveReportPeriod } from "@/lib/pos/report-period";
import {
  RESERVATION_SOURCE_LABELS, RESERVATION_STATUSES, RESERVATION_STATUS_LABELS, type ReservationStatus,
} from "@/lib/resort/reservation";
import type { ReservationListRow } from "@/lib/resort/types";
import { cn } from "@/lib/utils";
import { CreateReservationDialog } from "@/features/resort/components/create-reservation-dialog";
import { ReservationDetailDialog } from "@/features/resort/components/reservation-detail-dialog";
import { useReservations } from "@/features/resort/queries";
import { STATUS_CLASS } from "@/features/resort/types";

function summarize(rows: readonly ReservationListRow[]) {
  return {
    total: rows.length,
    nights: rows.reduce((s, r) => s + r.nights, 0),
    revenue: rows.filter((r) => r.status !== "dibatalkan").reduce((s, r) => s + r.total, 0),
    balance: rows.reduce((s, r) => s + Math.max(0, r.balance), 0),
  };
}

/**
 * Resort → Reservasi (owner 2026-09-06): daftar reservasi + pembuatan
 * reservasi baru dengan cek ketersediaan dan penawaran harga per malam
 * (weekday/weekend/musim) sebelum disimpan.
 */
export function ResortReservationsPage() {
  const [status, setStatus] = useState<ReservationStatus | "all">("all");
  const [range, setRange] = useState(() => resolveReportPeriod("month"));
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [openCreate, setOpenCreate] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const reservations = useReservations({ status, from: range.date_from, to: range.date_to, search: applied });
  const rows = reservations.data ?? [];
  const summary = summarize(rows);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><BedDouble className="h-6 w-6 text-brand-text" />Reservasi Resort</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pemesanan kamar: cek ketersediaan, tarif weekday/weekend & musim, lalu kelola sampai check-out.
          </p>
        </div>
        <Button onClick={() => setOpenCreate(true)}><Plus className="mr-1.5 h-4 w-4" />Reservasi baru</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Reservasi", String(summary.total)],
          ["Total malam", String(summary.nights)],
          ["Nilai reservasi", formatRupiah(summary.revenue)],
          ["Saldo belum lunas", formatRupiah(summary.balance)],
        ].map(([label, value]) => (
          <Card key={label}><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-bold">{value}</p>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-wrap gap-1.5">
            {REPORT_PERIOD_SHORTCUTS.map((k) => (
              <button key={k} type="button" onClick={() => setRange(resolveReportPeriod(k))}
                className="rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                {REPORT_PERIOD_LABELS[k]}
              </button>
            ))}
          </div>
          <label className="text-xs text-muted-foreground">Dari
            <Input type="date" value={range.date_from} onChange={(e) => setRange((r) => ({ ...r, date_from: e.target.value }))} className="mt-1 h-9" />
          </label>
          <label className="text-xs text-muted-foreground">Sampai
            <Input type="date" value={range.date_to} onChange={(e) => setRange((r) => ({ ...r, date_to: e.target.value }))} className="mt-1 h-9" />
          </label>
          <label className="text-xs text-muted-foreground">Status
            <select value={status} onChange={(e) => setStatus(e.target.value as ReservationStatus | "all")}
              className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm">
              <option value="all">Semua status</option>
              {RESERVATION_STATUSES.map((s) => <option key={s} value={s}>{RESERVATION_STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); setApplied(search.trim()); }}>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama / no. HP / kode reservasi…" className="h-9" />
            <Button type="submit" variant="outline" className="h-9"><Search className="h-4 w-4" /></Button>
          </form>
        </CardContent>
      </Card>

      {reservations.isPending ? (
        <Card><CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat reservasi…</CardContent></Card>
      ) : reservations.isError ? (
        <Card><CardContent className="p-8 text-center text-sm text-destructive">{reservations.error.message || "Gagal memuat reservasi"}</CardContent></Card>
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Belum ada reservasi pada rentang ini.</CardContent></Card>
      ) : (
        <Card><CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Kode / Tamu</th>
                <th className="px-3 py-2 text-left font-medium">Menginap</th>
                <th className="px-3 py-2 text-left font-medium">Kamar</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-right font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetailId(r.id)}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{r.guest_name}</p>
                    <p className="text-xs text-muted-foreground">{r.reservation_code} · {r.guest_phone} · {RESERVATION_SOURCE_LABELS[r.source]}</p>
                  </td>
                  <td className="px-3 py-2">
                    <p>{formatDate(r.check_in)} → {formatDate(r.check_out)}</p>
                    <p className="text-xs text-muted-foreground">{r.nights} malam · {r.adults} dewasa{r.children ? `, ${r.children} anak` : ""}</p>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.room_count}× {r.room_types ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_CLASS[r.status])}>
                      {RESERVATION_STATUS_LABELS[r.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{formatRupiah(r.total)}</td>
                  <td className={cn("px-3 py-2 text-right", r.balance > 0 ? "font-semibold text-amber-700" : "text-muted-foreground")}>{formatRupiah(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent></Card>
      )}

      {openCreate && <CreateReservationDialog onClose={() => setOpenCreate(false)} />}
      {detailId && <ReservationDetailDialog id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
