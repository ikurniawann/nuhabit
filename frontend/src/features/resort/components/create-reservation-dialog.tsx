"use client";

import { useState } from "react";
import { CalendarRange, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format";
import { wibDateString } from "@/lib/pos/report-period";
import { RESERVATION_SOURCES, RESERVATION_SOURCE_LABELS, type ReservationSource } from "@/lib/resort/reservation";
import { cn } from "@/lib/utils";
import { resortApi, useAvailability, useResortMutation } from "../queries";
import { nightLabel, pickedLines, reservationTotal, type RoomPicks } from "../reservation-form";

/** Reservasi baru: data tamu, tanggal, pilih kamar dari ketersediaan + penawaran harga per malam. */
export function CreateReservationDialog({ onClose }: { onClose: () => void }) {
  const today = wibDateString(new Date());
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    guest_name: "", guest_phone: "", guest_email: "", check_in: today, check_out: tomorrow,
    adults: 2, children: 0, source: "walk-in" as ReservationSource, notes: "", special_request: "", discount: "",
  });
  const [picks, setPicks] = useState<RoomPicks>({});
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const validRange = form.check_out > form.check_in;
  const availability = useAvailability(form.check_in, form.check_out);
  const types = validRange ? availability.data?.types ?? (availability.isError ? [] : null) : [];
  const lines = pickedLines(types ?? [], picks);
  const discount = Number(form.discount) || 0;
  const total = reservationTotal(lines, discount);

  const create = useResortMutation(resortApi.createReservation, "Reservasi dibuat", onClose);
  const busy = create.isPending;

  const submit = () => {
    if (!form.guest_name.trim() || !form.guest_phone.trim()) { toast.error("Nama dan nomor HP tamu wajib diisi"); return; }
    if (lines.length === 0) { toast.error("Pilih minimal satu kamar"); return; }
    create.mutate({
      guest_name: form.guest_name.trim(), guest_phone: form.guest_phone.trim(),
      guest_email: form.guest_email.trim() || null,
      check_in: form.check_in, check_out: form.check_out,
      adults: form.adults, children: form.children, source: form.source,
      discount_amount: discount, notes: form.notes.trim() || null,
      special_request: form.special_request.trim() || null,
      rooms: lines.map((l) => ({ room_type_id: l.type.id, qty: l.qty, extra_bed: l.extraBed })),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base"><CalendarRange className="h-5 w-5 text-brand-text" />Reservasi baru</DialogTitle>
        </DialogHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted-foreground">Nama tamu
              <Input value={form.guest_name} onChange={(e) => set({ guest_name: e.target.value })} className="mt-1" placeholder="Nama lengkap" />
            </label>
            <label className="text-xs text-muted-foreground">No. HP
              <Input value={form.guest_phone} onChange={(e) => set({ guest_phone: e.target.value })} className="mt-1" placeholder="0812…" />
            </label>
            <label className="text-xs text-muted-foreground">Email (opsional)
              <Input type="email" value={form.guest_email} onChange={(e) => set({ guest_email: e.target.value })} className="mt-1" placeholder="tamu@email.com" />
            </label>
            <label className="text-xs text-muted-foreground">Sumber
              <select value={form.source} onChange={(e) => set({ source: e.target.value as ReservationSource })}
                className="mt-1 block h-10 w-full rounded-md border bg-background px-2 text-sm">
                {RESERVATION_SOURCES.map((s) => <option key={s} value={s}>{RESERVATION_SOURCE_LABELS[s]}</option>)}
              </select>
            </label>
          </section>

          <section className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs text-muted-foreground">Check-in
              <Input type="date" value={form.check_in} onChange={(e) => set({ check_in: e.target.value })} className="mt-1" />
            </label>
            <label className="text-xs text-muted-foreground">Check-out
              <Input type="date" min={form.check_in} value={form.check_out} onChange={(e) => set({ check_out: e.target.value })} className="mt-1" />
            </label>
            <label className="text-xs text-muted-foreground">Dewasa
              <Input type="number" min={1} value={form.adults} onChange={(e) => set({ adults: Math.max(1, Number(e.target.value) || 1) })} className="mt-1" />
            </label>
            <label className="text-xs text-muted-foreground">Anak
              <Input type="number" min={0} value={form.children} onChange={(e) => set({ children: Math.max(0, Number(e.target.value) || 0) })} className="mt-1" />
            </label>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Pilih kamar</h3>
            {types === null ? (
              <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Mengecek ketersediaan…</p>
            ) : types.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                {availability.isError && availability.error instanceof Error
                  ? availability.error.message
                  : "Belum ada tipe kamar aktif, atau tanggal belum valid. Tambahkan tipe kamar di menu Kamar & Tipe."}
              </p>
            ) : (
              <div className="space-y-2">
                {types.map((t) => {
                  const pick = picks[t.id] ?? { qty: 0, extraBed: 0 };
                  const seasons = [...new Set(t.quote.breakdown.map((b) => b.season).filter(Boolean))];
                  const setPick = (patch: Partial<typeof pick>) => setPicks((p) => ({ ...p, [t.id]: { ...pick, ...patch } }));
                  return (
                    <div key={t.id} className={cn("rounded-lg border p-3", pick.qty > 0 && "border-primary bg-primary/5")}>
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{t.name} <span className="text-xs text-muted-foreground">({t.code})</span></p>
                          <p className="text-xs text-muted-foreground">
                            Sisa {t.available} dari {t.rooms_total} unit · maks {t.capacity_adults} dewasa
                            {t.capacity_children ? ` + ${t.capacity_children} anak` : ""} · {formatRupiah(t.quote.room_subtotal)} / {t.quote.nights} malam
                            {seasons.length ? ` · musim: ${seasons.join(", ")}` : ""}
                          </p>
                        </div>
                        <label className="text-xs text-muted-foreground">Jumlah
                          <Input type="number" min={0} max={t.available} value={pick.qty}
                            onChange={(e) => setPick({ qty: Math.max(0, Math.min(t.available, Number(e.target.value) || 0)) })}
                            className="mt-1 h-9 w-20" />
                        </label>
                        {t.extra_bed_capacity > 0 && (
                          <label className="text-xs text-muted-foreground">Extra bed
                            <Input type="number" min={0} max={t.extra_bed_capacity} value={pick.extraBed}
                              onChange={(e) => setPick({ extraBed: Math.max(0, Math.min(t.extra_bed_capacity, Number(e.target.value) || 0)) })}
                              className="mt-1 h-9 w-20" />
                          </label>
                        )}
                      </div>
                      {pick.qty > 0 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t.quote.breakdown.map((b) => `${nightLabel(b)} ${formatRupiah(b.rate)}`).join(" · ")}
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
              <Input inputMode="numeric" value={form.discount} onChange={(e) => set({ discount: e.target.value.replace(/[^\d]/g, "") })} className="mt-1" placeholder="0" />
            </label>
            <label className="text-xs text-muted-foreground">Permintaan khusus
              <Textarea rows={2} value={form.special_request} onChange={(e) => set({ special_request: e.target.value })} className="mt-1" placeholder="mis. kamar berdekatan, alergi makanan" />
            </label>
          </section>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Total </span>
            <span className="text-lg font-bold">{formatRupiah(total)}</span>
            {discount > 0 && <span className="ml-2 text-xs text-muted-foreground">setelah diskon {formatRupiah(discount)}</span>}
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
