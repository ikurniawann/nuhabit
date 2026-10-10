'use client';

// Public order status page (the Xendit redirect and the ARK Coin checkout
// land here). Polls lightly while the order is pending so the paid status
// shows without a manual refresh. A signed-in member rates paid items here.

import { Check, CheckCircle2, Clock, Loader2, MapPin, MessageCircle, Package, Store, Truck, XCircle } from 'lucide-react';
import Link from 'next/link';
import { formatRupiah } from '@/lib/format';
import { formatDateTimeEn } from '@/lib/shop/format-en';
import { orderStepIndex, orderSteps } from '@/lib/shop/order-steps';
import type { PublicOrderStatus } from '@/lib/shop/types';
import { useShopOrderStatus } from '../queries';
import { ReviewForm } from './review-form';

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Awaiting Payment', tone: 'bg-lemon text-forest' },
  paid: { label: 'Paid, Being Prepared', tone: 'bg-lettuce/30 text-forest' },
  packing: { label: 'Packing', tone: 'bg-white text-everglade' },
  shipped: { label: 'Shipped', tone: 'bg-everglade/15 text-everglade' },
  ready_for_pickup: { label: 'Ready for Pickup', tone: 'bg-lettuce/30 text-forest' },
  picked_up: { label: 'Picked Up', tone: 'bg-forest text-mint' },
  completed: { label: 'Completed', tone: 'bg-forest text-mint' },
  cancelled: { label: 'Cancelled', tone: 'bg-red-50 text-red-600' },
  refund: { label: 'Refunded', tone: 'bg-gray-100 text-gray-600' },
};

const STATUS_ICON: Record<string, typeof Clock> = {
  pending: Clock,
  shipped: Truck,
  ready_for_pickup: Store,
  cancelled: XCircle,
};

