"use client";

import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Radio, Trash2 } from "lucide-react";
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
import { formatRupiah } from "@/lib/format";
import { useTicketingSettings } from "../../masters/queries";
import { useLoketOptions } from "../../products/queries";
import { useRegisterVisit } from "../queries";
import type { PaymentMode } from "../../masters/types";
import {
  CASH_METHOD_LABELS,
  type CashMethod,
  type RegisterVisitBand,
  type RegisterVisitBundle,
} from "../types";
import type { LoketOption } from "../../products/types";

/**
 * Registrasi kunjungan loket — ala POS: pilih dulu jenis tiket (card, kanan
 * bawah muncul stepper qty), lalu tap gelang NFC satu per satu. Tiap tap
 * mengisi slot yang belum terisi berikutnya, urut sesuai jenis tiket yang
 * ditambahkan — kalau ada 5 orang (qty total 5), tap 5 kali. Paket (Fase P)
 * = 1 "unit" mengisi beberapa slot anggota sekaligus (mis. 2 gelang/unit).
 *
 * Harga di sini murni tampilan (price_regular, fallback price_high) — server
 * (`POST /api/ticketing/visits`) menghitung ulang dengan season hari ini via
 * resolveVariantPriceOnDate, otoritatif seperti alur booking publik.
 */

interface RegistrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 1 baris keranjang = 1 jenis tiket (varian satuan atau 1 unit paket). */
interface CartLine {
  key: string;
  variantId: string;
  ticketName: string;
  variantName: string;
  productKind: "single" | "bundle";
  price: number;
  /** Jumlah unit dibeli — satuan = jumlah orang, paket = jumlah paket. */
  qty: number;
  /** Label anggota per 1 unit; ["" ] utk satuan (1 slot polos). */
  memberLabels: string[];
  /** UID gelang per slot, flatten: qty × memberLabels.length. */
  uids: (string | null)[];
}

const slotsPerUnit = (line: CartLine) =>
  line.productKind === "bundle" ? line.memberLabels.length : 1;

function optionPrice(option: LoketOption): number {
  return option.price_regular ?? option.price_high ?? 0;
}

