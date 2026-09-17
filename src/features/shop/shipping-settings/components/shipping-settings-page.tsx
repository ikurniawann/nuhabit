'use client';

// EPIC-039 Fase C — Settings → Pengiriman (Kurir): provider (Biteship /
// RajaOngkir), alamat origin (cari area sesuai provider), kurir aktif,
// markup ongkir, plus panel uji cek tarif langsung.

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MapPin, Save, Search, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PurchasingPageHeader } from '@/modules/purchasing/components/page/purchasing-page-header';
import { PurchasingListSection } from '@/modules/purchasing/components/list/PurchasingListSection';
import { formatAmount } from '@/lib/purchasing/utils';

type ShippingSettings = {
  id: string;
  provider: 'biteship' | 'rajaongkir';
  origin_area_id: string | null;
  origin_district_id: string | null;
  origin_label: string | null;
  origin_postal_code: string | null;
  origin_address: string | null;
  origin_contact_name: string | null;
  origin_contact_phone: string | null;
  couriers: string;
  markup_amount: number | string;
};

type AreaSuggestion = {
  id: string;
  label: string;
  postalCode: string | null;
};

type RateQuote = {
  courierName: string;
  serviceName: string;
  price: number;
  total_price: number;
  etd: string | null;
};

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

async function parseJson<T>(response: Response, fallback: string): Promise<T> {
  const json = await response.json();
  if (!response.ok || json.success === false) {
    throw new Error(json.error || fallback);
  }
  return json as T;
}

