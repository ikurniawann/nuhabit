'use client';

import { useState } from 'react';
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
  'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-pink-400';

const sameRate = (a: RateQuote, b: RateQuote) =>
  a.courierCode === b.courierCode && a.serviceCode === b.serviceCode;

/**
 * Pengiriman & pembayaran: area tujuan → ongkir live → invoice Xendit.
 * Tetap ter-mount saat ditutup (render null) supaya isian form tidak hilang.
 * Tarif hanya berlaku untuk isi keranjang saat dihitung (sidik keranjang).
 */
export function CheckoutDrawer({
  open,
  slug,
  cart,
  onPaid,
  onClose,
}: {
  open: boolean;
  slug: string;
  cart: CartLine[];
  onPaid: () => void;
  onClose: () => void;
}) {
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [areaQuery, setAreaQuery] = useState('');
  const [selectedArea, setSelectedArea] = useState<AreaSuggestion | null>(null);
  const [pickedRate, setPickedRate] = useState<RateQuote | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { areas } = useAreaSearch(`/api/public/shop/${slug}/shipping/areas`, areaQuery, selectedArea === null);
  const signature = cartSignature(cart);

  const ratesMutation = useMutation({
    mutationFn: async (area: AreaSuggestion) => ({
      signature,
      quotes: await fetchShippingRates(slug, area, cart),
    }),
  });
  const rates = ratesMutation.data?.signature === signature ? ratesMutation.data.quotes : [];
  const selectedRate = pickedRate ? (rates.find((rate) => sameRate(rate, pickedRate)) ?? null) : null;

  const checkout = useMutation({
    mutationFn: async () => {
      if (!selectedArea || !selectedRate) throw new Error('Pilih kurir dulu');
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
        notes: notes.trim() || null,
      });
    },
    onSuccess: ({ invoice_url }) => {
      onPaid();
      window.location.assign(invoice_url);
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : 'Checkout gagal'),
  });

  if (!open) return null;

  const selectArea = (area: AreaSuggestion) => {
    setSelectedArea(area);
    setPickedRate(null);
    setFormError(null);
    ratesMutation.mutate(area);
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
    ? ratesMutation.error.message || 'Gagal cek ongkir'
    : ratesMutation.isSuccess && rates.length === 0 && ratesMutation.data.signature === signature
      ? 'Tidak ada layanan kurir ke area ini'
      : null;
  const message = formError ?? ratesError;
  const subtotal = cartSubtotal(cart);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-md flex-col bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Pengiriman & Pembayaran</h2>
          <button type="button" onClick={onClose} aria-label="Tutup">
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="space-y-3">
            <input
              value={custName}
              onChange={(e) => setCustName(e.target.value)}
              placeholder="Nama penerima"
              className={INPUT_CLASS}
            />
            <input
              value={custPhone}
              onChange={(e) => setCustPhone(e.target.value)}
              placeholder="No. WhatsApp (utk konfirmasi & member)"
              inputMode="tel"
              className={INPUT_CLASS}
            />
            <input
              value={custEmail}
              onChange={(e) => setCustEmail(e.target.value)}
              placeholder="Email (opsional)"
              inputMode="email"
              className={INPUT_CLASS}
            />
          </div>

          <div className="relative">
            <input
              value={selectedArea ? selectedArea.label : areaQuery}
              onChange={(e) => {
                setSelectedArea(null);
                setPickedRate(null);
                ratesMutation.reset();
                setAreaQuery(e.target.value);
              }}
              placeholder="Cari kecamatan/kota tujuan..."
              className={INPUT_CLASS}
            />
            <AreaSuggestions areas={areas} onSelect={selectArea} />
          </div>

          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Alamat lengkap (jalan, nomor, RT/RW, patokan)"
            rows={3}
            className={INPUT_CLASS}
          />

          {/* Pilihan kurir */}
          {ratesMutation.isPending ? (
            <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Menghitung ongkir...
            </div>
          ) : rates.length > 0 ? (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                <Truck className="h-3.5 w-3.5" /> Pilih kurir
              </p>
              {rates.map((rate, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setPickedRate(rate)}
                  className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition ${
                    selectedRate && sameRate(selectedRate, rate)
                      ? 'border-pink-500 bg-pink-50'
                      : 'border-gray-200 hover:border-pink-300'
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

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Catatan (opsional)"
            rows={2}
            className={INPUT_CLASS}
          />

          {message ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{message}</p> : null}
        </div>

        <div className="border-t border-gray-100 px-5 py-4">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-gray-500">Subtotal</span>
            <span className="text-gray-900">{formatRupiah(subtotal)}</span>
          </div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-gray-500">Ongkir</span>
            <span className="text-gray-900">{selectedRate ? formatRupiah(selectedRate.total_price) : '—'}</span>
          </div>
          <div className="mb-3 flex items-center justify-between text-base font-semibold">
            <span>Total</span>
            <span className="text-pink-600">{formatRupiah(subtotal + (selectedRate?.total_price ?? 0))}</span>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={checkout.isPending || checkout.isSuccess}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-pink-600 px-4 py-3 text-sm font-semibold text-white hover:bg-pink-700 disabled:opacity-60"
          >
            {checkout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Bayar Sekarang
          </button>
          <p className="mt-2 text-center text-xs text-gray-400">
            Pembayaran aman via Xendit (QRIS, VA, e-wallet, kartu)
          </p>
        </div>
      </div>
    </div>
  );
}