export function RegistrationDialog({ open, onOpenChange }: RegistrationDialogProps) {
  const optionsQuery = useLoketOptions();
  const settingsQuery = useTicketingSettings();
  const options = useMemo(() => optionsQuery.data ?? [], [optionsQuery.data]);

  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState<CashMethod>("cash");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [tapUid, setTapUid] = useState("");

  const effectiveMode: PaymentMode =
    paymentMode ?? settingsQuery.data?.default_payment_mode ?? "postpaid";
  const defaultLimit = Number(settingsQuery.data?.default_credit_limit ?? 0);

  const reset = () => {
    setContactName("");
    setContactPhone("");
    setPaymentMode(null);
    setDepositAmount("");
    setDepositMethod("cash");
    setCart([]);
    setTapUid("");
  };

  const mutation = useRegisterVisit(() => {
    reset();
    onOpenChange(false);
  });

  // Total slot gelang di seluruh keranjang, urut sesuai baris ditambahkan —
  // ini urutan yang harus diikuti tap NFC (slot pertama yang kosong).
  const totalSlots = useMemo(
    () => cart.reduce((sum, line) => sum + line.qty * slotsPerUnit(line), 0),
    [cart]
  );
  const filledSlots = useMemo(
    () =>
      cart.reduce(
        (sum, line) => sum + line.uids.filter((u) => u !== null).length,
        0
      ),
    [cart]
  );

  /** Slot kosong berikutnya lintas-baris — target tap NFC selanjutnya. */
  const nextPendingSlot = useMemo(() => {
    const lineWithGap = cart.find((line) => line.uids.some((u) => u === null));
    if (!lineWithGap) return null;
    const idx = lineWithGap.uids.findIndex((u) => u === null);
    const unit = Math.floor(idx / slotsPerUnit(lineWithGap));
    const memberIdx = idx % slotsPerUnit(lineWithGap);
    const label =
      lineWithGap.productKind === "bundle"
        ? `${lineWithGap.ticketName} · unit ${unit + 1} · ${lineWithGap.memberLabels[memberIdx]}`
        : `${lineWithGap.ticketName} — ${lineWithGap.variantName} (${idx + 1}/${lineWithGap.qty})`;
    return { line: lineWithGap, label };
  }, [cart]);

  // Klik card tiket memindahkan fokus browser ke tombolnya — kembalikan
  // fokus ke input tap NFC supaya kasir bisa langsung tap tanpa klik manual.
  // Input UI primitif tidak forward ref, jadi ambil elemen lewat id-nya.
  useEffect(() => {
    if (nextPendingSlot) document.getElementById("tap_uid")?.focus();
  }, [nextPendingSlot]);

  const allUids = useMemo(
    () =>
      cart.flatMap((line) =>
        line.uids.filter((u): u is string => u !== null).map((u) => u.toUpperCase())
      ),
    [cart]
  );

  // Klik card = toggle pilih/batal (qty 1) — BUKAN nambah qty setiap klik.
  // Jumlah tiket diatur lewat stepper +/- di keranjang kanan.
  const toggleCartLine = (option: LoketOption) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.variantId === option.variant_id);
      if (existing) {
        return prev.filter((l) => l.variantId !== option.variant_id);
      }
      const memberLabels =
        option.product_kind === "bundle"
          ? option.members.flatMap((m) => Array.from({ length: m.qty }, () => m.label))
          : [""];
      const newLine: CartLine = {
        key: option.variant_id,
        variantId: option.variant_id,
        ticketName: option.ticket_name,
        variantName: option.variant_name,
        productKind: option.product_kind,
        price: optionPrice(option),
        qty: 1,
        memberLabels,
        uids: Array(memberLabels.length).fill(null),
      };
      return [...prev, newLine];
    });
  };

  const changeQty = (key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.key !== key) return l;
          const nextQty = Math.max(0, l.qty + delta);
          const nextSlotCount = nextQty * slotsPerUnit(l);
          return { ...l, qty: nextQty, uids: l.uids.slice(0, nextSlotCount).concat(
            Array(Math.max(0, nextSlotCount - l.uids.length)).fill(null)
          ) };
        })
        .filter((l) => l.qty > 0)
    );
  };

  const removeLine = (key: string) => {
    setCart((prev) => prev.filter((l) => l.key !== key));
  };

  const addBand = () => {
    const uid = tapUid.trim();
    if (!uid) return;
    if (allUids.includes(uid.toUpperCase())) {
      setTapUid("");
      return;
    }
    if (!nextPendingSlot) return;
    setCart((prev) =>
      prev.map((l) => {
        if (l.key !== nextPendingSlot.line.key) return l;
        const idx = l.uids.findIndex((u) => u === null);
        const nextUids = [...l.uids];
        nextUids[idx] = uid;
        return { ...l, uids: nextUids };
      })
    );
    setTapUid("");
  };

  const depositValue = Number(depositAmount) || 0;
  const totalAmount = cart.reduce((sum, l) => sum + l.qty * l.price, 0);
  const canSubmit =
    contactName.trim() !== "" &&
    totalSlots > 0 &&
    filledSlots === totalSlots &&
    (effectiveMode !== "prepaid" || depositValue > 0) &&
    !mutation.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const bands: RegisterVisitBand[] = [];
    const bundles: RegisterVisitBundle[] = [];
    for (const line of cart) {
      if (line.productKind === "bundle") {
        for (let u = 0; u < line.qty; u++) {
          const slice = line.uids.slice(u * line.memberLabels.length, (u + 1) * line.memberLabels.length);
          bundles.push({
            bundle_variant_id: line.variantId,
            band_uids: slice.filter((x): x is string => x !== null),
          });
        }
      } else {
        for (const uid of line.uids) {
          if (uid) bands.push({ nfc_uid: uid, variant_id: line.variantId });
        }
      }
    }
    mutation.mutate({
      contact_name: contactName.trim(),
      contact_phone: contactPhone.trim() || null,
      payment_mode: effectiveMode,
      deposit:
        effectiveMode === "prepaid"
          ? { amount: depositValue, method: depositMethod }
          : null,
      bands,
      bundles,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex h-[88vh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b border-gray-200/70 px-6 py-4">
          <DialogTitle>Registrasi Kunjungan Baru</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* ── KIRI: pilih jenis tiket ala grid produk POS ── */}
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {!optionsQuery.isLoading && options.length === 0 ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Belum ada ticket Active yang didistribusi ke POS — buat di Master
                Ticket dulu.
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {options.map((option) => {
                const line = cart.find((l) => l.variantId === option.variant_id);
                const qty = line?.qty ?? 0;
                return (
                  <button
                    key={option.variant_id}
                    type="button"
                    onClick={() => toggleCartLine(option)}
                    className={`group relative flex flex-col rounded-2xl border p-3 text-left transition-all ${
                      qty > 0
                        ? "border-rose-500 shadow-[0_4px_12px_rgba(244,63,94,0.15)] ring-1 ring-rose-500"
                        : "border-gray-200 hover:border-gray-400 hover:shadow-sm"
                    }`}
                  >
                    {qty > 0 && (
                      <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-xs font-bold text-white shadow">
                        {qty}
                      </span>
                    )}
                    <p className="text-sm font-semibold leading-tight text-gray-900">
                      {option.ticket_name}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {option.product_kind === "bundle"
                        ? `Paket · ${option.members_per_unit} gelang/unit`
                        : option.variant_name}
                    </p>
                    <p className="mt-2 text-sm font-bold text-rose-600">
                      {formatRupiah(optionPrice(option))}
                      <span className="font-normal text-gray-400">
                        {option.product_kind === "bundle" ? " /unit" : " /tiket"}
                      </span>
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── KANAN: keranjang + tap NFC + data pemesan, persisten ala CartPanel POS ── */}
          <div className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-l border-gray-200/70 bg-gray-50/60 p-4">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="visit_contact">Nama Penanggung Jawab *</Label>
                <Input
                  id="visit_contact"
                  placeholder="mis. Bpk. Ahmad (rombongan keluarga)"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="bg-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="visit_phone">No. WhatsApp</Label>
                <Input
                  id="visit_phone"
                  placeholder="08xxxxxxxxxx"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className="bg-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Mode Bayar</Label>
                <Select
                  value={effectiveMode}
                  onValueChange={(v) => setPaymentMode(v as PaymentMode)}
                >
                  <SelectTrigger className="w-full bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="postpaid">
                      Postpaid — tagihan menumpuk, bayar saat keluar
                    </SelectItem>
                    <SelectItem value="prepaid">
                      Prepaid — top-up saldo sekarang, sisa di-refund
                    </SelectItem>
                  </SelectContent>
                </Select>
                {effectiveMode === "postpaid" && defaultLimit > 0 ? (
                  <p className="text-xs text-gray-500">
                    Plafon tagihan venue: {formatRupiah(defaultLimit)}
                  </p>
                ) : null}
              </div>
              {effectiveMode === "prepaid" ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="deposit_amount">Top-up Awal (Rp) *</Label>
                    <Input
                      id="deposit_amount"
                      type="number"
                      min={0}
                      step={50000}
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Metode</Label>
                    <Select
                      value={depositMethod}
                      onValueChange={(v) => setDepositMethod(v as CashMethod)}
                    >
                      <SelectTrigger className="w-full bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(CASH_METHOD_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="my-4 border-t border-gray-200" />

            {/* Keranjang jenis tiket terpilih */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">
                  Tiket dipilih
                </h3>
                {totalAmount > 0 && (
                  <span className="text-sm font-bold tabular-nums text-gray-900">
                    {formatRupiah(totalAmount)}
                  </span>
                )}
              </div>
              {cart.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-xs text-gray-400">
                  Klik jenis tiket di kiri untuk menambah
                </p>
              ) : (
                <div className="space-y-2">
                  {cart.map((line) => (
                    <div
                      key={line.key}
                      className="rounded-xl border border-gray-200/70 bg-white px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-gray-900">
                            {line.ticketName}
                            {line.productKind === "single" && (
                              <span className="text-gray-400"> — {line.variantName}</span>
                            )}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            {formatRupiah(line.price)}{" "}
                            {line.productKind === "bundle" ? "/unit" : "/tiket"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => changeQty(line.key, -1)}
                            className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-gray-600 hover:border-gray-900 hover:text-gray-900"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-4 text-center text-xs font-medium tabular-nums">
                            {line.qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => changeQty(line.key, 1)}
                            className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-gray-600 hover:border-gray-900 hover:text-gray-900"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeLine(line.key)}
                            className="text-gray-300 hover:text-red-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="my-4 border-t border-gray-200" />

            {/* Tap NFC — satu slot per tap, urut sesuai keranjang */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Tap Gelang NFC</h3>
                {totalSlots > 0 && (
                  <span className="text-xs font-medium tabular-nums text-gray-500">
                    {filledSlots}/{totalSlots}
                  </span>
                )}
              </div>
              <div className="relative">
                <Radio className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rose-500" />
                <Input
                  id="tap_uid"
                  autoFocus
                  disabled={!nextPendingSlot}
                  placeholder={
                    totalSlots === 0
                      ? "Pilih tiket dulu"
                      : "Fokuskan kursor lalu tap gelang di reader"
                  }
                  value={tapUid}
                  onChange={(e) => setTapUid(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addBand();
                    }
                  }}
                  className="bg-white pl-9 font-mono"
                />
              </div>
              <p className="text-xs text-gray-500">
                {nextPendingSlot
                  ? `Tap berikutnya → ${nextPendingSlot.label}`
                  : totalSlots > 0
                    ? "Semua slot terisi ✓"
                    : "Belum ada tiket dipilih"}
              </p>

              {cart.length > 0 && (
                <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                  {cart.map((line) =>
                    line.uids.map((uid, i) => {
                      const unit = Math.floor(i / slotsPerUnit(line));
                      const memberIdx = i % slotsPerUnit(line);
                      const slotLabel =
                        line.productKind === "bundle"
                          ? `${line.ticketName} · unit ${unit + 1} · ${line.memberLabels[memberIdx]}`
                          : `${line.ticketName} — ${line.variantName} (${i + 1})`;
                      return (
                        <div
                          key={`${line.key}-${i}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-gray-200/70 bg-white px-2.5 py-1.5 text-xs"
                        >
                          <span className="min-w-0 flex-1 truncate text-gray-600">
                            {slotLabel}
                          </span>
                          <span
                            className={`shrink-0 font-mono ${uid ? "text-gray-900" : "text-gray-300"}`}
                          >
                            {uid ?? "— tap —"}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {allUids.length > 0 ? (
                <Badge className="border-0 bg-pink-100 font-normal text-pink-700">
                  {allUids.length} gelang siap
                </Badge>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-gray-200/70 px-6 py-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {mutation.isPending ? "Mendaftarkan…" : "Daftarkan Kunjungan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
