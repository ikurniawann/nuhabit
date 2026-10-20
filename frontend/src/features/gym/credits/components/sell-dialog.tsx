"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Field } from "@/features/crm/engagement/components/shared";
import { formatNumber, formatRupiah } from "@/lib/format";
import { defaultBranchId, useGymBranches } from "@/features/gym/branches";
import { GymApiError } from "@/features/gym/shared";
import {
  gymCreditsApi,
  METHOD_LABELS,
  TILL_METHODS,
  type CreditPurchase,
  type MemberCredits,
  type PaymentMethod,
  type VoucherQuote,
} from "../api";
import { printPurchaseReceipt } from "../print-receipt";
import { priceAt, saleTotal, sellablePackages } from "../pricing";
import { ShiftRequired, useDeskShift } from "./desk-shift";

/**
 * Jual paket di front desk. Cabang awal = cabang staf (atau cabang sesi pada
 * alur drop-in); daftar paket dan harganya mengikuti cabang yang dipilih.
 */
export function SellDialog({
  credits,
  branchId: initialBranchId,
  onClose,
  onDone,
}: {
  credits: MemberCredits;
  branchId?: string | null;
  onClose: () => void;
  onDone: (purchase: CreditPurchase) => void;
}) {
  const packages = useQuery({ queryKey: ["gym-credits", "packages"], queryFn: gymCreditsApi.packages });
  const branches = useGymBranches();
  // null = belum dipilih staf: ikuti cabang awal begitu daftar cabang termuat.
  const [chosenBranch, setChosenBranch] = useState<string | null>(initialBranchId ?? null);
  const branchId = chosenBranch ?? defaultBranchId(branches.data);
  const [packageId, setPackageId] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [discount, setDiscount] = useState("0");
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const [quote, setQuote] = useState<VoucherQuote | null>(null);
  const active = sellablePackages(packages.data?.packages ?? [], branchId);
  const pkg = active.find((p) => p.id === packageId);
  const price = pkg ? priceAt(pkg, branchId) : 0;
  const complimentary = method === "complimentary";
  const { voucher, manual: discountIdr, total } = saleTotal(price, quote?.discount_idr ?? 0, Number(discount) || 0, complimentary);
  const voucherUnchecked = !complimentary && code.trim() !== "" && !quote;
  const arkShort = method === "ark_coin" && total > credits.member.ark_balance_idr;
  const branchOptions = branches.data?.branches ?? [];
  // Tunai, kartu, transfer dan QRIS masuk shift kasir; tunai wajib ada shift.
  const queryClient = useQueryClient();
  const shift = useDeskShift(branchId || null, TILL_METHODS.includes(method));
  const needsShift = method === "cash" && shift.isSuccess && !shift.data;

  const check = useMutation({
    mutationFn: () => gymCreditsApi.previewVoucher(credits.member.id, { package_id: packageId, code: code.trim(), branch_id: branchId || null }),
    onSuccess: setQuote,
    onError: (error) => toast.error("Voucher tidak berlaku", { description: error.message }),
  });
  // A quote is for one package, branch and code; any change asks again.
  const resetVoucher = () => setQuote(null);

  const sell = useMutation({
    mutationFn: () =>
      gymCreditsApi.sell(credits.member.id, {
        package_id: packageId,
        payment_method: method,
        discount_idr: discountIdr,
        note,
        branch_id: branchId || null,
        voucher_code: complimentary || !quote ? null : quote.code,
      }),
    onSuccess: (purchase) => {
      toast.success("Paket terjual", {
        description:
          purchase.kind === "pass" ? `${purchase.package_name}: pass ${formatNumber(purchase.validity_days)} hari` : `${purchase.package_name}: +${formatNumber(purchase.credits)} kredit`,
        action: purchase.receipt_number
          ? {
              label: "Cetak struk",
              onClick: () => void printPurchaseReceipt(purchase.id).catch((e: Error) => toast.error("Struk gagal dicetak", { description: e.message })),
            }
          : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: ["gym-credits", "shift"] });
      onDone(purchase);
      onClose();
    },
    onError: (error) => {
      // The shift may have closed since it was read: show the open-shift prompt.
      if (error instanceof GymApiError && error.code === "SHIFT_REQUIRED") {
        void shift.refetch();
        return;
      }
      toast.error("Penjualan gagal", { description: error.message });
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="md">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            sell.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Jual paket ke {credits.member.name ?? "member"}</DialogPanelTitle>
            <DialogPanelDescription>Terima pembayaran di kasir dulu. Kredit langsung masuk setelah disimpan.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {branchOptions.length > 0 && (
              <Field label="Cabang penjualan" className="sm:col-span-2" hint="Harga dan paket khusus cabang mengikuti pilihan ini.">
                <Select
                  value={branchId}
                  onValueChange={(v) => {
                    setChosenBranch(v as string);
                    setPackageId("");
                    resetVoucher();
                  }}
                >
                  <SelectTrigger aria-label="Cabang penjualan">
                    <SelectValue placeholder="Pilih cabang" />
                  </SelectTrigger>
                  <SelectContent>
                    {branchOptions.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label="Paket" className="sm:col-span-2">
              <Select
                value={packageId}
                onValueChange={(v) => {
                  setPackageId(v as string);
                  resetVoucher();
                }}
              >
                <SelectTrigger aria-label="Paket">
                  <SelectValue placeholder={packages.isLoading ? "Memuat paket…" : "Pilih paket"} />
                </SelectTrigger>
                <SelectContent>
                  {active.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.kind === "pass" ? `Pass ${formatNumber(p.validity_days)} hari` : `${formatNumber(p.credits)} kredit`} ·{" "}
                      {formatRupiah(priceAt(p, branchId))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Metode bayar">
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger aria-label="Metode bayar">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {METHOD_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Diskon manual (Rp)" hint={voucher > 0 ? "Dipotong setelah voucher." : undefined}>
              <Input
                type="number"
                min={0}
                value={complimentary ? String(discountIdr) : discount}
                disabled={complimentary}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </Field>
            {!complimentary && (
              <Field
                label="Kode voucher"
                className="sm:col-span-2"
                hint={quote ? `${quote.label}: potongan ${formatRupiah(voucher)}` : "Opsional. Cek dulu sebelum menyimpan."}
              >
                <div className="flex gap-2">
                  <Input
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase());
                      resetVoucher();
                    }}
                    placeholder="Contoh: GYM10"
                    aria-label="Kode voucher"
                    autoCapitalize="characters"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!pkg || code.trim() === "" || !!quote || check.isPending}
                    onClick={() => check.mutate()}
                  >
                    {check.isPending ? "Mengecek…" : quote ? "Berlaku" : "Cek"}
                  </Button>
                </div>
              </Field>
            )}
            <Field label="Catatan" className="sm:col-span-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="No. struk EDC, nama kasir, dll." />
            </Field>
            {needsShift ? (
              <ShiftRequired
                branchId={branchId || null}
                className="sm:col-span-2"
                message="Belum ada shift kasir di cabang ini. Buka shift dulu untuk menerima tunai."
              />
            ) : (
              TILL_METHODS.includes(method) &&
              shift.isSuccess && (
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  {shift.data ? (
                    <>
                      Masuk shift kasir <span className="font-mono">{shift.data.shift_number}</span>.
                    </>
                  ) : (
                    "Belum ada shift kasir: penjualan ini tidak masuk shift mana pun."
                  )}
                </p>
              )
            )}
            <div className="rounded-2xl bg-surface px-4 py-3 sm:col-span-2">
              <p className="text-xs text-muted-foreground">Total dibayar</p>
              <p className="text-2xl font-bold tabular-nums">{formatRupiah(total)}</p>
              {voucher > 0 && (
                <p className="text-xs text-muted-foreground">
                  Voucher {quote?.code} −{formatRupiah(voucher)}
                  {discountIdr > 0 ? ` · diskon manual −${formatRupiah(discountIdr)}` : ""}
                </p>
              )}
              {pkg && price !== pkg.price_idr && (
                <p className="text-xs text-muted-foreground">Harga cabang · harga dasar {formatRupiah(pkg.price_idr)}</p>
              )}
              {method === "ark_coin" && (
                <p className={cn("text-xs", arkShort ? "text-danger" : "text-muted-foreground")}>
                  Saldo ARK Coin {formatRupiah(credits.member.ark_balance_idr)}
                  {arkShort ? " · tidak cukup" : ""}
                </p>
              )}
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!pkg || arkShort || needsShift || voucherUnchecked || sell.isPending}>
              {sell.isPending ? "Menyimpan…" : "Simpan penjualan"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
