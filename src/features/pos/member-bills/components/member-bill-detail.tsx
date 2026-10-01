"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Loader2, Phone, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatKitchenStatusLabel } from "@/features/pos/reports/utils/transaction-labels";
import { cn } from "@/lib/utils";
import { fetchMemberBillDetail, memberBillKeys, settleMemberBill } from "../api";
import { formatDateTimeWib, formatIdr, orderTypeLabel } from "../format";
import { PayMemberBillDialog } from "./pay-member-bill-dialog";

type Tab = "open" | "payments" | "settled";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "primary" | "muted" }) {
  return (
    <div className="rounded-xl border border-gray-200/70 bg-white px-4 py-3 dark:bg-card">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-lg font-bold tabular-nums",
          tone === "primary" ? "text-primary sm:text-2xl" : "text-foreground"
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function MemberBillDetailPanel({ customerId, onBack }: { customerId: string; onBack?: () => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("open");
  const [payOpen, setPayOpen] = useState(false);
  const detailQuery = useQuery({
    queryKey: memberBillKeys.detail(customerId),
    queryFn: () => fetchMemberBillDetail(customerId),
  });
  const settle = useMutation({
    mutationFn: () => settleMemberBill(customerId),
    onSuccess: (result) => {
      toast.success(`Tagihan ditutup — ${result.settled_order_count} order lunas dari saldo`);
      void queryClient.invalidateQueries({ queryKey: memberBillKeys.all });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Memuat tagihan…
      </div>
    );
  }
  if (detailQuery.error || !detailQuery.data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
        {(detailQuery.error as Error | null)?.message || "Tagihan tidak ditemukan"}
      </div>
    );
  }

  const detail = detailQuery.data;
  const { balance } = detail;
  const tabs: { value: Tab; label: string; count: number }[] = [
    { value: "open", label: "Belum lunas", count: detail.open_orders.length },
    { value: "payments", label: "Riwayat bayar", count: detail.payments.length },
    { value: "settled", label: "Order lunas", count: detail.settled_orders.length },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {onBack ? (
            <Button type="button" variant="outline" size="icon" className="md:hidden" onClick={onBack} aria-label="Kembali ke daftar">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : null}
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-foreground">{detail.customer.name}</h2>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {detail.customer.phone ? (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" /> {detail.customer.phone}
                </span>
              ) : null}
              {detail.customer.membership_tier ? (
                <Badge variant="outline" className="capitalize">
                  {detail.customer.membership_tier}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {balance.canSettle && balance.outstanding === 0 ? (
            <Button type="button" variant="outline" disabled={settle.isPending} onClick={() => settle.mutate()}>
              {settle.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Tutup tagihan dari saldo
            </Button>
          ) : null}
          <Button type="button" size="lg" disabled={balance.outstanding <= 0} onClick={() => setPayOpen(true)}>
            <Wallet className="h-4 w-4" /> Bayar
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={`Total order belum lunas (${detail.open_orders.length})`} value={formatIdr(balance.openTotal)} />
        <Stat label="Sudah dibayar (saldo cicilan)" value={formatIdr(balance.credit)} />
        <Stat label="Sisa tagihan" value={formatIdr(balance.outstanding)} tone="primary" />
      </div>
      {balance.surplus > 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          Saldo cicilan lebih {formatIdr(balance.surplus)} dari order terbuka — akan dipakai untuk order berikutnya.
        </p>
      ) : null}

      <div role="tablist" className="flex flex-wrap gap-1.5 border-b border-gray-200/70 pb-2">
        {tabs.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={tab === entry.value}
            onClick={() => setTab(entry.value)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition",
              tab === entry.value
                ? "bg-primary text-primary-foreground"
                : "text-gray-600 hover:bg-muted dark:text-gray-300"
            )}
          >
            {entry.label}
            <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", tab === entry.value ? "bg-white/25" : "bg-muted")}>
              {entry.count}
            </span>
          </button>
        ))}
      </div>

      {tab === "open" ? (
        detail.open_orders.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada order yang belum lunas.</p>
        ) : (
          <ul className="space-y-2">
            {detail.open_orders.map((order) => (
              <li key={order.id} className="rounded-xl border border-gray-200/70 bg-white p-3 dark:bg-card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-semibold text-foreground">
                      {order.order_number || order.id.slice(0, 8)}
                      {order.queue_number ? (
                        <span className="ml-2 font-sans text-xs font-medium text-primary">Antrian {order.queue_number}</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTimeWib(order.ordered_at)} · {orderTypeLabel(order.order_type)} ·{" "}
                      {formatKitchenStatusLabel(order.status)}
                    </div>
                  </div>
                  <div className="text-base font-bold tabular-nums text-foreground">{formatIdr(order.total_amount)}</div>
                </div>
                {order.items.length ? (
                  <ul className="mt-2 space-y-0.5 border-t border-gray-100 pt-2 text-sm dark:border-gray-800">
                    {order.items.map((item, index) => (
                      <li key={index} className="flex justify-between gap-3">
                        <span className="min-w-0 text-gray-700 dark:text-gray-200">
                          <span className="font-semibold">{item.quantity}×</span> {item.name}
                          {item.options.length ? (
                            <span className="text-xs text-muted-foreground"> ({item.options.join(", ")})</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{formatIdr(item.total_amount)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "payments" ? (
        detail.payments.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada pembayaran.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200/70 bg-white dark:divide-gray-800 dark:bg-card">
            {detail.payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">
                    {payment.payment_method_name || payment.payment_method}
                    {payment.settlement_id ? (
                      <Badge variant="outline" className="ml-2 border-emerald-300 text-emerald-700">
                        menutup tagihan
                      </Badge>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDateTimeWib(payment.created_at)}
                    {payment.received_by_name ? ` · ${payment.received_by_name}` : ""}
                    {payment.reference_number ? ` · Ref ${payment.reference_number}` : ""}
                    {payment.notes ? ` · ${payment.notes}` : ""}
                  </div>
                </div>
                <div className="text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                  +{formatIdr(payment.amount)}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "settled" ? (
        detail.settled_orders.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada order yang dilunasi lewat tagihan.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200/70 bg-white dark:divide-gray-800 dark:bg-card">
            {detail.settled_orders.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-mono text-sm font-semibold text-foreground">{order.order_number || order.id.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">
                    Order {formatDateTimeWib(order.ordered_at)} · Lunas {formatDateTimeWib(order.settled_at)}
                  </div>
                </div>
                <div className="text-sm font-semibold tabular-nums text-foreground">{formatIdr(order.total_amount)}</div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <PayMemberBillDialog open={payOpen} detail={detail} onOpenChange={setPayOpen} />
    </div>
  );
}
