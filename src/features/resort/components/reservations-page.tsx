"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BedDouble, CalendarRange, Loader2, Plus, Search } from "lucide-react";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPost } from "@/lib/api-client";
import { REPORT_PERIOD_LABELS, REPORT_PERIOD_SHORTCUTS, resolveReportPeriod, wibDateString } from "@/lib/pos/report-period";
import {
  RESERVATION_SOURCES, RESERVATION_SOURCE_LABELS, RESERVATION_STATUSES, RESERVATION_STATUS_LABELS,
  type ReservationSource, type ReservationStatus,
} from "@/lib/resort/reservation";
import { cn } from "@/lib/utils";
import { ReservationDetailDialog } from "@/features/resort/components/reservation-detail-dialog";
import {
  STATUS_CLASS, rupiah, tanggal,
  type AvailabilityType, type ReservationListRow,
} from "@/features/resort/types";

/**
 * Resort → Reservasi (owner 2026-09-06): daftar reservasi + pembuatan
 * reservasi baru dengan cek ketersediaan dan penawaran harga per malam
 * (weekday/weekend/musim) sebelum disimpan.
 */
export function ResortReservationsPage() {
  const [rows, setRows] = useState<ReservationListRow[] | null>(null);
  const [status, setStatus] = useState<ReservationStatus | "all">("all");
  const [range, setRange] = useState(() => resolveReportPeriod("month"));
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [openCreate, setOpenCreate] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ status, from: range.date_from, to: range.date_to });
    if (applied) qs.set("search", applied);
    apiGet<{ data: ReservationListRow[] }>(`/api/resort/reservations?${qs.toString()}`)
      .then((res) => setRows(res.data))
      .catch((err) => { setRows([]); toast.error(err instanceof Error ? err.message : "Gagal memuat reservasi"); });
  }, [status, range, applied]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => {
    const list = rows ?? [];
    return {
      total: list.length,
      nights: list.reduce((s, r) => s + r.nights, 0),
      revenue: list.filter((r) => r.status !== "dibatalkan").reduce((s, r) => s + r.total, 0),
      balance: list.reduce((s, r) => s + Math.max(0, r.balance), 0),
    };
  }, [rows]);

  return (
    <div className="space-y-5">
      <Toaster richColors position="top-center" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><BedDouble className="h-6 w-6 text-primary" />Reservasi Resort</h1>
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
          ["Nilai reservasi", rupiah(summary.revenue)],
          ["Saldo belum lunas", rupiah(summary.balance)],
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

      {rows === null ? (
        <Card><CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat reservasi…</CardContent></Card>
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
                    <p>{tanggal(r.check_in)} → {tanggal(r.check_out)}</p>
                    <p className="text-xs text-muted-foreground">{r.nights} malam · {r.adults} dewasa{r.children ? `, ${r.children} anak` : ""}</p>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.room_count}× {r.room_types ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_CLASS[r.status])}>
                      {RESERVATION_STATUS_LABELS[r.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{rupiah(r.total)}</td>
                  <td className={cn("px-3 py-2 text-right", r.balance > 0 ? "font-semibold text-amber-700" : "text-muted-foreground")}>{rupiah(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent></Card>
      )}

      {openCreate && <CreateReservationDialog onClose={() => setOpenCreate(false)} onCreated={() => { setOpenCreate(false); load(); }} />}
      {detailId && <ReservationDetailDialog id={detailId} onClose={() => setDetailId(null)} onChanged={load} />}
    </div>
  );
}

function CreateReservationDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const today = wibDateString(new Date());
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    guest_name: "", guest_phone: "", guest_email: "", check_in: today, check_out: tomorrow,
    adults: 2, children: 0, source: "walk-in" as ReservationSource, notes: "", special_request: "", discount: "",
  });
  const [avail, setAvail] = useState<{ key: string; types: AvailabilityType[] } | null>(null);
  const [picks, setPicks] = useState<Record<string, { qty: number; extraBed: number }>>({});
  const [busy, setBusy] = useState(false);

  // Ketersediaan dimuat ulang tiap tanggal berubah; hasil ditandai `key` agar
  // data lama tidak dipakai (tanpa setState sinkron di dalam effect).
  const rangeKey = `${form.check_in}|${form.check_out}`;
  const validRange = form.check_out > form.check_in;
  useEffect(() => {
    if (!validRange) return;
    let alive = true;
    apiGet<{ data: { types: AvailabilityType[] } }>(`/api/resort/availability?check_in=${form.check_in}&check_out=${form.check_out}`)
      .then((res) => { if (alive) setAvail({ key: rangeKey, types: res.data.types }); })
      .catch((err) => {
        if (!alive) return;
        setAvail({ key: rangeKey, types: [] });
        toast.error(err instanceof Error ? err.message : "Gagal cek ketersediaan");
      });
    return () => { alive = false; };
  }, [validRange, rangeKey, form.check_in, form.check_out]);
  const types = !validRange ? [] : avail?.key === rangeKey ? avail.types : null;

  const lines = useMemo(() => (types ?? []).flatMap((t) => {
    const pick = picks[t.id];
    if (!pick?.qty) return [];
    const perRoom = t.quote.room_subtotal + (pick.extraBed * (t.extra_bed_rate || 0) * t.quote.nights);
    return [{ type: t, qty: pick.qty, extraBed: pick.extraBed, subtotal: perRoom * pick.qty }];
  }), [types, picks]);
  const discount = Number(form.discount) || 0;
  const total = Math.max(0, lines.reduce((s, l) => s + l.subtotal, 0) - discount);

  const submit = async () => {
    if (!form.guest_name.trim() || !form.guest_phone.trim()) { toast.error("Nama dan nomor HP tamu wajib diisi"); return; }
    if (lines.length === 0) { toast.error("Pilih minimal satu kamar"); return; }
    setBusy(true);
    try {
      const res = await apiPost<{ message: string }>("/api/resort/reservations", {
        guest_name: form.guest_name.trim(), guest_phone: form.guest_phone.trim(),
        guest_email: form.guest_email.trim() || null,
        check_in: form.check_in, check_out: form.check_out,
        adults: form.adults, children: form.children, source: form.source,
        discount_amount: discount, notes: form.notes.trim() || null,
        special_request: form.special_request.trim() || null,
        rooms: lines.map((l) => ({ room_type_id: l.type.id, qty: l.qty, extra_bed: l.extraBed })),
      });
      toast.success(res.message ?? "Reservasi dibuat");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat reservasi");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base"><CalendarRange className="h-5 w-5 text-primary" />Reservasi baru</DialogTitle>
        </DialogHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted-foreground">Nama tamu
              <Input value={form.guest_name} onChange={(e) => setForm((f) => ({ ...f, guest_name: e.target.value }))} className="mt-1" placeholder="Nama lengkap" />
            </label>
            <label className="text-xs text-muted-foreground">No. HP
              <Input value={form.guest_phone} onChange={(e) => setForm((f) => ({ ...f, guest_phone: e.target.value }))} className="mt-1" placeholder="0812…" />
            </label>
            <label className="text-xs text-muted-foreground">Email (opsional)
              <Input type="email" value={form.guest_email} onChange={(e) => setForm((f) => ({ ...f, guest_email: e.target.value }))} className="mt-1" placeholder="tamu@email.com" />
            </label>
            <label className="text-xs text-muted-foreground">Sumber
              <select value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value as ReservationSource }))}
                className="mt-1 block h-10 w-full rounded-md border bg-background px-2 text-sm">
                {RESERVATION_SOURCES.map((s) => <option key={s} value={s}>{RESERVATION_SOURCE_LABELS[s]}</option>)}
              </select>
            </label>
          </section>

          <section className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs text-muted-foreground">Check-in
              <Input type="date" value={form.check_in} onChange={(e) => setForm((f) => ({ ...f, check_in: e.target.value }))} className="mt-1" />
            </label>
            <label className="text-xs text-muted-foreground">Check-out
              <Input type="date" min={form.check_in} value={form.check_out} onChange={(e) => setForm((f) => ({ ...f, check_out: e.target.value }))} className="mt-1" />
            </label>
            <label className="text-xs text-muted-foreground">Dewasa
              <Input type="number" min={1} value={form.adults} onChange={(e) => setForm((f) => ({ ...f, adults: Math.max(1, Number(e.target.value) || 1) }))} className="mt-1" />
            </label>
            <label className="text-xs text-muted-foreground">Anak
              <Input type="number" min={0} value={form.children} onChange={(e) => setForm((f) => ({ ...f, children: Math.max(0, Number(e.target.value) || 0) }))} className="mt-1" />
            </label>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Pilih kamar</h3>
            {types === null ? (
              <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Mengecek ketersediaan…</p>
            ) : types.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                Belum ada tipe kamar aktif, atau tanggal belum valid. Tambahkan tipe kamar di menu Kamar &amp; Tipe.
              </p>
            ) : (
              <div className="space-y-2">
                {types.map((t) => {
                  const pick = picks[t.id] ?? { qty: 0, extraBed: 0 };
                  const seasons = [...new Set(t.quote.breakdown.map((b) => b.season).filter(Boolean))];
                  return (
                    <div key={t.id} className={cn("rounded-lg border p-3", pick.qty > 0 && "border-primary bg-primary/5")}>
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{t.name} <span className="text-xs text-muted-foreground">({t.code})</span></p>
                          <p className="text-xs text-muted-foreground">
                            Sisa {t.available} dari {t.rooms_total} unit · maks {t.capacity_adults} dewasa
                            {t.capacity_children ? ` + ${t.capacity_children} anak` : ""} · {rupiah(t.quote.room_subtotal)} / {t.quote.nights} malam
                            {seasons.length ? ` · musim: ${seasons.join(", ")}` : ""}
                          </p>
                        </div>
                        <label className="text-xs text-muted-foreground">Jumlah
                          <Input type="number" min={0} max={t.available} value={pick.qty}
                            onChange={(e) => setPicks((p) => ({ ...p, [t.id]: { ...pick, qty: Math.max(0, Math.min(t.available, Number(e.target.value) || 0)) } }))}
                            className="mt-1 h-9 w-20" />
                        </label>
                        {t.extra_bed_capacity > 0 && (
                          <label className="text-xs text-muted-foreground">Extra bed
                            <Input type="number" min={0} max={t.extra_bed_capacity} value={pick.extraBed}
                              onChange={(e) => setPicks((p) => ({ ...p, [t.id]: { ...pick, extraBed: Math.max(0, Math.min(t.extra_bed_capacity, Number(e.target.value) || 0)) } }))}
                              className="mt-1 h-9 w-20" />
                          </label>
                        )}
                      </div>
                      {pick.qty > 0 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t.quote.breakdown.map((b) => `${b.date.slice(8)}/${b.date.slice(5, 7)} ${b.weekend ? "(WE)" : ""} ${rupiah(b.rate)}`).join(" · ")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted-foreground">Diskon (Rp)
              <Input inputMode="numeric" value={form.discount} onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value.replace(/[^\d]/g, "") }))} className="mt-1" placeholder="0" />
            </label>
            <label className="text-xs text-muted-foreground">Permintaan khusus
              <Textarea rows={2} value={form.special_request} onChange={(e) => setForm((f) => ({ ...f, special_request: e.target.value }))} className="mt-1" placeholder="mis. kamar berdekatan, alergi makanan" />
            </label>
          </section>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Total </span>
            <span className="text-lg font-bold">{rupiah(total)}</span>
            {discount > 0 && <span className="ml-2 text-xs text-muted-foreground">setelah diskon {rupiah(discount)}</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
            <Button onClick={submit} disabled={busy || lines.length === 0}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan reservasi
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
