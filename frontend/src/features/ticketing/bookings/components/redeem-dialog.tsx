"use client";

import { useMemo, useState } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { matchRedeemGuests } from "@/lib/ticketing/booking";
import { formatRupiah } from "@/lib/format";
import { lookupBooking } from "../api";
import { useRedeemBooking } from "../queries";
import {
  BOOKING_STATUS_BADGES,
  BOOKING_STATUS_LABELS,
  type BookingLookup,
  type RedeemBand,
} from "../types";

interface RedeemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Redeem booking website di loket (D4): scan/ketik kode BK-XXXXXX →
 * rincian booking → tiap ANGGOTA rombongan di-pair satu gelang NFC
 * (auto-assign ke anggota berikutnya yang belum dapat) → visit prepaid
 * net-0. Nama anggota ikut menempel ke gelang sampai ke gate.
 */
export function RedeemDialog({ open, onOpenChange }: RedeemDialogProps) {
  const [code, setCode] = useState("");
  const [booking, setBooking] = useState<BookingLookup | null>(null);
  const [bands, setBands] = useState<RedeemBand[]>([]);
  const [tapUid, setTapUid] = useState("");

  const reset = () => {
    setCode("");
    setBooking(null);
    setBands([]);
    setTapUid("");
  };

  const lookup = useMutation({
    mutationFn: lookupBooking,
    onSuccess: (data) => {
      setBooking(data);
      setBands([]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const redeem = useRedeemBooking(() => {
    reset();
    onOpenChange(false);
  });

  const guests = useMemo(() => booking?.guests ?? [], [booking]);
  const guestById = useMemo(
    () => new Map(guests.map((g) => [g.id, g])),
    [guests]
  );
  const pairedGuestIds = useMemo(
    () => new Set(bands.map((b) => b.guest_id)),
    [bands]
  );

  const allMatched =
    booking !== null &&
    bands.length > 0 &&
    matchRedeemGuests(
      guests.map((g) => g.id),
      bands
    ).ok;

  const addBand = () => {
    const uid = tapUid.trim();
    if (!uid || !booking) return;
    if (bands.some((b) => b.nfc_uid.toUpperCase() === uid.toUpperCase())) {
      setTapUid("");
      return;
    }
    // Auto-assign ke anggota berikutnya yang belum dapat gelang
    const target = guests.find((g) => !pairedGuestIds.has(g.id));
    if (!target) return;
    setBands((prev) => [...prev, { nfc_uid: uid, guest_id: target.id }]);
    setTapUid("");
  };

  const setBandGuest = (index: number, guestId: string) => {
    setBands((prev) =>
      prev.map((b, i) => (i === index ? { ...b, guest_id: guestId } : b))
    );
  };

  const removeBand = (index: number) => {
    setBands((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (!booking || !allMatched || redeem.isPending) return;
    redeem.mutate({ id: booking.id, bands });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Redeem Booking Online</DialogTitle>
        </DialogHeader>

        {/* Langkah 1 — cari kode */}
        <div className="space-y-1.5">
          <Label htmlFor="booking_code">Kode Booking *</Label>
          <div className="flex gap-2">
            <Input
              id="booking_code"
              autoFocus
              placeholder="Scan QR pengunjung atau ketik BK-XXXXXX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (code.trim()) lookup.mutate(code.trim());
                }
              }}
              className="font-mono uppercase"
            />
            <Button
              onClick={() => code.trim() && lookup.mutate(code.trim())}
              disabled={lookup.isPending || !code.trim()}
            >
              {lookup.isPending ? "Mencari…" : "Cari"}
            </Button>
          </div>
        </div>

        {booking ? (
          <div className="space-y-4">
            {/* Ringkasan booking */}
            <div className="rounded-lg border border-gray-200/70 bg-gray-50/60 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-mono text-sm font-bold text-gray-900">
                    {booking.booking_code}
                  </p>
                  <p className="text-sm text-gray-700">
                    {booking.customer_name} · {booking.customer_phone}
                    {booking.gift_recipient_name ? (
                      <span className="ml-1 font-medium text-rose-600">
                        · 🎁 hadiah utk {booking.gift_recipient_name}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-gray-500">
                    Kunjungan {booking.visit_date} · {guests.length} orang ·
                    Total {formatRupiah(booking.total)}
                  </p>
                </div>
                <Badge
                  className={`border-0 font-normal ${BOOKING_STATUS_BADGES[booking.status]}`}
                >
                  {BOOKING_STATUS_LABELS[booking.status]}
                </Badge>
              </div>
              {!booking.redeemable ? (
                <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {booking.status === "digunakan"
                    ? "Booking sudah dipakai — tidak bisa di-redeem dua kali."
                    : booking.status !== "terbayar"
                      ? "Hanya booking terbayar yang bisa di-redeem."
                      : `Booking untuk tanggal ${booking.visit_date} — redeem hanya di hari-H (hari ini ${booking.today}).`}
                </p>
              ) : null}
            </div>

            {booking.redeemable ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Daftar anggota rombongan */}
                <div className="space-y-2">
                  <Label>Anggota Rombongan</Label>
                  <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                    {guests.map((guest) => {
                      const paired = pairedGuestIds.has(guest.id);
                      return (
                        <div
                          key={guest.id}
                          className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                            paired
                              ? "border-emerald-200/70 bg-emerald-50/50"
                              : "border-gray-200/70"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-gray-800">
                              {guest.guest_name}
                            </p>
                            <p className="truncate text-xs text-gray-500">
                              {guest.product_name} — {guest.variant_name}
                            </p>
                          </div>
                          <span
                            className={`ml-2 shrink-0 text-xs ${
                              paired ? "text-emerald-700" : "text-gray-400"
                            }`}
                          >
                            {paired ? "✓ gelang" : "belum"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Tap gelang → pair ke anggota */}
                <div className="space-y-2">
                  <Label htmlFor="redeem_tap_uid">Tap Gelang Satu per Satu *</Label>
                  <Input
                    id="redeem_tap_uid"
                    placeholder="Fokuskan kursor lalu tap gelang di reader"
                    value={tapUid}
                    onChange={(e) => setTapUid(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addBand();
                      }
                    }}
                    className="font-mono"
                  />
                  <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                    {bands.map((band, index) => (
                      <div
                        key={band.nfc_uid}
                        className="flex items-center gap-2 rounded-lg border border-gray-200/70 px-3 py-2"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-700">
                          {band.nfc_uid}
                        </span>
                        <Select
                          value={band.guest_id}
                          onValueChange={(v) => setBandGuest(index, v)}
                        >
                          <SelectTrigger className="h-8 w-44">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {/* Hanya anggota yang belum dapat gelang + pilihan
                                saat ini — mencegah pairing dobel dari UI */}
                            {guests
                              .filter(
                                (guest) =>
                                  guest.id === band.guest_id ||
                                  !pairedGuestIds.has(guest.id)
                              )
                              .map((guest) => (
                                <SelectItem key={guest.id} value={guest.id}>
                                  {guest.guest_name} · {guest.variant_name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => removeBand(index)}
                          className="h-8 w-8 p-0 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    {bands.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-xs text-gray-400">
                        Belum ada gelang di-tap
                      </p>
                    ) : null}
                  </div>
                  {guestById.size > 0 ? (
                    <p className="text-xs text-gray-500">
                      {bands.length}/{guests.length} anggota sudah dapat gelang
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={redeem.isPending}
          >
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={!allMatched || redeem.isPending}>
            {redeem.isPending ? "Memproses…" : "Redeem & Aktifkan Gelang"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
