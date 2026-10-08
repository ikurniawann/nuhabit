'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Loader2, MapPin, Truck, X } from 'lucide-react';
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
  'mt-1.5 w-full rounded-xl border border-forest/15 bg-white px-3.5 py-3 text-sm text-forest outline-none placeholder:text-gray-400 focus:border-forest focus:ring-2 focus:ring-forest/10';

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

  const { areas, searching, searched, error: areasError } = useAreaSearch(
    `/api/public/shop/${slug}/shipping/areas`, areaQuery, open && selectedArea === null
  );
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
      try {
        const paymentUrl = new URL(invoice_url);
        if (!['http:', 'https:'].includes(paymentUrl.protocol)) throw new Error('Invalid payment URL');
        window.location.assign(paymentUrl.href);
        onPaid();
      } catch {
        setFormError('The payment page could not be opened. Please contact NüHabit with your order details.');
      }
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : 'Checkout failed'),
  });

  if (!open) return null;

  const selectArea = (area: AreaSuggestion) => {
    setSelectedArea(area);
    setAreaQuery(area.label);
    setPickedRate(null);
    setFormError(null);
  };

  const submit = () => {
    const error = checkoutFormError({
      name: custName,
      phone: custPhone,
      email: custEmail,
      address,
      hasArea: selectedArea !== null,
      hasRate: selectedRate !== null,
    });
    setFormError(error);
    if (!error) checkout.mutate();
  };

  const ratesError = ratesMutation.isError
    ? 'Delivery prices are temporarily unavailable. Please try again later or contact NüHabit.'
    : ratesMutation.isSuccess && rates.length === 0 && ratesMutation.data.signature === signature
      ? 'No courier service ships to this area'
      : null;
  const areaMessage = areasError
    ? 'Delivery area search is temporarily unavailable. Please try again later or contact NüHabit.'
    : null;
  const message = areaMessage ?? ratesError ?? formError;
  const subtotal = cartSubtotal(cart);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-forest/55">
      <div role="dialog" aria-modal="true" aria-label="Shipping and payment" className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-forest/10 px-5 py-4">
          <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-everglade">NüHabit Shop</p><h2 className="font-display text-xl font-semibold text-forest">Shipping & Payment</h2></div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5 text-forest/60" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="rounded-2xl border border-forest/10 bg-white p-4">
            <p className="mb-3 text-sm font-semibold text-forest">Your order</p>
            <ul className="space-y-2">
              {cart.map((line) => (
                <li key={line.key} className="flex justify-between gap-3 text-sm">
                  <span className="text-gray-600">{line.quantity} × {line.name}{line.variantName ? ` · ${line.variantName}` : ''}</span>
                  <span className="shrink-0 font-medium text-gray-900">{formatRupiah(line.price * line.quantity)}</span>
                </li>
              ))}
            </ul>
          </div>
          <h3 className="font-display text-base font-semibold text-forest">Delivery details</h3>
          <div className="space-y-3">
            <label className="block text-xs font-medium text-gray-600">Recipient name
            <input
              value={custName}
              onChange={(e) => { setCustName(e.target.value); setFormError(null); }}
              placeholder="Recipient name"
              autoComplete="name"
              className={INPUT_CLASS}
            />
            </label>
            <label className="block text-xs font-medium text-gray-600">WhatsApp number
            <input
              value={custPhone}
              onChange={(e) => { setCustPhone(e.target.value); setFormError(null); }}
              placeholder="WhatsApp number (for confirmation and membership)"
              inputMode="tel"
              autoComplete="tel"
              className={INPUT_CLASS}
            />
            </label>
            <label className="block text-xs font-medium text-gray-600">Email (optional)
            <input
              value={custEmail}
              onChange={(e) => { setCustEmail(e.target.value); setFormError(null); }}
              placeholder="Email (optional)"
              inputMode="email"
              type="email"
              autoComplete="email"
              className={INPUT_CLASS}
            />
            </label>
          </div>

          <div className="relative">
            <label htmlFor="shop-destination" className="block text-xs font-medium text-gray-600">Destination area</label>
            <input
              id="shop-destination"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="shop-area-results"
              aria-expanded={!selectedArea && areas.length > 0}
              aria-describedby={selectedArea ? undefined : 'shop-destination-help'}
              value={selectedArea ? selectedArea.label : areaQuery}
              onChange={(e) => {
                setSelectedArea(null);
                setPickedRate(null);
                setFormError(null);
                ratesMutation.reset();
                setAreaQuery(e.target.value);
              }}
              placeholder="Search destination district or city..."
              className={INPUT_CLASS}
            />
            {selectedArea ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-forest/15 bg-[#f5f7f3] px-3 py-2 text-xs text-forest">
                <span className="flex min-w-0 items-center gap-2"><Check className="h-4 w-4 shrink-0" /> <span className="truncate">Selected: {selectedArea.label}{selectedArea.postalCode ? ` (${selectedArea.postalCode})` : ''}</span></span>
                <button type="button" className="shrink-0 font-semibold underline" onClick={() => { setSelectedArea(null); setPickedRate(null); ratesMutation.reset(); setAreaQuery(''); }}>Change</button>
              </div>
            ) : (
              <p id="shop-destination-help" className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-gray-600"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />Type at least 3 letters, then choose an area from the results. Typing alone does not select it.</p>
            )}
            {!selectedArea && searching ? <p className="mt-2 flex items-center gap-2 text-xs text-gray-600"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching delivery areas...</p> : null}
            {!selectedArea && searched && areas.length === 0 && !areasError ? <p className="mt-2 text-xs text-gray-600">No area found. Try a nearby district or city name.</p> : null}
            {!selectedArea && !areasError ? <AreaSuggestions id="shop-area-results" areas={areas} onSelect={selectArea} /> : null}
          </div>

          <label className="block text-xs font-medium text-gray-600">Full address
          <textarea
            value={address}
            onChange={(e) => { setAddress(e.target.value); setFormError(null); }}
            placeholder="Full address (street, number, RT/RW, landmark)"
            rows={3}
            autoComplete="street-address"
            className={INPUT_CLASS}
          />
          </label>

          {/* Courier choice */}
          {selectedArea && ratesMutation.isPending ? (
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
                  onClick={() => { setPickedRate({ rate, signature, areaId: selectedArea?.id ?? '' }); setFormError(null); }}
                  className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition ${
                    selectedRate && sameRate(selectedRate, rate)
                      ? 'border-forest bg-[#f5f7f3] ring-1 ring-forest'
                      : 'border-forest/15 bg-white hover:border-forest'
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

          {message ? <p role="alert" className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm text-red-700">{message}</p> : null}
        </div>

        <div className="border-t border-forest/10 bg-white px-5 py-4 shadow-[0_-8px_24px_rgb(0_40_26/0.04)]">
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
            disabled={checkout.isPending || checkout.isSuccess || !selectedArea || !selectedRate || Boolean(areasError || ratesError)}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-lime px-4 py-3 text-sm font-semibold text-forest transition hover:bg-lemon disabled:cursor-not-allowed disabled:opacity-60"
          >
            {checkout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {!selectedArea ? 'Choose a delivery area' : !selectedRate ? 'Choose a courier' : 'Pay Now'}
          </button>
          <p className="mt-2 text-center text-xs text-gray-400">
            Secure payment via Xendit (QRIS, virtual account, e-wallet, card)
          </p>
        </div>
      </div>
    </div>
  );
}
