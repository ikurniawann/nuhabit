'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Coins, Loader2, MapPin, Store, Tag, Truck, X } from 'lucide-react';
import { formatRupiah } from '@/lib/format';
import { cartSignature, type CartLine } from '@/lib/shop/storefront-cart';
import {
  arkCoinAvailable,
  buildCheckoutPayload,
  checkoutDraftError,
  checkoutTotals,
} from '@/lib/shop/storefront-checkout';
import type { AppliedPromo, DeliveryMethod, PaymentMethod, PickupBranch, ShopMember, StorefrontSettings } from '@/lib/shop/types';
import { useAreaSearch, type AreaSuggestion } from '@/features/shop/shared/area-search';
import { AreaSuggestions } from '@/features/shop/shared/area-suggestions';
import { pushShopEvent } from '../analytics';
import { readCheckoutContact, saveCheckoutContact } from '../cart-store';
import { fetchShippingRates, previewPromoCode, submitShopCheckout, useShopMember, type RateQuote } from '../queries';

const INPUT_CLASS =
  'mt-1.5 w-full rounded-xl border border-forest/15 bg-white px-3.5 py-3 text-sm text-forest outline-none placeholder:text-gray-400 focus:border-forest focus:ring-2 focus:ring-forest/10';
const LABEL_CLASS = 'block text-xs font-medium text-gray-600';
const CHOICE_CLASS = 'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition';
const CHOICE_ON = 'border-forest bg-[#f5f7f3] ring-1 ring-forest';
const CHOICE_OFF = 'border-forest/15 bg-white hover:border-forest';

const sameRate = (a: RateQuote, b: RateQuote) =>
  a.courierCode === b.courierCode && a.serviceCode === b.serviceCode;

/**
 * One-screen checkout: contact, delivery (ship or pick up), promo code,
 * summary, payment and the pay button. Stays mounted while closed (renders
 * null) so the form keeps its values. Rates only apply to the cart they
 * were quoted for (cart signature). `cart` is the stored cart or a single
 * "Buy Now" line; the note and the promo come from the caller.
 */
