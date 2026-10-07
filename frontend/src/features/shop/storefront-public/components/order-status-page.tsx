'use client';

// Public order status page (the Xendit redirect lands here). Polls lightly
// while the order is pending so the paid status shows without a manual
// refresh.

import { CheckCircle2, Clock, Loader2, Package, Truck, XCircle } from 'lucide-react';
import { formatRupiah } from '@/lib/format';
import { useShopOrderStatus } from '../queries';

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Awaiting Payment', tone: 'bg-amber-50 text-amber-700' },
  paid: { label: 'Paid, Being Prepared', tone: 'bg-green-50 text-green-700' },
  packing: { label: 'Packing', tone: 'bg-blue-50 text-blue-700' },
  shipped: { label: 'Shipped', tone: 'bg-indigo-50 text-indigo-700' },
  completed: { label: 'Completed', tone: 'bg-green-50 text-green-700' },
  cancelled: { label: 'Cancelled', tone: 'bg-red-50 text-red-600' },
  refund: { label: 'Refunded', tone: 'bg-gray-100 text-gray-600' },
};

export function ShopOrderStatusPage({ token }: { token: string }) {
  const { data: order, error } = useShopOrderStatus(token);

  if (error && !order) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-gray-50 px-6 text-center">
        <XCircle className="h-10 w-10 text-red-300" />
        <p className="text-sm text-gray-500">{error.message || 'Could not load the order'}</p>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-pink-500" />
      </div>
    );
  }

  const status = STATUS_LABEL[order.status] ?? {
    label: order.status,
    tone: 'bg-gray-100 text-gray-600',
  };
  const StatusIcon =
    order.status === 'pending'
      ? Clock
      : order.status === 'shipped'
        ? Truck
        : order.status === 'cancelled'
          ? XCircle
          : CheckCircle2;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">Order</p>
              <h1 className="text-lg font-semibold text-gray-900">{order.order_number}</h1>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${status.tone}`}
            >
              <StatusIcon className="h-3.5 w-3.5" />
              {status.label}
            </span>
          </div>

          {order.status === 'pending' && order.invoice_url ? (
            <a
              href={order.invoice_url}
              className="mb-4 block rounded-lg bg-pink-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-pink-700"
            >
              Continue to Payment
            </a>
          ) : null}

          {order.waybill ? (
            <p className="mb-4 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
              Tracking number: <span className="font-semibold">{order.waybill}</span>
              {order.courier ? ` (${order.courier})` : ''}
            </p>
          ) : null}

          <div className="space-y-2 border-t border-gray-100 pt-4">
            {order.items.map((item, index) => (
              <div key={index} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">
                  {item.name} <span className="text-gray-400">× {item.quantity}</span>
                </span>
                <span className="text-gray-900">{formatRupiah(item.total)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-gray-100 pt-2 text-sm">
              <span className="text-gray-500">Shipping{order.courier ? ` (${order.courier})` : ''}</span>
              <span className="text-gray-900">{formatRupiah(order.shipping_cost)}</span>
            </div>
            <div className="flex items-center justify-between text-base font-semibold">
              <span>Total</span>
              <span className="text-pink-600">{formatRupiah(order.total)}</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 text-sm shadow-sm">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
            <Package className="h-3.5 w-3.5" /> Shipping Address
          </p>
          <p className="font-medium text-gray-900">{order.customer_name}</p>
          <p className="text-gray-600">{order.shipping_address}</p>
          {order.shipping_area_label ? (
            <p className="text-gray-500">{order.shipping_area_label}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
