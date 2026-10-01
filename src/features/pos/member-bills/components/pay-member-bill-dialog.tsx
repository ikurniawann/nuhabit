"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banknote, CreditCard, Loader2, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { formatIdrInput, parseIdrDigits } from "@/components/pos/idr-input";
import { usePosShift } from "@/hooks/use-pos-shift";
import { isMemberBillMethod, validateMemberBillAmount } from "@/lib/pos/member-bill";
import { cn } from "@/lib/utils";
import {
  fetchPaymentMethods,
  memberBillKeys,
  payMemberBill,
  type MemberBillDetail,
} from "../api";
import { formatIdr } from "../format";

/** Kasir default (sama dengan halaman Kasir) — shift aktif bila manajemen shift menyala. */
const CASHIER_ID = "00000000-0000-0000-0000-000000000001";

function MethodIcon({ handler }: { handler: string }) {
  if (handler === "qris") return <QrCode className="h-5 w-5" />;
  if (handler === "credit") return <CreditCard className="h-5 w-5" />;
  return <Banknote className="h-5 w-5" />;
}

export function PayMemberBillDialog({
  open,
  detail,
  onOpenChange,
}: {
  open: boolean;
  detail: MemberBillDetail;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { shift } = usePosShift(CASHIER_ID);
  const outstanding = detail.balance.outstanding;
  const [amountText, setAmountText] = useState("");
  const [methodCode, setMethodCode] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const methodsQuery = useQuery({
    queryKey: ["pos", "payment-methods", "member-bill"],
    queryFn: fetchPaymentMethods,
    enabled: open,
    staleTime: 60_000,
  });
  const methods = useMemo(
    () => (methodsQuery.data ?? []).filter((method) => method.is_active && isMemberBillMethod(method)),
    [methodsQuery.data]
  );
  const method = methods.find((entry) => entry.code === methodCode) ?? null;

  const amount = parseIdrDigits(amountText);
  const amountError = amountText ? validateMemberBillAmount(amount, outstanding) : null;
  const remaining = Math.max(0, outstanding - amount);
  const canSubmit = amount > 0 && !amountError && Boolean(method);

  const quickAmounts = [
    { label: "Lunas", value: outstanding },
    { label: "50%", value: Math.ceil(outstanding / 2 / 1000) * 1000 },
    ...[100_000, 200_000, 500_000].map((value) => ({ label: formatIdr(value), value })),
  ].filter((option, index, list) =>
    option.value > 0 &&
    option.value <= outstanding &&
    list.findIndex((other) => other.value === option.value) === index
  );

  const reset = () => {
    setAmountText("");
    setMethodCode(null);
    setReference("");
    setNotes("");
  };

  const mutation = useMutation({
    mutationFn: () =>
      payMemberBill(detail.customer.id, {
        amount,
        payment_method_code: method!.code,
        reference_number: reference.trim() || null,
        notes: notes.trim() || null,
        shift_id: shift?.id ?? null,
      }),
    onSuccess: (result) => {
      if (result.settled_order_count > 0) {
        toast.success(`Tagihan lunas — ${result.settled_order_count} order ditutup`);
      } else {
        toast.success(`Pembayaran ${formatIdr(amount)} diterima. Sisa ${formatIdr(result.balance.outstanding)}`);
      }
      if (result.notes.length) toast.message(`Akuntansi: ${result.notes.join("; ")}`);
      void queryClient.invalidateQueries({ queryKey: memberBillKeys.all });
      reset();
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && mutation.isPending) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>Bayar tagihan {detail.customer.name}</DialogPanelTitle>
          <DialogPanelDescription>
            Sisa tagihan {formatIdr(outstanding)} · bisa dibayar sebagian
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="member-bill-amount" className="text-sm font-semibold text-foreground">
              Nominal dibayar
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-semibold text-muted-foreground">
                Rp
              </span>
              <input
                id="member-bill-amount"
                inputMode="numeric"
                value={amountText}
                onChange={(event) => setAmountText(formatIdrInput(event.target.value))}
                placeholder="0"
                className={cn(
                  "h-14 w-full rounded-xl border bg-background pl-11 pr-3 text-2xl font-bold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  amountError ? "border-red-400" : "border-gray-200"
                )}
              />
            </div>
            {amountError ? <p className="text-xs font-medium text-red-600">{amountError}</p> : null}
            <div className="flex flex-wrap gap-2">
              {quickAmounts.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setAmountText(formatIdrInput(option.value))}
                  className={cn(
                    "h-9 rounded-lg border px-3 text-sm font-semibold transition",
                    amount === option.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-gray-200 text-gray-700 hover:border-primary/40 dark:text-gray-200"
                  )}
                >
                  {option.label === "Lunas" ? `Lunas ${formatIdr(option.value)}` : option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">Metode bayar</div>
            {methodsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Memuat metode bayar…
              </div>
            ) : methods.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada metode bayar aktif (POS → Loyalty → Metode Bayar).
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {methods.map((entry) => (
                  <button
                    key={entry.code}
                    type="button"
                    aria-pressed={entry.code === methodCode}
                    onClick={() => setMethodCode(entry.code)}
                    className={cn(
                      "flex min-h-14 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition",
                      entry.code === methodCode
                        ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/30"
                        : "border-gray-200 text-gray-800 hover:border-primary/40 dark:text-gray-100"
                    )}
                  >
                    <MethodIcon handler={entry.handler} />
                    <span className="min-w-0 truncate">{entry.name}</span>
                  </button>
                ))}
              </div>
            )}
            {method && method.handler === "qris" ? (
              <p className="text-xs text-amber-700">
                Pastikan dana QRIS sudah masuk sebelum menyimpan — dicatat sebagai konfirmasi kasir.
              </p>
            ) : null}
          </div>

          {method && method.handler !== "cash" ? (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground">No. referensi (opsional)</span>
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value.slice(0, 80))}
                placeholder="mis. kode approval EDC / ID transfer"
                className="h-10 w-full rounded-lg border border-gray-200 bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          ) : null}

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">Catatan (opsional)</span>
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value.slice(0, 300))}
              placeholder="mis. cicilan minggu 1"
              className="h-10 w-full rounded-lg border border-gray-200 bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          {amount > 0 && !amountError ? (
            <div
              className={cn(
                "rounded-xl px-4 py-3 text-sm font-medium",
                remaining === 0
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : "bg-muted/60 text-foreground"
              )}
            >
              {remaining === 0
                ? `Tagihan lunas — ${detail.open_orders.length} order akan ditutup.`
                : `Setelah dibayar, sisa tagihan ${formatIdr(remaining)}. Order tetap terbuka sampai lunas.`}
            </div>
          ) : null}
        </DialogPanelBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Batal
          </Button>
          <Button type="button" disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {amount > 0 ? `Terima ${formatIdr(amount)}` : "Terima pembayaran"}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
