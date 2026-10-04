"use client";

import { useState } from "react";
import { BedDouble, CheckCircle2, Loader2, LogIn, LogOut, Plus, Receipt, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateTime, formatRupiah } from "@/lib/format";
import {
  FOLIO_CHARGE_LABELS, FOLIO_CHARGE_TYPES, RESERVATION_SOURCE_LABELS, RESERVATION_STATUS_LABELS,
  chargeDirection, type FolioChargeType,
} from "@/lib/resort/reservation";
import { cn } from "@/lib/utils";
import { resortApi, useReservationDetail, useResortMutation, useRooms } from "@/features/resort/queries";
import { STATUS_CLASS } from "@/features/resort/types";

const EMPTY_CHARGE = { description: "", amount: "", method: "" };

/**
 * Detail reservasi + folio tamu (owner 2026-09-06). Dipakai halaman Reservasi
 * dan Front Office: konfirmasi, check-in (menetapkan unit kamar), check-out
 * (menolak bila folio belum lunas), batal, dan menambah biaya/pembayaran.
 */
export function ReservationDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: detail } = useReservationDetail(id);
  const rooms = useRooms().data ?? [];
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [charge, setCharge] = useState<{ type: FolioChargeType; description: string; amount: string; method: string }>({
    type: "fnb", ...EMPTY_CHARGE,
  });
  const [checkoutReason, setCheckoutReason] = useState("");

  const statusMutation = useResortMutation(
    (body: Record<string, unknown>) => resortApi.changeStatus(id, body),
    "Status diperbarui"
  );
  const chargeMutation = useResortMutation(
    (body: Record<string, unknown>) => resortApi.addCharge(id, body),
    "Folio diperbarui",
    () => setCharge((c) => ({ type: c.type, ...EMPTY_CHARGE }))
  );
  const busy = statusMutation.isPending || chargeMutation.isPending;

  const act = (action: string, extra: Record<string, unknown> = {}) => {
    if (!busy) statusMutation.mutate({ action, ...extra });
  };

  const checkIn = () => {
    if (!detail) return;
    const assignments = detail.rooms
      .map((r) => ({ reservation_room_id: r.id, room_id: assign[r.id] ?? r.room_id ?? "" }))
      .filter((a) => a.room_id);
    if (assignments.length < detail.rooms.length) {
      toast.error("Pilih unit kamar untuk setiap baris reservasi");
      return;
    }
    act("check-in", { assignments });
  };

  const checkOut = () => {
    const balance = detail?.totals.balance ?? 0;
    if (balance > 0 && !checkoutReason.trim()) {
      toast.error(`Folio masih ${formatRupiah(balance)} — catat pembayaran dulu, atau isi alasan untuk check-out dengan saldo terbuka`);
      return;
    }
    act("check-out", balance > 0 ? { force: true, reason: checkoutReason.trim() } : {});
  };

  const addCharge = () => {
    const amount = Number(charge.amount);
    if (!charge.description.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast.error("Isi keterangan dan nominal yang benar");
      return;
    }
    chargeMutation.mutate({
      charge_type: charge.type, description: charge.description.trim(), amount,
      payment_method: charge.method.trim() || null,
    });
  };

  const status = detail?.status;
  const canConfirm = status === "menunggu-bayar";
  const canCheckIn = status === "terkonfirmasi";
  const canCheckOut = status === "check-in";
  const canCancel = status === "menunggu-bayar" || status === "terkonfirmasi";

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <BedDouble className="h-5 w-5 text-brand-text" />
            {detail ? (
              <>
                <span>{detail.reservation_code}</span>
                <span className="text-muted-foreground">·</span>
                <span className="truncate">{detail.guest_name}</span>
                <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_CLASS[detail.status])}>
                  {RESERVATION_STATUS_LABELS[detail.status]}
                </span>
              </>
            ) : "Memuat…"}
          </DialogTitle>
        </DialogHeader>

        {!detail ? (
          <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat detail…</p>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <section className="grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Tamu</p>
                <p className="font-medium">{detail.guest_name}</p>
                <p className="text-xs text-muted-foreground">{detail.guest_phone}{detail.guest_email ? ` · ${detail.guest_email}` : ""}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Menginap</p>
                <p className="font-medium">{formatDate(detail.check_in)} → {formatDate(detail.check_out)}</p>
                <p className="text-xs text-muted-foreground">
                  {detail.nights} malam · {detail.adults} dewasa{detail.children ? `, ${detail.children} anak` : ""} · {RESERVATION_SOURCE_LABELS[detail.source]}
                </p>
              </div>
              {detail.special_request ? (
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted-foreground">Permintaan khusus</p>
                  <p>{detail.special_request}</p>
                </div>
              ) : null}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">Kamar</h3>
              <div className="space-y-2">
                {detail.rooms.map((room) => {
                  const options = rooms.filter(
                    (r) => r.room_type_id === room.room_type_id && r.is_active && r.status !== "ditutup"
                      && (!r.reservation_id || r.reservation_id === detail.id)
                  );
                  return (
                    <div key={room.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{room.room_type_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatRupiah(room.nightly_rate)} × {room.nights} malam
                          {room.extra_bed > 0 ? ` · ${room.extra_bed} extra bed` : ""} · tamu {room.guest_name ?? detail.guest_name}
                        </p>
                      </div>
                      {canCheckIn ? (
                        <select
                          value={assign[room.id] ?? room.room_id ?? ""}
                          onChange={(e) => setAssign((prev) => ({ ...prev, [room.id]: e.target.value }))}
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                        >
                          <option value="">Pilih unit kamar…</option>
                          {options.map((o) => (
                            <option key={o.id} value={o.id}>{o.code} · {o.name}{o.status !== "siap" ? ` (${o.status})` : ""}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="rounded-md bg-muted px-2 py-1 text-xs">{room.room_name ?? "Belum ditetapkan"}</span>
                      )}
                      <span className="w-28 text-right font-semibold">{formatRupiah(room.subtotal)}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Receipt className="h-4 w-4" />Folio tamu</h3>
                <div className="text-right text-xs text-muted-foreground">
                  Tagihan {formatRupiah(detail.totals.charges)} · Bayar {formatRupiah(detail.totals.payments)}
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    {detail.folio.map((f) => (
                      <tr key={f.id}>
                        <td className="px-3 py-2">
                          <span className="font-medium">{FOLIO_CHARGE_LABELS[f.charge_type as FolioChargeType] ?? f.charge_type}</span>
                          <span className="ml-2 text-muted-foreground">{f.description}</span>
                          {f.payment_method ? <span className="ml-2 text-xs text-muted-foreground">({f.payment_method})</span> : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-muted-foreground">{formatDateTime(f.created_at)}</td>
                        <td className={cn("whitespace-nowrap px-3 py-2 text-right font-semibold", f.direction === "kredit" ? "text-emerald-700" : "")}>
                          {f.direction === "kredit" ? "−" : ""}{formatRupiah(f.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-muted/60">
                      <td className="px-3 py-2 font-semibold" colSpan={2}>Saldo</td>
                      <td className={cn("px-3 py-2 text-right font-bold", detail.totals.balance > 0 ? "text-amber-700" : "text-emerald-700")}>
                        {formatRupiah(detail.totals.balance)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {detail.status !== "dibatalkan" && detail.status !== "check-out" ? (
                <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3">
                  <label className="text-xs text-muted-foreground">
                    Jenis
                    <select
                      value={charge.type}
                      onChange={(e) => setCharge((c) => ({ ...c, type: e.target.value as FolioChargeType }))}
                      className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm"
                    >
                      {FOLIO_CHARGE_TYPES.filter((t) => t !== "kamar" && t !== "extra-bed").map((t) => (
                        <option key={t} value={t}>{FOLIO_CHARGE_LABELS[t]} ({chargeDirection(t) === "kredit" ? "−" : "+"})</option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-[180px] flex-1 text-xs text-muted-foreground">
                    Keterangan
                    <Input value={charge.description} onChange={(e) => setCharge((c) => ({ ...c, description: e.target.value }))} placeholder="mis. Makan malam Purbasari" className="mt-1 h-9" />
                  </label>
                  <label className="w-32 text-xs text-muted-foreground">
                    Nominal
                    <Input inputMode="numeric" value={charge.amount} onChange={(e) => setCharge((c) => ({ ...c, amount: e.target.value.replace(/[^\d]/g, "") }))} placeholder="0" className="mt-1 h-9" />
                  </label>
                  {chargeDirection(charge.type) === "kredit" ? (
                    <label className="w-28 text-xs text-muted-foreground">
                      Metode
                      <Input value={charge.method} onChange={(e) => setCharge((c) => ({ ...c, method: e.target.value }))} placeholder="cash / qris" className="mt-1 h-9" />
                    </label>
                  ) : null}
                  <Button type="button" onClick={addCharge} disabled={busy} className="h-9">
                    <Plus className="mr-1 h-4 w-4" />Tambah
                  </Button>
                </div>
              ) : null}
            </section>

            {canCheckOut && detail.totals.balance > 0 ? (
              <Textarea
                value={checkoutReason}
                onChange={(e) => setCheckoutReason(e.target.value)}
                rows={2}
                placeholder="Alasan check-out dengan saldo terbuka (mis. ditagihkan ke korporat)"
              />
            ) : null}
          </div>
        )}

        {detail ? (
          <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">
            {canCancel && (
              <Button variant="outline" className="text-destructive" disabled={busy}
                onClick={() => act("batal", { reason: "Dibatalkan dari dashboard" })}>
                <XCircle className="mr-1.5 h-4 w-4" />Batalkan
              </Button>
            )}
            {canConfirm && (
              <Button disabled={busy} onClick={() => act("konfirmasi")}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" />Konfirmasi
              </Button>
            )}
            {canCheckIn && (
              <Button disabled={busy} onClick={checkIn} className="bg-emerald-600 text-white hover:bg-emerald-700">
                <LogIn className="mr-1.5 h-4 w-4" />Check-in
              </Button>
            )}
            {canCheckOut && (
              <Button disabled={busy} onClick={checkOut}>
                <LogOut className="mr-1.5 h-4 w-4" />Check-out
              </Button>
            )}
            <Button variant="outline" onClick={onClose} disabled={busy}>Tutup</Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
