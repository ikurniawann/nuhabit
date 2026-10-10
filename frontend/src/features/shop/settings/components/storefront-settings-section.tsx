'use client';

// Storefront settings: pickup on or off, free-shipping threshold, low-stock
// badge threshold, the WhatsApp number on the order status page and the
// promo banner (headline, text, campaign code).

import { useState } from 'react';
import { Loader2, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { PurchasingListSection } from '@/features/purchasing/components/shared/purchasing-list-section';
import type { StorefrontSettings } from '@/lib/shop/types';
import { useSaveStorefrontSettings, useStorefrontSettings } from '../queries';

export function StorefrontSettingsSection() {
  const { data: settings, error } = useStorefrontSettings();

  return (
    <PurchasingListSection
      icon={Store}
      title="Storefront"
      description="Ambil di cabang, gratis ongkir, badge stok menipis dan nomor WhatsApp pembeli"
    >
      {error ? (
        <p className="px-5 py-8 text-center text-sm text-red-500">{error.message || 'Gagal memuat pengaturan storefront'}</p>
      ) : !settings ? (
        <div className="flex items-center gap-2 px-5 py-8 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat...
        </div>
      ) : (
        <StorefrontSettingsForm key={JSON.stringify(settings)} initial={settings} />
      )}
    </PurchasingListSection>
  );
}

const numberOrNull = (value: string) => {
  const n = Number(value.replace(/\D/g, ''));
  return value.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : n;
};

function StorefrontSettingsForm({ initial }: { initial: StorefrontSettings }) {
  const save = useSaveStorefrontSettings();
  const [pickupEnabled, setPickupEnabled] = useState(initial.pickupEnabled);
  const [freeShipping, setFreeShipping] = useState(initial.freeShippingThreshold === null ? '' : String(initial.freeShippingThreshold));
  const [lowStock, setLowStock] = useState(String(initial.lowStockThreshold));
  const [whatsapp, setWhatsapp] = useState(initial.whatsappNumber ?? '');
  const [bannerHeadline, setBannerHeadline] = useState(initial.bannerHeadline ?? '');
  const [bannerText, setBannerText] = useState(initial.bannerText ?? '');
  const [bannerCode, setBannerCode] = useState(initial.bannerCode ?? '');

  const next: StorefrontSettings = {
    pickupEnabled,
    freeShippingThreshold: numberOrNull(freeShipping),
    lowStockThreshold: numberOrNull(lowStock) ?? 0,
    whatsappNumber: whatsapp.trim() || null,
    bannerHeadline: bannerHeadline.trim() || null,
    bannerText: bannerText.trim() || null,
    bannerCode: bannerCode.trim().toUpperCase() || null,
  };
  const dirty = JSON.stringify(next) !== JSON.stringify(initial);

  return (
    <form
      className="space-y-5 px-5 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(next);
      }}
    >
      <label className="flex items-center justify-between gap-4">
        <span>
          <span className="block text-sm font-medium text-gray-900">Ambil di cabang</span>
          <span className="block text-xs text-gray-500">Pembeli bisa memilih ambil sendiri di cabang publik, tanpa ongkir.</span>
        </span>
        <Switch checked={pickupEnabled} onCheckedChange={setPickupEnabled} aria-label="Ambil di cabang" />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="sf-free-shipping" className="mb-1 block text-xs text-gray-500">Gratis ongkir mulai (Rp)</label>
          <Input id="sf-free-shipping" inputMode="numeric" value={freeShipping} placeholder="Kosongkan = tidak ada" onChange={(event) => setFreeShipping(event.target.value)} />
        </div>
        <div>
          <label htmlFor="sf-low-stock" className="mb-1 block text-xs text-gray-500">Badge stok menipis di bawah</label>
          <Input id="sf-low-stock" inputMode="numeric" value={lowStock} onChange={(event) => setLowStock(event.target.value)} />
        </div>
        <div>
          <label htmlFor="sf-whatsapp" className="mb-1 block text-xs text-gray-500">Nomor WhatsApp toko</label>
          <Input id="sf-whatsapp" inputMode="tel" value={whatsapp} placeholder="62812xxxxxxx" onChange={(event) => setWhatsapp(event.target.value)} />
        </div>
      </div>

      <fieldset className="space-y-3 border-t border-gray-100 pt-4">
        <legend className="sr-only">Banner promo</legend>
        <div>
          <p className="text-sm font-medium text-gray-900">Banner promo di storefront</p>
          <p className="text-xs text-gray-500">Tampil di atas katalog. Kosongkan judul untuk menyembunyikan banner. Kode kampanye (opsional) bisa disalin pembeli dan dipakai saat checkout.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="sf-banner-headline" className="mb-1 block text-xs text-gray-500">Judul banner</label>
            <Input id="sf-banner-headline" value={bannerHeadline} maxLength={120} placeholder="Diskon akhir tahun" onChange={(event) => setBannerHeadline(event.target.value)} />
          </div>
          <div>
            <label htmlFor="sf-banner-text" className="mb-1 block text-xs text-gray-500">Teks banner</label>
            <Input id="sf-banner-text" value={bannerText} maxLength={240} placeholder="Potongan 20% untuk semua jersey" onChange={(event) => setBannerText(event.target.value)} />
          </div>
          <div>
            <label htmlFor="sf-banner-code" className="mb-1 block text-xs text-gray-500">Kode kampanye</label>
            <Input id="sf-banner-code" value={bannerCode} maxLength={32} placeholder="AKHIRTAHUN" className="uppercase" onChange={(event) => setBannerCode(event.target.value)} />
          </div>
        </div>
      </fieldset>

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={!dirty || save.isPending}>
          {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          Simpan
        </Button>
      </div>
    </form>
  );
}
