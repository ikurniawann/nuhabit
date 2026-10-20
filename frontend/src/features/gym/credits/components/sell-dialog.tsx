"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { gymCreditsApi, METHOD_LABELS, type CreditPurchase, type MemberCredits, type PaymentMethod } from "../api";
import { priceAt, sellablePackages } from "../pricing";

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
  const active = sellablePackages(packages.data?.packages ?? [], branchId);
  const pkg = active.find((p) => p.id === packageId);
  const price = pkg ? priceAt(pkg, branchId) : 0;
  const discountIdr = method === "complimentary" ? price : Math.min(Number(discount) || 0, price);
  const total = price - discountIdr;
  const arkShort = method === "ark_coin" && total > credits.member.ark_balance_idr;
  const branchOptions = branches.data?.branches ?? [];

  const sell = useMutation({
    mutationFn: () =>
      gymCreditsApi.sell(credits.member.id, {
        package_id: packageId,
        payment_method: method,
        discount_idr: discountIdr,
        note,
        branch_id: branchId || null,
      }),
    onSuccess: (purchase) => {
      toast.success("Paket terjual", {
        description:
          purchase.kind === "pass" ? `${purchase.package_name}: pass ${formatNumber(purchase.validity_days)} hari` : `${purchase.package_name}: +${formatNumber(purchase.credits)} kredit`,
      });
      onDone(purchase);
      onClose();
    },
    onError: (error) => toast.error("Penjualan gagal", { description: error.message }),
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
              <Select value={packageId} onValueChange={(v) => setPackageId(v as string)}>
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
            <Field label="Diskon (Rp)">
              <Input
                type="number"
                min={0}
                value={method === "complimentary" ? String(discountIdr) : discount}
                disabled={method === "complimentary"}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </Field>
            <Field label="Catatan" className="sm:col-span-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="No. struk EDC, nama kasir, dll." />
            </Field>
            <div className="rounded-2xl bg-surface px-4 py-3 sm:col-span-2">
              <p className="text-xs text-muted-foreground">Total dibayar</p>
              <p className="text-2xl font-bold tabular-nums">{formatRupiah(total)}</p>
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
            <Button type="submit" disabled={!pkg || arkShort || sell.isPending}>
              {sell.isPending ? "Menyimpan…" : "Simpan penjualan"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
