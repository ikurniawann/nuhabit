'use client';

// EPIC-039 Fase C — Settings → Pengiriman (Kurir): provider (Biteship /
// RajaOngkir), alamat origin (cari area sesuai provider), kurir aktif,
// markup ongkir, plus panel uji cek tarif langsung.

import { useEffect, useState, type FocusEvent } from 'react';
import { Loader2, MapPin, Search, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PurchasingPageHeader } from '@/features/purchasing/components/shared/purchasing-page-header';
import { PurchasingListSection } from '@/features/purchasing/components/shared/purchasing-list-section';
import { useAreaSearch, type AreaSuggestion } from '@/features/shop/shared/area-search';
import { AreaSuggestions } from '@/features/shop/shared/area-suggestions';
import { useShippingSettings, useUpdateShippingSettings, type ShippingSettings } from '../queries';
import { RateTestSection } from './rate-test-section';
import { StorefrontSettingsSection } from './storefront-settings-section';

const COURIER_CHOICES = [
  { code: 'jne', label: 'JNE' },
  { code: 'jnt', label: 'J&T' },
  { code: 'sicepat', label: 'SiCepat' },
  { code: 'anteraja', label: 'AnterAja' },
  { code: 'pos', label: 'POS Indonesia' },
  { code: 'tiki', label: 'TIKI' },
  { code: 'gojek', label: 'GoSend (instan)' },
  { code: 'grab', label: 'GrabExpress (instan)' },
];

type TextField = 'origin_contact_name' | 'origin_contact_phone' | 'origin_address';

export function ShippingSettingsPage() {
  const { data: settings, error } = useShippingSettings();

  if (error) {
    return (
      <p className="px-4 py-24 text-center text-sm text-red-500">
        {error.message || 'Gagal memuat settings'}
      </p>
    );
  }
  if (!settings) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-24 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin text-pink-500" />
        <p className="text-sm">Memuat settings pengiriman...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Pengiriman & Storefront"
        description="Provider ongkir toko online (Biteship atau RajaOngkir, origin, kurir aktif, markup) dan pengaturan storefront."
      />
      <StorefrontSettingsSection />
      <ProviderSection settings={settings} />
      <RateTestSection />
    </div>
  );
}

function ProviderSection({ settings }: { settings: ShippingSettings }) {
  const update = useUpdateShippingSettings();
  const saving = update.isPending;
  const patch = (fields: Record<string, unknown>, successMessage: string) =>
    update.mutate({ patch: fields, successMessage });

  const [originQuery, setOriginQuery] = useState('');
  const origin = useAreaSearch('/api/shop/shipping/areas', originQuery);
  useEffect(() => {
    if (origin.error) toast.error(origin.error.message || 'Gagal mencari area');
  }, [origin.error]);

  const isRajaOngkir = settings.provider === 'rajaongkir';
  const originId = isRajaOngkir ? settings.origin_district_id : settings.origin_area_id;
  const activeCouriers = settings.couriers.split(',').map((c) => c.trim()).filter(Boolean);

  const selectOrigin = (area: AreaSuggestion) => {
    patch(
      {
        [isRajaOngkir ? 'origin_district_id' : 'origin_area_id']: area.id,
        origin_label: area.label,
        origin_postal_code: area.postalCode,
      },
      'Origin toko tersimpan'
    );
    setOriginQuery('');
  };

  const toggleCourier = (code: string) => {
    const next = activeCouriers.includes(code)
      ? activeCouriers.filter((c) => c !== code)
      : [...activeCouriers, code];
    if (next.length === 0) {
      toast.error('Minimal satu kurir harus aktif');
      return;
    }
    patch({ couriers: next.join(',') }, 'Daftar kurir tersimpan');
  };

  const saveTextOnBlur = (field: TextField, successMessage: string) => (event: FocusEvent<HTMLInputElement>) => {
    if (event.target.value !== (settings[field] ?? '')) patch({ [field]: event.target.value }, successMessage);
  };

  return (
    <PurchasingListSection
      icon={Truck}
      title="Provider & Origin"
      description="API key diatur lewat environment server (BITESHIP_API_KEY / RAJAONGKIR_API_KEY)"
    >
      <div className="space-y-5 px-5 py-4">
        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-gray-500">
            Provider aktif
          </label>
          <div className="flex gap-2">
            {(['biteship', 'rajaongkir'] as const).map((provider) => (
              <Button
                key={provider}
                type="button"
                variant={settings.provider === provider ? 'default' : 'outline'}
                disabled={saving}
                onClick={() => patch({ provider }, `Provider diganti ke ${provider}`)}
              >
                {provider === 'biteship' ? 'Biteship' : 'RajaOngkir (Komerce)'}
              </Button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            Biteship: tarif + buat pengiriman + tracking otomatis. RajaOngkir: tarif + lacak
            resi (pengiriman dibuat manual, resi diinput di pesanan).
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Nama pengirim</label>
            <Input
              defaultValue={settings.origin_contact_name ?? ''}
              placeholder="Toko BCD"
              onBlur={saveTextOnBlur('origin_contact_name', 'Nama pengirim tersimpan')}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">No. HP pengirim</label>
            <Input
              defaultValue={settings.origin_contact_phone ?? ''}
              placeholder="08xxxxxxxxxx"
              onBlur={saveTextOnBlur('origin_contact_phone', 'No. HP tersimpan')}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-500">Alamat lengkap origin</label>
          <Input
            defaultValue={settings.origin_address ?? ''}
            placeholder="Jl. ... (alamat penjemputan paket)"
            onBlur={saveTextOnBlur('origin_address', 'Alamat origin tersimpan')}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-500">
            Area origin ({isRajaOngkir ? 'kecamatan RajaOngkir' : 'area Biteship'})
          </label>
          {originId ? (
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700">
              <MapPin className="h-3.5 w-3.5" />
              {settings.origin_label || originId}
              {settings.origin_postal_code ? ` (${settings.origin_postal_code})` : ''}
            </p>
          ) : (
            <p className="mb-2 text-xs text-amber-600">
              Belum diatur — cek tarif tidak bisa jalan sebelum origin dipilih.
            </p>
          )}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={originQuery}
              placeholder="Cari kecamatan/kota origin (min 3 huruf)..."
              className="pl-9"
              onChange={(event) => setOriginQuery(event.target.value)}
            />
            {origin.searching ? (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
            ) : null}
            <AreaSuggestions areas={origin.areas} onSelect={selectOrigin} />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-gray-500">
            Kurir aktif
          </label>
          <div className="flex flex-wrap gap-2">
            {COURIER_CHOICES.map((courier) => (
              <Button
                key={courier.code}
                type="button"
                size="sm"
                variant={activeCouriers.includes(courier.code) ? 'default' : 'outline'}
                disabled={saving}
                onClick={() => toggleCourier(courier.code)}
              >
                {courier.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="max-w-xs">
          <label className="mb-1 block text-xs text-gray-500">Markup ongkir (Rp, flat)</label>
          <Input
            type="number"
            min={0}
            defaultValue={String(settings.markup_amount ?? 0)}
            onBlur={(event) => {
              const value = Number(event.target.value) || 0;
              if (value !== Number(settings.markup_amount)) {
                patch({ markup_amount: value }, 'Markup tersimpan');
              }
            }}
          />
        </div>
      </div>
    </PurchasingListSection>
  );
}
