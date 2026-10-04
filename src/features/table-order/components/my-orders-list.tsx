"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { orderNeedsAttention, unpaidTotal } from "@/lib/table-order/my-orders";
import {
  orderProgressStep,
  orderStatusText,
  orderTypeText,
  paymentStatusText,
} from "@/lib/table-order/order-status";
import { fetchOrder, type OrderData } from "../api";
import { formatRupiah } from "@/lib/format";

const POLL_MS = 20_000;

function statusTone(order: OrderData) {
  const step = orderProgressStep(order.status);
  if (step < 0) return "bg-red-500";
  if (step >= 4) return "bg-emerald-500";
  if (step >= 3) return "bg-sky-500";
  return "bg-amber-500";
}

/**
 * Daftar semua pesanan pemesan di meja ini (owner 2026-10-01) — terbaru di
 * atas; ketuk satu pesanan untuk melihat status lengkap.
 */
export function MyOrdersList({
  orders,
  tableLabel,
  brandName,
  onSelect,
  onOrdersUpdate,
  onNewOrder,
}: {
  orders: OrderData[];
  tableLabel: string;
  brandName: string;
  onSelect: (order: OrderData) => void;
  onOrdersUpdate: (orders: OrderData[]) => void;
  onNewOrder: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const anyActive = orders.some(orderNeedsAttention);
  const outstanding = unpaidTotal(orders);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await Promise.all(orders.map((order) => fetchOrder(order.id).catch(() => order)));
      onOrdersUpdate(next);
    } finally {
      setRefreshing(false);
    }
  }, [orders, onOrdersUpdate]);

  useEffect(() => {
    if (!anyActive) return;
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [anyActive, refresh]);

  return (
    <div className="pb-28">
      <div className="bg-primary px-5 pb-14 pt-6 text-primary-foreground">
        <div className="text-xs font-semibold uppercase tracking-wide text-white/70">{brandName}</div>
        <div className="mt-1 text-sm text-white/80">Meja {tableLabel}</div>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div className="text-2xl font-black">Pesanan saya ({orders.length})</div>
          {outstanding > 0 ? (
            <div className="text-right">
              <div className="text-xs text-white/70">Belum dibayar</div>
              <div className="text-lg font-bold">{formatRupiah(outstanding)}</div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="-mt-8 space-y-3 px-4">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-brand-text shadow"
          >
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Perbarui
          </button>
        </div>
        {orders.map((order) => {
          const paid = order.payment_status === "paid";
          const items = order.items.map((item) => `${item.quantity}× ${item.product_name}`).join(", ");
          return (
            <button
              key={order.id}
              type="button"
              onClick={() => onSelect(order)}
              className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-md shadow-black/5 active:scale-[0.99]"
            >
              <div className="flex w-14 shrink-0 flex-col items-center">
                <span className="text-[10px] font-semibold uppercase text-gray-400">Antrean</span>
                <span className="text-2xl font-black leading-none text-gray-900">{order.queue_number || "—"}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                  <span className={`size-2 shrink-0 rounded-full ${statusTone(order)}`} />
                  <span className="truncate">{orderStatusText(order.status)}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-gray-500">
                  {order.order_number || order.id.slice(0, 8)} · {orderTypeText(order.order_type)}
                </div>
                {items ? <div className="mt-1 line-clamp-2 text-xs text-gray-600">{items}</div> : null}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      paid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {paymentStatusText(order.payment_status)}
                  </span>
                  <span className="text-sm font-bold tabular-nums text-gray-900">{formatRupiah(order.total_amount)}</span>
                </div>
              </div>
              <ChevronRight className="size-5 shrink-0 text-gray-300" />
            </button>
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-100 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto max-w-md">
          <button
            type="button"
            onClick={onNewOrder}
            className="h-12 w-full rounded-xl border-2 border-primary text-sm font-bold text-brand-text"
          >
            Pesan lagi
          </button>
        </div>
      </div>
    </div>
  );
}
