'use client';

// EPIC-039 Fase F — koneksi Shopee, mapping listing ↔ produk/SKU lokal,
// buffer stok per akun, dan sinkron manual (push stok + pull order).

import { useEffect, useState } from 'react';
import { Loader2, Plug, RefreshCw, Store } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PurchasingPageHeader } from '@/features/purchasing/components/shared/purchasing-page-header';
import { PurchasingListSection } from '@/features/purchasing/components/shared/purchasing-list-section';
import { formatDateTime } from '@/lib/format';
import {
  startShopeeConnect,
  useMarketplaceAccounts,
  useSyncMarketplaceAccount,
  useUpdateStockBuffer,
  type MarketplaceAccount,
} from '../queries';
import { MarketplaceLinksSection } from './marketplace-links-section';

export function ShopMarketplacePage() {
  const accountsQuery = useMarketplaceAccounts();
  const accounts = accountsQuery.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeAccount = accounts.find((account) => account.id === selectedId) ?? accounts[0] ?? null;
  const sync = useSyncMarketplaceAccount();
  const updateBuffer = useUpdateStockBuffer();

  // Hasil redirect callback Shopee (?connected=… / ?error=…)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const error = params.get('error');
    if (connected) toast.success(`Toko Shopee ${connected} terhubung`);
    if (error) toast.error(error);
  }, []);

  const saveBuffer = (account: MarketplaceAccount, raw: string) => {
    const buffer = Math.max(0, Math.floor(Number(raw)) || 0);
    if (buffer !== account.stock_buffer) updateBuffer.mutate({ id: account.id, stock_buffer: buffer });
  };

  const runSync = (account: MarketplaceAccount) => {
    if (sync.isPending) return;
    setSelectedId(account.id);
    sync.mutate(account.id);
  };

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Marketplace"
        description="Omnichannel Shopee: NüHabit sebagai master stok — push stok, tarik pesanan."
      />

      <PurchasingListSection
        icon={Store}
        title="Akun Terhubung"
        description="Kredensial partner via env SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY"
        toolbar={
          <Button type="button" onClick={startShopeeConnect} className="purchasing-main-button h-9">
            <Plug className="mr-1.5 h-4 w-4" />
            Hubungkan Toko Shopee
          </Button>
        }
      >
        {accountsQuery.isPending ? (
          <div className="flex justify-center px-4 py-10">
            <Loader2 className="h-6 w-6 animate-spin text-pink-500" />
          </div>
        ) : accountsQuery.isError ? (
          <p className="px-5 py-10 text-center text-sm text-red-500">
            {accountsQuery.error.message || 'Gagal memuat akun'}
          </p>
        ) : accounts.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400">
            Belum ada toko terhubung — klik &quot;Hubungkan Toko Shopee&quot;.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {accounts.map((account) => (
              <div
                key={account.id}
                className={`flex flex-wrap items-center gap-3 px-5 py-3 ${activeAccount?.id === account.id ? 'bg-pink-50/40' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(account.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="font-medium text-gray-900">
                    {account.shop_name || `Shopee ${account.shop_id}`}
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                        account.status === 'connected'
                          ? 'bg-green-50 text-green-700'
                          : 'bg-red-50 text-red-600'
                      }`}
                    >
                      {account.status}
                    </span>
                  </p>
                  <p className="text-xs text-gray-400">
                    {account.link_count} mapping · pull terakhir:{' '}
                    {formatDateTime(account.last_pull_at, 'belum pernah')}
                  </p>
                </button>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">Buffer stok</label>
                  <Input
                    type="number"
                    min={0}
                    defaultValue={account.stock_buffer}
                    onBlur={(event) => saveBuffer(account, event.target.value)}
                    className="h-8 w-20 text-right text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={sync.isPending || account.status !== 'connected'}
                    onClick={() => runSync(account)}
                    className="h-8"
                  >
                    {sync.isPending && sync.variables === account.id ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    )}
                    Sync
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </PurchasingListSection>

      {activeAccount ? <MarketplaceLinksSection key={activeAccount.id} account={activeAccount} /> : null}
    </div>
  );
}
