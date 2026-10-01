"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChefHat, Clock, Loader2, MapPin, User } from "lucide-react";
import { toast } from "sonner";
import { playNotificationSound } from "@/features/pos/kds/queries";
import { ordersQueryKeys } from "@/features/pos/orders/query-keys";
import type { Order } from "@/lib/pos-api";
import { orderCustomerLabel } from "@/lib/pos/order-customer";
import { selfOrderPaymentFlow, selfOrderTableCode, splitByRecency, timeAgoText } from "@/lib/table-order/incoming";
import { orderTypeText, paymentMethodText } from "@/lib/table-order/order-status";
import { cn } from "@/lib/utils";
import { acceptSelfOrder, fetchIncomingSelfOrders, selfOrdersQueryKey } from "../api";

const rupiah = (value: unknown) => `Rp${Math.round(Number(value) || 0).toLocaleString("id-ID")}`;

type OrderItemLike = {
  id?: string;
  product_name?: string;
  quantity?: number | string;
  variants?: Array<{ name?: string }> | null;
  modifiers?: Array<{ name?: string }> | null;
};

function itemExtras(item: OrderItemLike) {
  return [...(item.variants ?? []), ...(item.modifiers ?? [])]
    .map((entry) => entry?.name)
    .filter(Boolean)
    .join(", ");
}

/** Catatan pemesan dari notes order ("… · Catatan: less ice"). */
function customerNote(order: Order) {
  const match = /Catatan:\s*(.+)$/.exec(String(order.notes || ""));
  return match ? match[1].trim() : null;
}

/**
 * Daftar pesanan self-order baru (belum "Dibuat") — dipakai gelembung
 * notifikasi POS → Orders dan layar HP /dashboard/pos/self-orders.
 * Polling 5 dtk; bunyi saat ada pesanan baru (setelah muatan pertama).
 */
export function useIncomingSelfOrders() {
  const query = useQuery({
    queryKey: selfOrdersQueryKey,
    queryFn: fetchIncomingSelfOrders,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const orders = query.data;
    if (!orders) return;
    const ids = new Set(orders.map((order) => order.id));
    if (seen.current && orders.some((order) => !seen.current!.has(order.id))) playNotificationSound();
    seen.current = ids;
  }, [query.data]);
  return query;
}

export function SelfOrderQueue({
  orders,
  loading,
  highlightId,
  compact = false,
}: {
  orders: Order[];
  loading?: boolean;
  highlightId?: string | null;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const [showOlder, setShowOlder] = useState(false);
  const highlightRef = useRef<HTMLLIElement | null>(null);
  const scrolledFor = useRef<string | null>(null);
  // Pesanan dari link WA "Buatkan Pesanan" → gulir ke kartunya sekali.
  useEffect(() => {
    if (!highlightId || scrolledFor.current === highlightId || !highlightRef.current) return;
    scrolledFor.current = highlightId;
    highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  const accept = useMutation({
    mutationFn: (order: Order) => acceptSelfOrder(order.id),
    onSuccess: async (_data, order) => {
      toast.success(`Antrean ${order.queue_number || order.order_number} dibuat — belum dibayar`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: selfOrdersQueryKey }),
        queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Gagal memproses pesanan");
      void queryClient.invalidateQueries({ queryKey: selfOrdersQueryKey });
    },
  });

  if (loading) {
    return (
      <div className="flex justify-center py-10 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  const { recent, older } = splitByRecency(orders);
  const highlightIsOld = Boolean(highlightId && older.some((order) => order.id === highlightId));
  const visible = showOlder || highlightIsOld ? orders : recent;

  if (orders.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        <ChefHat className="mx-auto mb-2 size-8 opacity-40" />
        Belum ada pesanan self-order baru.
      </div>
    );
  }

  return (
    <div className="space-y-3">
    {recent.length === 0 && !showOlder && !highlightIsOld ? (
      <div className="py-6 text-center text-sm text-muted-foreground">
        <ChefHat className="mx-auto mb-2 size-8 opacity-40" />
        Tidak ada pesanan baru dalam 12 jam terakhir.
      </div>
    ) : null}
    <ul className="space-y-3">
      {visible.map((order) => {
        const items = (order.items ?? []) as OrderItemLike[];
        const note = customerNote(order);
        const busy = accept.isPending && accept.variables?.id === order.id;
        return (
          <li
            key={order.id}
            ref={order.id === highlightId ? highlightRef : undefined}
            className={cn(
              "scroll-mt-24 rounded-xl border bg-white p-3 shadow-sm",
              order.id === highlightId ? "border-primary ring-2 ring-primary/30" : "border-gray-200"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-primary px-2 py-0.5 text-lg font-black tabular-nums text-white">
                    {order.queue_number || "—"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{order.order_number}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <User className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{orderCustomerLabel(order, { withPhone: !compact })}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" />
                    {order.table?.table_number || selfOrderTableCode(order) || "Tanpa meja"}
                  </span>
                  <span>· {orderTypeText(order.order_type)}</span>
                  <span className="inline-flex items-center gap-1">
                    · <Clock className="size-3" /> {timeAgoText(order.ordered_at)}
                  </span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-base font-bold tabular-nums text-foreground">{rupiah(order.total_amount)}</div>
                <div className="text-[11px] font-medium text-amber-700">
                  {paymentMethodText(selfOrderPaymentFlow(order))} · belum dibayar
                </div>
              </div>
            </div>

            <ul className="mt-2 space-y-0.5 border-t border-dashed border-gray-200 pt-2 text-sm">
              {items.map((item, index) => {
                const extras = itemExtras(item);
                return (
                  <li key={item.id ?? index}>
                    <span className="font-semibold tabular-nums">{Number(item.quantity) || 1}×</span>{" "}
                    {item.product_name}
                    {extras ? <span className="text-xs text-muted-foreground"> ({extras})</span> : null}
                  </li>
                );
              })}
            </ul>
            {note ? <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">Catatan: {note}</p> : null}

            <button
              type="button"
              disabled={busy}
              onClick={() => accept.mutate(order)}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-bold text-white shadow-sm transition hover:bg-primary/90 active:scale-[0.99] disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ChefHat className="size-5" />}
              Dibuat
            </button>
          </li>
        );
      })}
    </ul>
    {older.length > 0 && !highlightIsOld ? (
      <button
        type="button"
        onClick={() => setShowOlder((value) => !value)}
        className="w-full rounded-lg border border-dashed border-gray-300 py-2 text-xs font-semibold text-muted-foreground hover:bg-white"
      >
        {showOlder ? "Sembunyikan pesanan lama" : `Tampilkan pesanan lebih lama (${older.length})`}
      </button>
    ) : null}
    </div>
  );
}
