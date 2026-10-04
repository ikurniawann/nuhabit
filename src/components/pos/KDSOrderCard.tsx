'use client';

import { useEffect, useRef, useState } from 'react';
import { ChefHat, CheckCircle2, ArrowRight, Utensils, Flame, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isTerminalKitchenStatus } from '@/lib/pos/kds-status';

import type { KDSOrder, KDSOrderItem } from "@/lib/pos/kds-types";

interface KDSOrderCardProps {
  order: KDSOrder;
  onStatusChange: (
    orderId: string,
    newStatus: string,
    itemIds?: string[]
  ) => void | Promise<void>;
  index: number;
}

const STATUS_FLOW: Record<string, string> = {
  pending: 'confirmed',
  confirmed: 'preparing',
  preparing: 'ready',
  ready: 'served',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Tunggu',
  confirmed: 'Konfirmasi',
  preparing: 'Proses',
  ready: 'Siap',
  served: 'Sajikan',
};

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  pending: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-900', badge: 'bg-amber-100 text-amber-700' },
  confirmed: { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-900', badge: 'bg-blue-100 text-blue-700' },
  preparing: { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-900', badge: 'bg-orange-100 text-orange-700' },
  ready: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-900', badge: 'bg-green-100 text-green-700' },
  served: { bg: 'bg-gray-50', border: 'border-gray-300', text: 'text-gray-700', badge: 'bg-gray-100 text-gray-600' },
};

const ACTION_BUTTON_COLORS: Record<string, string> = {
  confirmed: 'bg-blue-600 hover:bg-blue-700 text-white',
  preparing: 'bg-orange-500 hover:bg-orange-600 text-white',
  ready: 'bg-green-600 hover:bg-green-700 text-white',
  served: 'bg-pink-600 hover:bg-pink-700 text-white',
};

const STATION_LABELS: Record<string, string> = {
  kitchen: 'Kitchen',
  bar: 'Bar',
  bakery: 'Bakery',
  dessert: 'Dessert',
  merchandise: 'Merch',
  photobooth: 'Photo',
};

function formatWaitTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 1) return `${s}d`;
  if (m < 60) return `${m}m ${s}d`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}j ${rem}m`;
}

function itemKitchenStatus(item: KDSOrderItem): string {
  return String(item.kitchen_status || 'pending').toLowerCase();
}

export function KDSOrderCard({ order, onStatusChange, index }: KDSOrderCardProps) {
  const displayStatus = order.station_status || order.status;
  const colors = STATUS_COLORS[displayStatus] || STATUS_COLORS.pending;
  const nextStatus = STATUS_FLOW[displayStatus];
  const paid = String(order.payment_status || '').toLowerCase() === 'paid';
  const actionButtonClass = nextStatus ? ACTION_BUTTON_COLORS[nextStatus] || 'bg-gray-900 hover:bg-gray-800 text-white' : '';
  const [elapsed, setElapsed] = useState(order.wait_seconds);
  const [updatingOrder, setUpdatingOrder] = useState(false);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const activeItems = (order.pos_order_items || []).filter(
    (item) => !isTerminalKitchenStatus(item.kitchen_status)
  );

  const handleBumpOrder = async () => {
    if (!nextStatus || updatingOrder || updatingItemId) return;
    setUpdatingOrder(true);
    try {
      await onStatusChange(order.id, nextStatus);
    } finally {
      setUpdatingOrder(false);
    }
  };

  const handleBumpItem = async (item: KDSOrderItem) => {
    const status = itemKitchenStatus(item);
    const next = STATUS_FLOW[status];
    if (!next || updatingOrder || updatingItemId) return;
    setUpdatingItemId(item.id);
    try {
      await onStatusChange(order.id, next, [item.id]);
    } finally {
      setUpdatingItemId(null);
    }
  };

  useEffect(() => {
    // Keep the kitchen ticket timer aligned when polling returns a fresh wait value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setElapsed(order.wait_seconds);
    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [order.wait_seconds]);

  const bgPulse = order.is_overdue ? 'animate-pulse' : '';
  const isUrgent = order.is_urgent || order.is_overdue;
  const busy = updatingOrder || Boolean(updatingItemId);

  return (
    <div
      className={`relative flex flex-col rounded-xl border-2 ${colors.border} ${colors.bg} p-4 shadow-sm transition-all hover:shadow-md ${bgPulse}`}
      style={{ animationDelay: `${index * 100}ms` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide ${colors.badge}`}>
            {STATUS_LABELS[displayStatus] || displayStatus}
          </span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
              paid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}
          >
            {paid ? 'Lunas' : 'Open'}
          </span>
          {isUrgent && (
            <Flame className="w-4 h-4 text-red-500 animate-bounce" />
          )}
        </div>
        <div className="text-right">
          <p className={`text-3xl font-black tabular-nums leading-none ${isUrgent ? 'text-red-600' : colors.text}`}>
            {order.queue_number || '—'}
          </p>
          <p className="mt-1 text-[10px] text-gray-500">No. Antrian</p>
          <p className={`text-xs font-semibold ${isUrgent ? 'text-red-600' : colors.text}`}>
            {formatWaitTime(elapsed)}
          </p>
          <p className="text-[10px] text-gray-500 font-mono">{order.order_number}</p>
        </div>
      </div>

      {/* Items — per-line siap / sajikan */}
      <div className="mb-4 flex-1 space-y-1.5">
        {activeItems.map((item) => {
          const itemStatus = itemKitchenStatus(item);
          const itemColors = STATUS_COLORS[itemStatus] || STATUS_COLORS.pending;
          const itemNext = STATUS_FLOW[itemStatus];
          const itemBusy = updatingItemId === item.id;
          const isReady = itemStatus === 'ready';

          return (
            <div
              key={item.id}
              className={cn(
                'flex items-start justify-between gap-2 rounded-lg border px-2 py-1.5 text-sm',
                isReady
                  ? 'border-emerald-300/80 bg-emerald-50/90'
                  : 'border-gray-200/70 bg-white/60'
              )}
            >
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <span
                  className={cn(
                    'inline-flex h-6 min-w-[24px] items-center justify-center rounded border text-xs font-bold',
                    itemColors.bg,
                    itemColors.text,
                    itemColors.border
                  )}
                >
                  {item.quantity}
                </span>
                <div className="min-w-0">
                  <p className="leading-tight font-semibold text-gray-900">{item.product_name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                        itemColors.badge
                      )}
                    >
                      {STATUS_LABELS[itemStatus] || itemStatus}
                    </span>
                    {item.station && (
                      <span className="inline-flex rounded-full bg-gray-900/5 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                        {STATION_LABELS[item.station] || item.station}
                      </span>
                    )}
                  </div>
                  {(item.variant_info || item.modifier_info) && (
                    <p className="mt-0.5 text-[10px] text-gray-500">
                      {item.variant_info} {item.modifier_info}
                    </p>
                  )}
                  {item.notes && (
                    <p className="mt-0.5 text-[10px] italic text-amber-600">&quot;{item.notes}&quot;</p>
                  )}
                </div>
              </div>

              {itemNext ? (
                <Button
                  size="sm"
                  type="button"
                  disabled={busy}
                  onClick={() => void handleBumpItem(item)}
                  className={cn(
                    'h-7 shrink-0 gap-1 px-2 text-[11px] shadow-xs',
                    ACTION_BUTTON_COLORS[itemNext] || 'bg-gray-900 text-white hover:bg-gray-800'
                  )}
                  title={`${STATUS_LABELS[itemNext] || itemNext}: ${item.product_name}`}
                >
                  {itemBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : itemNext === 'ready' ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <ArrowRight className="h-3 w-3" />
                  )}
                  {STATUS_LABELS[itemNext] || itemNext}
                </Button>
              ) : null}
            </div>
          );
        })}
        {activeItems.length === 0 && (
          <p className="py-2 text-center text-xs text-gray-500">Semua item sudah disajikan</p>
        )}
      </div>

      {/* Footer — bump seluruh tiket / station */}
      <div className="flex items-center justify-between border-t border-dashed border-gray-300 pt-2">
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          {order.order_type === 'dine_in' ? (
            <Utensils className="h-3.5 w-3.5" />
          ) : (
            <ChefHat className="h-3.5 w-3.5" />
          )}
          <span className="capitalize">{order.order_type.replace('_', ' ')}</span>
          {(order.table_label || order.table_id) && (
            <span className="text-gray-400">· {order.table_label || `Meja ${order.table_id?.slice(0, 8)}`}</span>
          )}
        </div>

        {nextStatus && activeItems.length > 0 ? (
          <Button
            size="sm"
            onClick={() => void handleBumpOrder()}
            disabled={busy}
            className={`${actionButtonClass} h-8 gap-1 px-3 text-xs shadow-sm`}
            title="Semua item aktif di tiket ini"
          >
            {updatingOrder ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : nextStatus === 'ready' ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <ArrowRight className="h-3.5 w-3.5" />
            )}
            {updatingOrder ? 'Menyimpan...' : `Semua → ${STATUS_LABELS[nextStatus] || nextStatus}`}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled
            className="h-8 px-3 text-xs"
          >
            <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-green-600" /> Selesai
          </Button>
        )}
      </div>

      {/* Overdue warning overlay */}
      {order.is_overdue && (
        <div className="absolute inset-x-0 top-0 h-1 rounded-t-xl bg-red-500" />
      )}
    </div>
  );
}