export function ShopOrderStatusPage({ token }: { token: string }) {
  const { data: order, error } = useShopOrderStatus(token);

  if (error && !order) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-white px-6 text-center">
        <XCircle className="h-10 w-10 text-red-300" />
        <p className="text-sm text-gray-500">{error.message || 'Could not load the order'}</p>
        <Link href="/" className="mt-4 rounded-full bg-lime px-5 py-2.5 text-sm font-semibold text-forest">Back to Home</Link>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-forest" />
      </div>
    );
  }

  const status = STATUS_LABEL[order.status] ?? { label: order.status, tone: 'bg-gray-100 text-gray-600' };
  const StatusIcon = STATUS_ICON[order.status] ?? CheckCircle2;
  const pickup = order.delivery.method === 'pickup';

  return (
    <div className="min-h-screen bg-white px-4 py-8">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="rounded-2xl border border-forest/10 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">Order</p>
              <h1 className="text-lg font-semibold text-gray-900">{order.order_number}</h1>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${status.tone}`}>
              <StatusIcon className="h-3.5 w-3.5" />
              {status.label}
            </span>
          </div>

          {order.status === 'pending' && order.invoice_url ? (
            <a href={order.invoice_url} className="mb-4 block rounded-lg bg-lime px-4 py-3 text-center text-sm font-semibold text-forest hover:bg-lemon">
              Continue to Payment
            </a>
          ) : null}

          <OrderSteps order={order} />

          {order.waybill ? (
            <p className="mb-4 rounded-lg border border-forest/10 bg-white px-3 py-2 text-sm text-everglade">
              Tracking number: <span className="font-semibold">{order.waybill}</span>
              {order.courier ? ` (${order.courier})` : ''}
            </p>
          ) : null}

          <div className="space-y-2 border-t border-gray-100 pt-4">
            {order.items.map((item, index) => (
              <div key={index} className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-700">
                    {item.name} <span className="text-gray-400">× {item.quantity}</span>
                  </span>
                  <span className="text-gray-900">{formatRupiah(item.total)}</span>
                </div>
                {item.reviewable && item.productId ? (
                  <ReviewForm orderToken={token} productId={item.productId} productName={item.name} />
                ) : null}
              </div>
            ))}
            <Row label="Subtotal" value={formatRupiah(order.subtotal)} className="border-t border-gray-100 pt-2" />
            {order.discountAmount > 0 ? (
              <Row label={`Discount${order.promoCode ? ` (${order.promoCode})` : ''}`} value={`-${formatRupiah(order.discountAmount)}`} tone="text-everglade" />
            ) : null}
            <Row
              label={pickup ? 'Pickup' : `Shipping${order.courier ? ` (${order.courier})` : ''}`}
              value={pickup ? 'Free' : formatRupiah(order.shipping_cost)}
            />
            <div className="flex items-center justify-between text-base font-semibold">
              <span>Total</span>
              <span className="text-forest">{formatRupiah(order.total)}</span>
            </div>
            <Row label="Payment" value={order.paymentMethod === 'arkcoin' ? 'ARK Coin' : 'Xendit'} />
          </div>
        </div>

        <div className="rounded-2xl border border-forest/10 bg-white p-6 text-sm shadow-sm">
          {pickup ? (
            <>
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
                <Store className="h-3.5 w-3.5" /> Pick up at
              </p>
              {order.delivery.branch ? (
                <>
                  <p className="font-medium text-gray-900">{order.delivery.branch.name}</p>
                  <p className="flex items-start gap-1.5 text-gray-600"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />{order.delivery.branch.address}</p>
                  {order.delivery.branch.phone ? <p className="text-gray-500">{order.delivery.branch.phone}</p> : null}
                </>
              ) : (
                <p className="text-gray-600">Branch details will follow on WhatsApp.</p>
              )}
              <p className="mt-2 text-gray-600">
                {order.delivery.readyAt
                  ? `Ready since ${formatDateTimeEn(order.delivery.readyAt)}. Bring this order number.`
                  : 'We will message you when the order is ready for pickup.'}
              </p>
              <p className="mt-2 text-xs text-gray-500">Ordered by {order.customer_name}</p>
            </>
          ) : (
            <>
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
                <Package className="h-3.5 w-3.5" /> Shipping Address
              </p>
              <p className="font-medium text-gray-900">{order.customer_name}</p>
              <p className="text-gray-600">{order.shipping_address}</p>
              {order.shipping_area_label ? <p className="text-gray-500">{order.shipping_area_label}</p> : null}
              {order.courier || order.etaText ? (
                <p className="mt-2 flex items-center gap-1.5 text-gray-600">
                  <Truck className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  {order.courier}{order.courier && order.etaText ? ', ' : ''}{order.etaText ? `estimated delivery ${order.etaText}` : ''}
                </p>
              ) : null}
            </>
          )}
        </div>

        {order.whatsappUrl ? (
          <a
            href={order.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-full border border-forest px-5 py-3 text-sm font-semibold text-forest hover:bg-surface"
          >
            <MessageCircle className="h-4 w-4" /> Chat on WhatsApp
          </a>
        ) : null}
      </div>
    </div>
  );
}

function OrderSteps({ order }: { order: PublicOrderStatus }) {
  const steps = orderSteps(order.delivery.method);
  const current = orderStepIndex(order.delivery.method, order.status);
  if (current < 0) return null;
  return (
    <ol className="mb-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Order progress">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step.status} className="flex flex-col items-center gap-1 text-center" aria-current={active ? 'step' : undefined}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
              done ? 'bg-forest text-white' : active ? 'bg-lime text-forest ring-2 ring-forest' : 'bg-gray-100 text-gray-400'
            }`}>
              {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className={`text-[11px] leading-4 ${active ? 'font-semibold text-forest' : done ? 'text-gray-700' : 'text-gray-400'}`}>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Row({ label, value, tone = 'text-gray-900', className = '' }: { label: string; value: string; tone?: string; className?: string }) {
  return (
    <div className={`flex items-center justify-between text-sm ${className}`}>
      <span className="text-gray-500">{label}</span>
      <span className={tone}>{value}</span>
    </div>
  );
}
