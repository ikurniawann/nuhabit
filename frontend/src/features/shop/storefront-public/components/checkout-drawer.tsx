'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Truck, X } from 'lucide-react';
import { formatRupiah } from '@/lib/format';
import {
  cartSignature,
  cartSubtotal,
  checkoutFormError,
  type CartLine,
} from '@/lib/shop/storefront-cart';
import { useAreaSearch, type AreaSuggestion } from '@/features/shop/shared/area-search';
import { AreaSuggestions } from '@/features/shop/shared/area-suggestions';
import { fetchShippingRates, submitShopCheckout, type RateQuote } from '../queries';

const INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-forest';

const sameRate = (a: RateQuote, b: RateQuote) =>
  a.courierCode === b.courierCode && a.serviceCode === b.serviceCode;

/**
 * Shipping and payment: destination area, live shipping rates, Xendit
 * invoice. Stays mounted while closed (renders null) so the form keeps its
 * values. Rates only apply to the cart they were quoted for (cart
 * signature). `cart` is the stored cart or a single "Buy Now" line; the
 * order note comes from the caller.
 */
export function CheckoutDrawer({
  open,
  slug,
  cart,
  note,
  onPaid,
  onClose,
}: {
  open: boolean;
  slug: string;
  cart: CartLine[];
  note: string;
  onPaid: () => void;
  onClose: () => void;
}) {
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [address, setAddress] = useState('');
  const [areaQuery, setAreaQuery] = useState('');
  const [selectedArea, setSelectedArea] = useState<AreaSuggestion | null>(null);
  const [pickedRate, setPickedRate] = useState<{ rate: RateQuote; signature: string; areaId: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { areas } = useAreaSearch(`/api/public/shop/${slug}/shipping/areas`, areaQuery, selectedArea === null);
  const signature = cartSignature(cart);

  const ratesMutation = useMutation({
    mutationFn: async (area: AreaSuggestion) => ({
      signature,
      quotes: await fetchShippingRates(slug, area, cart),
    }),
  });
  useEffect(() => {
    if (!selectedArea) return;
    ratesMutation.mutate(selectedArea);
    // A new cart signature needs a new quote, even if the destination is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedArea, signature]);
  const rates = ratesMutation.data?.signature === signature ? ratesMutation.data.quotes : [];
  const selectedRate = pickedRate && pickedRate.signature === signature && pickedRate.areaId === selectedArea?.id
    ? (rates.find((rate) => sameRate(rate, pickedRate.rate)) ?? null)
    : null;

  const checkout = useMutation({
    mutationFn: async () => {
      if (!selectedArea || !selectedRate) throw new Error('Choose a courier first');
      return submitShopCheckout(slug, {
        items: cart.map((line) => ({ product_id: line.productId, sku_id: line.skuId, quantity: line.quantity })),
        customer: { name: custName.trim(), phone: custPhone.trim(), email: custEmail.trim() || null },
        destination: {
          area_id: selectedArea.id,
          label: selectedArea.label,
          postal_code: selectedArea.postalCode,
          address: address.trim(),
        },
        courier: { code: selectedRate.courierCode, service_code: selectedRate.serviceCode },
        notes: note.trim() || null,
      });
    },
    onSuccess: ({ invoice_url }) => {
      onPaid();
      window.location.assign(invoice_url);
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : 'Checkout failed'),
  });

  if (!open) return null;

  const selectArea = (area: AreaSuggestion) => {
    setSelectedArea(area);
    setPickedRate(null);
    setFormError(null);
  };

  const submit = () => {
    const error = checkoutFormError({
      name: custName,
      phone: custPhone,
      address,
      hasArea: selectedArea !== null,
      hasRate: selectedRate !== null,
    });
    setFormError(error);
    if (!error) checkout.mutate();
  };

  const ratesError = ratesMutation.isError
    ? ratesMutation.error.message || 'Could not fetch shipping rates'
    : ratesMutation.isSuccess && rates.length === 0 && ratesMutation.data.signature === signature
      ? 'No courier service ships to this area'
      : null;
  const message = formError ?? ratesError;
  const subtotal = cartSubtotal(cart);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-md flex-col bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Shipping & Payment</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="rounded-xl bg-gray-50 p-4">
            <p className="mb-3 text-sm font-semibold text-gray-900">Your order</p>
            <ul className="space-y-2">
              {cart.map((line) => (
                <li key={line.key} className="flex justify-between gap-3 text-sm">
                  <span className="text-gray-600">{line.quantity} × {line.name}{line.variantName ? ` · ${line.variantName}` : ''}</span>
                  <span className="shrink-0 font-medium text-gray-900">{formatRupiah(line.price * line.quantity)}</span>
                </li>
              ))}
            </ul>
          </div>
          <h3 className="text-sm font-semibold text-gray-900">Delivery details</h3>
          <div className="space-y-3">
            <label className="block text-xs font-medium text-gray-600">Recipient name
            <input
              value={custName}
              onChange={(e) => setCustName(e.target.value)}
              placeholder="Recipient name"
              autoComplete="name"
              className={INPUT_CLASS}
            />
            </label>
            <label className="block text-xs font-medium text-gray-600">WhatsApp number
            <input
              value={custPhone}
              onChange={(e) => setCustPhone(e.target.value)}
              placeholder="WhatsApp number (for confirmation and membership)"
              inputMode="tel"
              autoComplete="tel"
              className={INPUT_CLASS}
            />
            </label>
            <label className="block text-xs font-medium text-gray-600">Email (optional)
            <input
              value={custEmail}
              onChange={(e) => setCustEmail(e.target.value)}
              placeholder="Email (optional)"
              inputMode="email"
              type="email"
              autoComplete="email"
              className={INPUT_CLASS}
            />
            </label>
          </div>

          <div className="relative">
            <label htmlFor="shop-destination" className="mb-1 block text-xs font-medium text-gray-600">Destination area</label>
            <input
              id="shop-destination"
              value={selectedArea ? selectedArea.label : areaQuery}
              onChange={(e) => {
                setSelectedArea(null);
                setPickedRate(null);
                ratesMutation.reset();
                setAreaQuery(e.target.value);
              }}
              placeholder="Search destination district or city..."
              className={INPUT_CLASS}
            />
            <AreaSuggestions areas={areas} onSelect={selectArea} />
          </div>

          <label className="block text-xs font-medium text-gray-600">Full address
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Full address (street, number, RT/RW, landmark)"
            rows={3}
            autoComplete="street-address"
            className={INPUT_CLASS}
          />
          </label>

          {/* Courier choice */}
          {ratesMutation.isPending ? (
            <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculating shipping...
            </div>
          ) : rates.length > 0 ? (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                <Truck className="h-3.5 w-3.5" /> Choose a courier
              </p>
              {rates.map((rate, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setPickedRate({ rate, signature, areaId: selectedArea?.id ?? '' })}
                  className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition ${
                    selectedRate && sameRate(selectedRate, rate)
                      ? 'border-forest bg-surface'
                      : 'border-gray-200 hover:border-forest'
                  }`}
                >
                  <span>
                    <span className="font-medium text-gray-900">{rate.courierName}</span>{' '}
                    <span className="text-gray-500">{rate.serviceName}</span>
                    {rate.etd ? <span className="block text-xs text-gray-400">{rate.etd}</span> : null}
                  </span>
                  <span className="font-semibold text-gray-900">{formatRupiah(rate.total_price)}</span>
                </button>
              ))}
            </div>
          ) : null}

          {note.trim() ? (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">Note: {note.trim()}</p>
          ) : null}

          {message ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{message}</p> : null}
        </div>

        <div className="border-t border-gray-100 px-5 py-4">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-gray-500">Subtotal</span>
            <span className="text-gray-900">{formatRupiah(subtotal)}</span>
          </div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-gray-500">Shipping</span>
            <span className="text-gray-900">{selectedRate ? formatRupiah(selectedRate.total_price) : '-'}</span>
          </div>
          <div className="mb-3 flex items-center justify-between text-base font-semibold">
            <span>Total</span>
            <span className="text-forest">{formatRupiah(subtotal + (selectedRate?.total_price ?? 0))}</span>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={checkout.isPending || checkout.isSuccess}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-accent-strong px-4 py-3 text-sm font-semibold text-accent-foreground hover:bg-accent-dark disabled:opacity-60"
          >
            {checkout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Pay Now
          </button>
          <p className="mt-2 text-center text-xs text-gray-400">
            Secure payment via Xendit (QRIS, virtual account, e-wallet, card)
          </p>
        </div>
      </div>
    </div>
  );
}