export function CheckoutSheet({
  open,
  slug,
  cart,
  note,
  settings,
  branches,
  promo,
  onPromoChange,
  onPaid,
  onClose,
}: {
  open: boolean;
  slug: string;
  cart: CartLine[];
  note: string;
  settings: StorefrontSettings;
  branches: PickupBranch[];
  promo: AppliedPromo | null;
  onPromoChange: (promo: AppliedPromo | null) => void;
  onPaid: () => void;
  onClose: () => void;
}) {
  const [remembered] = useState(readCheckoutContact);
  const [custName, setCustName] = useState(remembered.name);
  const [custPhone, setCustPhone] = useState(remembered.phone);
  const [custEmail, setCustEmail] = useState(remembered.email);
  const [address, setAddress] = useState(remembered.address);
  const [areaQuery, setAreaQuery] = useState('');
  const [selectedArea, setSelectedArea] = useState<AreaSuggestion | null>(remembered.area);
  const pickupOffered = settings.pickupEnabled && branches.length > 0;
  const [method, setMethod] = useState<DeliveryMethod>('ship');
  const [branchId, setBranchId] = useState<string | null>(branches[0]?.id ?? null);
  const [pickedRate, setPickedRate] = useState<{ rate: RateQuote; signature: string; areaId: string } | null>(null);
  const [promoInput, setPromoInput] = useState(promo?.code ?? '');
  const [promoError, setPromoError] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>('xendit');
  const [formError, setFormError] = useState<string | null>(null);

  // Member values win over the remembered contact, once per member load.
  const member = useShopMember(slug, open);
  const [appliedMember, setAppliedMember] = useState<ShopMember | null | undefined>(undefined);
  if (member.data !== undefined && member.data !== appliedMember) {
    setAppliedMember(member.data);
    if (member.data) {
      if (member.data.name) setCustName(member.data.name);
      if (member.data.phone) setCustPhone(member.data.phone);
      if (member.data.email) setCustEmail(member.data.email);
      const last = member.data.lastAddress;
      if (last) {
        setAddress(last.address);
        setSelectedArea({ id: last.areaId, label: last.areaLabel, postalCode: last.postalCode });
        setPickedRate(null);
      }
    }
  }

  const { areas, searching, searched, error: areasError } = useAreaSearch(
    `/api/public/shop/${slug}/shipping/areas`, areaQuery, open && method === 'ship' && selectedArea === null
  );
  const signature = cartSignature(cart);

  const ratesMutation = useMutation({
    mutationFn: async (area: AreaSuggestion) => ({
      signature,
      quotes: await fetchShippingRates(slug, area, cart),
    }),
  });
  useEffect(() => {
    if (!open || method !== 'ship' || !selectedArea) return;
    ratesMutation.mutate(selectedArea);
    // A new cart signature needs a new quote, even if the destination is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, method, selectedArea, signature]);
  const rates = ratesMutation.data?.signature === signature ? ratesMutation.data.quotes : [];
  const selectedRate = pickedRate && pickedRate.signature === signature && pickedRate.areaId === selectedArea?.id
    ? (rates.find((rate) => sameRate(rate, pickedRate.rate)) ?? null)
    : null;

  const promoMutation = useMutation({
    mutationFn: (code: string) => previewPromoCode(slug, code, cart),
    onSuccess: (applied) => {
      setPromoError(null);
      onPromoChange(applied);
    },
    onError: (error) => setPromoError(error instanceof Error ? error.message : 'This code cannot be used'),
  });

  const totals = checkoutTotals({
    lines: cart,
    promo,
    method,
    rateCost: selectedRate?.total_price ?? null,
    freeShippingThreshold: settings.freeShippingThreshold,
  });
  const arkAvailable = arkCoinAvailable(member.data, totals.total);
  const paymentMethod: PaymentMethod = arkAvailable ? payment : 'xendit';
  const branch = branches.find((candidate) => candidate.id === branchId) ?? null;

  const checkout = useMutation({
    mutationFn: () =>
      submitShopCheckout(slug, buildCheckoutPayload({
        lines: cart,
        customer: { name: custName, phone: custPhone, email: custEmail },
        method,
        branchId,
        area: selectedArea,
        address,
        courier: selectedRate ? { code: selectedRate.courierCode, serviceCode: selectedRate.serviceCode } : null,
        promo,
        payment: paymentMethod,
        note,
      })),
    onSuccess: (result) => {
      saveCheckoutContact({ name: custName, phone: custPhone, email: custEmail, address, area: selectedArea });
      pushShopEvent('purchase', {
        shop: slug,
        product: cart.map((line) => line.name).join(', '),
        variant: cart.length === 1 ? cart[0].variantName : null,
        qty: cart.reduce((sum, line) => sum + line.quantity, 0),
        value: totals.total,
        order: 'orderNumber' in result ? result.orderNumber : undefined,
        payment: paymentMethod,
        delivery: method,
      });
      const target = 'invoice_url' in result ? result.invoice_url : result.statusUrl;
      try {
        const url = new URL(target, window.location.origin);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid URL');
        onPaid();
        window.location.assign(url.href);
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

  const clearArea = () => {
    setSelectedArea(null);
    setPickedRate(null);
    ratesMutation.reset();
    setAreaQuery('');
  };

  const applyPromo = () => {
    const code = promoInput.trim();
    if (!code) {
      setPromoError('Enter a promo code');
      return;
    }
    promoMutation.mutate(code);
  };

  const removePromo = () => {
    onPromoChange(null);
    setPromoInput('');
    setPromoError(null);
  };

  const submit = () => {
    const error = checkoutDraftError({
      name: custName,
      phone: custPhone,
      email: custEmail,
      method,
      branchId,
      address,
      hasArea: selectedArea !== null,
      hasRate: selectedRate !== null,
    }, branches);
    setFormError(error);
    if (!error) checkout.mutate();
  };

  const ratesError = method === 'ship' && ratesMutation.isError
    ? 'Delivery prices are temporarily unavailable. Please try again later or contact NüHabit.'
    : method === 'ship' && ratesMutation.isSuccess && rates.length === 0 && ratesMutation.data.signature === signature
      ? 'No courier service ships to this area'
      : null;
  const areaMessage = method === 'ship' && areasError
    ? 'Delivery area search is temporarily unavailable. Please try again later or contact NüHabit.'
    : null;
  const message = areaMessage ?? ratesError ?? formError;
  const ready = method === 'pickup' ? branch !== null : selectedArea !== null && selectedRate !== null;
  const payLabel = method === 'pickup'
    ? 'Pay Now'
    : !selectedArea ? 'Choose a delivery area' : !selectedRate ? 'Choose a courier' : 'Pay Now';

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-forest/55">
      <div role="dialog" aria-modal="true" aria-label="Checkout" className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-forest/10 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-everglade">NüHabit Shop</p>
            <h2 className="font-display text-xl font-semibold text-forest">Checkout</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5 text-forest/60" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <section aria-labelledby="checkout-contact" className="space-y-3">
            <SectionTitle id="checkout-contact">Contact</SectionTitle>
            {member.data ? <p className="text-xs text-everglade">Signed in as {member.data.name}. Your details are filled in from your member profile.</p> : null}
            <label className={LABEL_CLASS}>Name
              <input value={custName} onChange={(e) => { setCustName(e.target.value); setFormError(null); }} placeholder="Your name" autoComplete="name" className={INPUT_CLASS} />
            </label>
            <label className={LABEL_CLASS}>WhatsApp number
              <input value={custPhone} onChange={(e) => { setCustPhone(e.target.value); setFormError(null); }} placeholder="For order updates" inputMode="tel" autoComplete="tel" className={INPUT_CLASS} />
            </label>
            <label className={LABEL_CLASS}>Email (optional)
              <input value={custEmail} onChange={(e) => { setCustEmail(e.target.value); setFormError(null); }} placeholder="Email (optional)" inputMode="email" type="email" autoComplete="email" className={INPUT_CLASS} />
            </label>
          </section>

          <section aria-labelledby="checkout-delivery" className="space-y-3">
            <SectionTitle id="checkout-delivery">Delivery</SectionTitle>
            {pickupOffered ? (
              <div role="radiogroup" aria-label="Delivery method" className="grid grid-cols-2 gap-2">
                <button type="button" role="radio" aria-checked={method === 'ship'} onClick={() => { setMethod('ship'); setFormError(null); }} className={`${CHOICE_CLASS} ${method === 'ship' ? CHOICE_ON : CHOICE_OFF}`}>
                  <Truck className="h-4 w-4 shrink-0 text-forest" />
                  <span className="font-medium text-gray-900">Ship to me</span>
                </button>
                <button type="button" role="radio" aria-checked={method === 'pickup'} onClick={() => { setMethod('pickup'); setFormError(null); }} className={`${CHOICE_CLASS} ${method === 'pickup' ? CHOICE_ON : CHOICE_OFF}`}>
                  <Store className="h-4 w-4 shrink-0 text-forest" />
                  <span className="font-medium text-gray-900">Pick up at a branch</span>
                </button>
              </div>
            ) : null}

            {method === 'pickup' ? (
              <div className="space-y-2" role="radiogroup" aria-label="Pickup branch">
                {branches.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    role="radio"
                    aria-checked={branchId === candidate.id}
                    onClick={() => { setBranchId(candidate.id); setFormError(null); }}
                    className={`${CHOICE_CLASS} items-start ${branchId === candidate.id ? CHOICE_ON : CHOICE_OFF}`}
                  >
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
                    <span className="min-w-0">
                      <span className="block font-medium text-gray-900">{candidate.name}</span>
                      <span className="block text-xs leading-5 text-gray-600">{candidate.address}{candidate.city ? `, ${candidate.city}` : ''}</span>
                      {candidate.phone ? <span className="block text-xs text-gray-500">{candidate.phone}</span> : null}
                    </span>
                  </button>
                ))}
                <p className="text-xs leading-5 text-gray-600">We will message you on WhatsApp when the order is ready for pickup. Free, no shipping cost.</p>
              </div>
            ) : (
              <>
                <div className="relative">
                  <label htmlFor="shop-destination" className={LABEL_CLASS}>Destination area</label>
                  <input
                    id="shop-destination"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls="shop-area-results"
                    aria-expanded={!selectedArea && areas.length > 0}
                    aria-describedby={selectedArea ? undefined : 'shop-destination-help'}
                    value={selectedArea ? selectedArea.label : areaQuery}
                    onChange={(e) => {
                      clearArea();
                      setFormError(null);
                      setAreaQuery(e.target.value);
                    }}
                    placeholder="Search destination district or city..."
                    className={INPUT_CLASS}
                  />
                  {selectedArea ? (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-forest/15 bg-[#f5f7f3] px-3 py-2 text-xs text-forest">
                      <span className="flex min-w-0 items-center gap-2"><Check className="h-4 w-4 shrink-0" /> <span className="truncate">Selected: {selectedArea.label}{selectedArea.postalCode ? ` (${selectedArea.postalCode})` : ''}</span></span>
                      <button type="button" className="shrink-0 font-semibold underline" onClick={clearArea}>Change</button>
                    </div>
                  ) : (
                    <p id="shop-destination-help" className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-gray-600"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />Type at least 3 letters, then choose an area from the results.</p>
                  )}
                  {!selectedArea && searching ? <p className="mt-2 flex items-center gap-2 text-xs text-gray-600"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching delivery areas...</p> : null}
                  {!selectedArea && searched && areas.length === 0 && !areasError ? <p className="mt-2 text-xs text-gray-600">No area found. Try a nearby district or city name.</p> : null}
                  {!selectedArea && !areasError ? <AreaSuggestions id="shop-area-results" areas={areas} onSelect={selectArea} /> : null}
                </div>

                <label className={LABEL_CLASS}>Full address
                  <textarea value={address} onChange={(e) => { setAddress(e.target.value); setFormError(null); }} placeholder="Street, number, RT/RW, landmark" rows={3} autoComplete="street-address" className={INPUT_CLASS} />
                </label>

                {selectedArea && ratesMutation.isPending ? (
                  <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" /> Calculating shipping...
                  </div>
                ) : rates.length > 0 ? (
                  <div className="space-y-2" role="radiogroup" aria-label="Courier">
                    <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                      <Truck className="h-3.5 w-3.5" /> Choose a courier
                    </p>
                    {rates.map((rate) => {
                      const active = selectedRate !== null && sameRate(selectedRate, rate);
                      return (
                        <button
                          key={`${rate.courierCode}-${rate.serviceCode}`}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => { setPickedRate({ rate, signature, areaId: selectedArea?.id ?? '' }); setFormError(null); }}
                          className={`${CHOICE_CLASS} justify-between ${active ? CHOICE_ON : CHOICE_OFF}`}
                        >
                          <span>
                            <span className="font-medium text-gray-900">{rate.courierName}</span>{' '}
                            <span className="text-gray-500">{rate.serviceName}</span>
                            {rate.etd ? <span className="block text-xs text-gray-500">Estimated delivery {rate.etd}</span> : null}
                          </span>
                          <span className="font-semibold text-gray-900">{totals.freeShipping ? 'Free' : formatRupiah(rate.total_price)}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </>
            )}
          </section>

          <section aria-labelledby="checkout-promo" className="space-y-2">
            <SectionTitle id="checkout-promo">Promo code</SectionTitle>
            {promo ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-forest/15 bg-[#f5f7f3] px-3 py-2 text-sm text-forest">
                <span className="flex min-w-0 items-center gap-2"><Tag className="h-4 w-4 shrink-0" /><span className="truncate"><span className="font-semibold">{promo.code}</span> applied: {promo.label}</span></span>
                <button type="button" className="shrink-0 text-xs font-semibold underline" onClick={removePromo}>Remove</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <label className="sr-only" htmlFor="shop-promo">Promo code</label>
                <input
                  id="shop-promo"
                  value={promoInput}
                  onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPromo(); } }}
                  placeholder="Enter a code"
                  autoCapitalize="characters"
                  className={`${INPUT_CLASS} mt-0 flex-1 uppercase`}
                />
                <button type="button" onClick={applyPromo} disabled={promoMutation.isPending} className="shrink-0 rounded-xl border border-forest px-4 text-sm font-semibold text-forest hover:bg-surface disabled:opacity-60">
                  {promoMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                </button>
              </div>
            )}
            {promoError ? <p role="alert" className="text-xs text-red-700">{promoError}</p> : null}
          </section>

          <section aria-labelledby="checkout-summary" className="space-y-1.5 rounded-2xl border border-forest/10 bg-white p-4">
            <SectionTitle id="checkout-summary">Summary</SectionTitle>
            <ul className="space-y-1 pt-1">
              {cart.map((line) => (
                <li key={line.key} className="flex justify-between gap-3 text-sm">
                  <span className="text-gray-600">{line.quantity} × {line.name}{line.variantName ? ` · ${line.variantName}` : ''}</span>
                  <span className="shrink-0 text-gray-900">{formatRupiah(line.price * line.quantity)}</span>
                </li>
              ))}
            </ul>
            <SummaryRow label="Subtotal" value={formatRupiah(totals.subtotal)} />
            {totals.discount > 0 ? <SummaryRow label={`Discount${promo ? ` (${promo.code})` : ''}`} value={`-${formatRupiah(totals.discount)}`} tone="text-everglade" /> : null}
            <SummaryRow
              label="Shipping"
              value={method === 'pickup' ? 'Free pickup' : totals.freeShipping && selectedRate ? 'Free' : selectedRate ? formatRupiah(totals.shipping) : '-'}
            />
            {method === 'ship' && selectedRate?.etd ? <SummaryRow label="Estimated delivery" value={selectedRate.etd} /> : null}
            <div className="flex items-center justify-between border-t border-gray-100 pt-2 text-base font-semibold">
              <span>Total</span>
              <span className="text-forest">{formatRupiah(totals.total)}</span>
            </div>
            {note.trim() ? <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">Note: {note.trim()}</p> : null}
          </section>

          <section aria-labelledby="checkout-payment" className="space-y-2">
            <SectionTitle id="checkout-payment">Payment</SectionTitle>
            <div role="radiogroup" aria-label="Payment method" className="space-y-2">
              <button type="button" role="radio" aria-checked={paymentMethod === 'xendit'} onClick={() => setPayment('xendit')} className={`${CHOICE_CLASS} ${paymentMethod === 'xendit' ? CHOICE_ON : CHOICE_OFF}`}>
                <span className="min-w-0">
                  <span className="block font-medium text-gray-900">Xendit</span>
                  <span className="block text-xs text-gray-500">QRIS, virtual account, e-wallet, card</span>
                </span>
              </button>
              {arkAvailable && member.data ? (
                <button type="button" role="radio" aria-checked={paymentMethod === 'arkcoin'} onClick={() => setPayment('arkcoin')} className={`${CHOICE_CLASS} ${paymentMethod === 'arkcoin' ? CHOICE_ON : CHOICE_OFF}`}>
                  <Coins className="h-4 w-4 shrink-0 text-forest" />
                  <span className="min-w-0">
                    <span className="block font-medium text-gray-900">ARK Coin</span>
                    <span className="block text-xs text-gray-500">Balance {formatRupiah(member.data.arkBalance)}, paid at once</span>
                  </span>
                </button>
              ) : member.data ? (
                <p className="text-xs text-gray-500">ARK Coin balance {formatRupiah(member.data.arkBalance)} does not cover this order.</p>
              ) : null}
            </div>
          </section>

          {message ? <p role="alert" className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm text-red-700">{message}</p> : null}
        </div>

        <div className="border-t border-forest/10 bg-white px-5 py-4 shadow-[0_-8px_24px_rgb(0_40_26/0.04)]">
          <button
            type="button"
            onClick={submit}
            disabled={checkout.isPending || checkout.isSuccess || !ready || Boolean(areaMessage || ratesError)}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-lime px-4 py-3 text-sm font-semibold text-forest transition hover:bg-lemon disabled:cursor-not-allowed disabled:opacity-60"
          >
            {checkout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {payLabel}{ready ? ` · ${formatRupiah(totals.total)}` : ''}
          </button>
          <p className="mt-2 text-center text-xs text-gray-400">
            {paymentMethod === 'arkcoin' ? 'ARK Coin is debited from your member balance at once.' : 'Secure payment via Xendit (QRIS, virtual account, e-wallet, card)'}
          </p>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ id, children }: { id: string; children: string }) {
  return <h3 id={id} className="text-xs font-semibold uppercase tracking-[0.18em] text-forest">{children}</h3>;
}

function SummaryRow({ label, value, tone = 'text-gray-900' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={tone}>{value}</span>
    </div>
  );
}
