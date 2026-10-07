'use client';

import { useState } from 'react';
import { Loader2, Save, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PurchasingListSection } from '@/features/purchasing/components/shared/purchasing-list-section';
import { formatRupiah } from '@/lib/format';
import { useAreaSearch, type AreaSuggestion } from '@/features/shop/shared/area-search';
import { AreaSuggestions } from '@/features/shop/shared/area-suggestions';
import { useRateTest } from '../queries';

/** Panel uji: hitung ongkir dari origin toko ke area tujuan mana pun. */
export function RateTestSection() {
  const [query, setQuery] = useState('');
  const [destination, setDestination] = useState<AreaSuggestion | null>(null);
  const [weight, setWeight] = useState('1000');
  const { areas } = useAreaSearch('/api/shop/shipping/areas', query, destination === null);
  const rateTest = useRateTest();
  const quotes = rateTest.data ?? [];

  const runRateTest = () => {
    if (!destination) {
      toast.error('Pilih area tujuan uji dulu');
      return;
    }
    rateTest.mutate({
      destination_id: destination.id,
      destination_postal_code: destination.postalCode,
      weight_gram: Number(weight) || 1000,
    });
  };

  return (
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
              value={destination ? destination.label : query}
              placeholder="Cari kecamatan/kota tujuan..."
              onChange={(event) => {
                setDestination(null);
                setQuery(event.target.value);
              }}
            />
            <AreaSuggestions areas={areas} onSelect={setDestination} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Berat (gram)</label>
            <Input type="number" min={1} value={weight} onChange={(event) => setWeight(event.target.value)} />
          </div>
        </div>
        <Button type="button" onClick={runRateTest} disabled={rateTest.isPending} className="purchasing-main-button">
          {rateTest.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Cek Tarif
        </Button>

        {!rateTest.isPending && quotes.length > 0 ? (
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
                {quotes.map((quote, index) => (
                  <tr key={index}>
                    <td className="px-4 py-2 font-medium text-gray-900">{quote.courierName}</td>
                    <td className="px-4 py-2 text-gray-700">{quote.serviceName}</td>
                    <td className="px-4 py-2 text-gray-500">{quote.etd || '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-900">
                      {formatRupiah(quote.total_price)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </PurchasingListSection>
  );
}