export function ShippingSettingsPage() {
  const [settings, setSettings] = useState<ShippingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [originQuery, setOriginQuery] = useState('');
  const [originSuggestions, setOriginSuggestions] = useState<AreaSuggestion[]>([]);
  const [searchingOrigin, setSearchingOrigin] = useState(false);

  // Panel uji tarif
  const [testQuery, setTestQuery] = useState('');
  const [testSuggestions, setTestSuggestions] = useState<AreaSuggestion[]>([]);
  const [testDestination, setTestDestination] = useState<AreaSuggestion | null>(null);
  const [testWeight, setTestWeight] = useState('1000');
  const [testQuotes, setTestQuotes] = useState<RateQuote[]>([]);
  const [testingRates, setTestingRates] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/shop/shipping/settings', { cache: 'no-store' });
      const json = await parseJson<{ data: ShippingSettings }>(response, 'Gagal memuat settings');
      setSettings(json.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal memuat settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const searchAreas = useCallback(async (query: string): Promise<AreaSuggestion[]> => {
    const response = await fetch(`/api/shop/shipping/areas?q=${encodeURIComponent(query)}`, {
      cache: 'no-store',
    });
    const json = await parseJson<{ data: AreaSuggestion[] }>(response, 'Gagal mencari area');
    return json.data ?? [];
  }, []);

  // Debounce pencarian origin
  useEffect(() => {
    if (originQuery.trim().length < 3) {
      setOriginSuggestions([]);
      return;
    }
    const timeout = window.setTimeout(async () => {
      setSearchingOrigin(true);
      try {
        setOriginSuggestions(await searchAreas(originQuery.trim()));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Gagal mencari area');
      } finally {
        setSearchingOrigin(false);
      }
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [originQuery, searchAreas]);

  // Debounce pencarian tujuan uji
  useEffect(() => {
    if (testQuery.trim().length < 3) {
      setTestSuggestions([]);
      return;
    }
    const timeout = window.setTimeout(async () => {
      try {
        setTestSuggestions(await searchAreas(testQuery.trim()));
      } catch {
        setTestSuggestions([]);
      }
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [testQuery, searchAreas]);

  const patchSettings = useCallback(
    async (payload: Record<string, unknown>, successMessage: string) => {
      setSaving(true);
      try {
        const response = await fetch('/api/shop/shipping/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await parseJson<{ data: ShippingSettings }>(response, 'Gagal menyimpan');
        setSettings(json.data);
        toast.success(successMessage);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Gagal menyimpan');
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const selectOrigin = (area: AreaSuggestion) => {
    if (!settings) return;
    const isRajaOngkir = settings.provider === 'rajaongkir';
    patchSettings(
      {
        [isRajaOngkir ? 'origin_district_id' : 'origin_area_id']: area.id,
        origin_label: area.label,
        origin_postal_code: area.postalCode,
      },
      'Origin toko tersimpan'
    );
    setOriginQuery('');
    setOriginSuggestions([]);
  };

  const toggleCourier = (code: string) => {
    if (!settings) return;
    const current = settings.couriers.split(',').map((c) => c.trim()).filter(Boolean);
    const next = current.includes(code)
      ? current.filter((c) => c !== code)
      : [...current, code];
    if (next.length === 0) {
      toast.error('Minimal satu kurir harus aktif');
      return;
    }
    patchSettings({ couriers: next.join(',') }, 'Daftar kurir tersimpan');
  };

  const runRateTest = async () => {
    if (!testDestination) {
      toast.error('Pilih area tujuan uji dulu');
      return;
    }
    setTestingRates(true);
    setTestQuotes([]);
    try {
      const response = await fetch('/api/shop/shipping/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination_id: testDestination.id,
          destination_postal_code: testDestination.postalCode,
          weight_gram: Number(testWeight) || 1000,
        }),
      });
      const json = await parseJson<{ data: RateQuote[] }>(response, 'Gagal cek tarif');
      setTestQuotes(json.data ?? []);
      if ((json.data ?? []).length === 0) {
        toast.info('Tidak ada tarif — cek kurir aktif / area tujuan');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal cek tarif');
    } finally {
      setTestingRates(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-24 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin text-pink-500" />
        <p className="text-sm">Memuat settings pengiriman...</p>
      </div>
    );
  }

  const activeCouriers = settings.couriers.split(',').map((c) => c.trim());
  const originId =
    settings.provider === 'rajaongkir' ? settings.origin_district_id : settings.origin_area_id;

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Pengiriman (Kurir)"
        description="Provider ongkir toko online: pilih Biteship atau RajaOngkir, atur origin, kurir aktif & markup."
      />

      <PurchasingListSection icon={Truck} title="Provider & Origin" description="API key diatur lewat environment server (BITESHIP_API_KEY / RAJAONGKIR_API_KEY)">
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
                  onClick={() => patchSettings({ provider }, `Provider diganti ke ${provider}`)}
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
                onBlur={(event) => {
                  if (event.target.value !== (settings.origin_contact_name ?? '')) {
                    patchSettings({ origin_contact_name: event.target.value }, 'Nama pengirim tersimpan');
                  }
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">No. HP pengirim</label>
              <Input
                defaultValue={settings.origin_contact_phone ?? ''}
                placeholder="08xxxxxxxxxx"
                onBlur={(event) => {
                  if (event.target.value !== (settings.origin_contact_phone ?? '')) {
                    patchSettings({ origin_contact_phone: event.target.value }, 'No. HP tersimpan');
                  }
                }}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">Alamat lengkap origin</label>
            <Input
              defaultValue={settings.origin_address ?? ''}
              placeholder="Jl. ... (alamat penjemputan paket)"
              onBlur={(event) => {
                if (event.target.value !== (settings.origin_address ?? '')) {
                  patchSettings({ origin_address: event.target.value }, 'Alamat origin tersimpan');
                }
              }}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">
              Area origin ({settings.provider === 'rajaongkir' ? 'kecamatan RajaOngkir' : 'area Biteship'})
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
              {searchingOrigin ? (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
              ) : null}
              {originSuggestions.length > 0 ? (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                  {originSuggestions.map((area) => (
                    <button
                      key={area.id}
                      type="button"
                      onClick={() => selectOrigin(area)}
                      className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-pink-50"
                    >
                      {area.label}
                      {area.postalCode ? ` (${area.postalCode})` : ''}
                    </button>
                  ))}
                </div>
              ) : null}
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
                  patchSettings({ markup_amount: value }, 'Markup tersimpan');
                }
              }}
            />
          </div>
        </div>
      </PurchasingListSection>

      <PurchasingListSection
        icon={Search}
        title="Uji Cek Tarif"
        description="Coba hitung ongkir dari origin toko ke area tujuan mana pun"
      >
        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="relative sm:col-span-2">
              <label className="mb-1 block text-xs text-gray-500">Area tujuan</label>
              <Input
                value={testDestination ? testDestination.label : testQuery}
                placeholder="Cari kecamatan/kota tujuan..."
                onChange={(event) => {
                  setTestDestination(null);
                  setTestQuery(event.target.value);
                }}
              />
              {!testDestination && testSuggestions.length > 0 ? (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                  {testSuggestions.map((area) => (
                    <button
                      key={area.id}
                      type="button"
                      onClick={() => {
                        setTestDestination(area);
                        setTestSuggestions([]);
                      }}
                      className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-pink-50"
                    >
                      {area.label}
                      {area.postalCode ? ` (${area.postalCode})` : ''}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Berat (gram)</label>
              <Input
                type="number"
                min={1}
                value={testWeight}
                onChange={(event) => setTestWeight(event.target.value)}
              />
            </div>
          </div>
          <Button type="button" onClick={runRateTest} disabled={testingRates} className="purchasing-main-button">
            {testingRates ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Cek Tarif
          </Button>

          {testQuotes.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Kurir</th>
                    <th className="px-4 py-2 text-left font-semibold">Layanan</th>
                    <th className="px-4 py-2 text-left font-semibold">Estimasi</th>
                    <th className="px-4 py-2 text-right font-semibold">Ongkir + Markup</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {testQuotes.map((quote, index) => (
                    <tr key={index}>
                      <td className="px-4 py-2 font-medium text-gray-900">{quote.courierName}</td>
                      <td className="px-4 py-2 text-gray-700">{quote.serviceName}</td>
                      <td className="px-4 py-2 text-gray-500">{quote.etd || '—'}</td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-900">
                        {formatAmount(quote.total_price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </PurchasingListSection>
    </div>
  );
}
