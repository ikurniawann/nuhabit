'use client';

// EPIC-039 Fase F — koneksi Shopee, mapping listing ↔ produk/SKU lokal,
// buffer stok per akun, dan sinkron manual (push stok + pull order).

import { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2, Plug, RefreshCw, Store, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PurchasingPageHeader } from '@/modules/purchasing/components/page/purchasing-page-header';
import { PurchasingListSection } from '@/modules/purchasing/components/list/PurchasingListSection';
import { usePosCatalogProducts } from '@/features/pos/products/queries';

type Account = {
  id: string;
  channel_code: string;
  shop_id: string;
  shop_name: string | null;
  status: string;
  stock_buffer: number;
  last_pull_at: string | null;
  link_count: string;
};

type Listing = {
  itemId: string;
  itemName: string;
  models: Array<{ modelId: string; modelName: string; modelSku: string | null }>;
};

type LinkRow = {
  id: string;
  product_name: string;
  sku_name: string | null;
  sku_code: string | null;
  marketplace_item_id: string;
  marketplace_model_id: string | null;
  marketplace_item_name: string | null;
  last_pushed_stock: string | null;
  last_push_at: string | null;
};

async function parseJson<T>(response: Response, fallback: string): Promise<T> {
  const json = await response.json();
  if (!response.ok || json.success === false) {
    throw new Error(json.error || fallback);
  }
  return json as T;
}

export function ShopMarketplacePage() {
  const { data: products = [] } = usePosCatalogProducts();
  const merchandiseProducts = products.filter((product) => product.productKind === 'merchandise');

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeAccount, setActiveAccount] = useState<Account | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Form mapping baru
  const [selListing, setSelListing] = useState(''); // itemId::modelId
  const [selLocal, setSelLocal] = useState('');     // productId::skuId

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/shop/marketplace/accounts', { cache: 'no-store' });
      const json = await parseJson<{ data: Account[] }>(response, 'Gagal memuat akun');
      setAccounts(json.data ?? []);
      if (json.data?.length && !activeAccount) {
        setActiveAccount(json.data[0]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal memuat akun');
    } finally {
      setLoading(false);
    }
  }, [activeAccount]);

  useEffect(() => {
    loadAccounts();
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected')) toast.success(`Toko Shopee ${params.get('connected')} terhubung`);
    if (params.get('error')) toast.error(params.get('error') || 'Gagal menghubungkan');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadLinks = useCallback(async (accountId: string) => {
    try {
      const response = await fetch(`/api/shop/marketplace/links?account_id=${accountId}`, {
        cache: 'no-store',
      });
      const json = await parseJson<{ data: LinkRow[] }>(response, 'Gagal memuat mapping');
      setLinks(json.data ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal memuat mapping');
    }
  }, []);

  useEffect(() => {
    if (activeAccount) loadLinks(activeAccount.id);
  }, [activeAccount, loadLinks]);

  const connectShopee = async () => {
    try {
      const response = await fetch('/api/shop/marketplace/connect', { cache: 'no-store' });
      const json = await parseJson<{ data: { auth_url: string } }>(response, 'Gagal memulai otorisasi');
      window.location.href = json.data.auth_url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal memulai otorisasi');
    }
  };

  const loadListings = async () => {
    if (!activeAccount) return;
    setListingsLoading(true);
    try {
      const response = await fetch(
        `/api/shop/marketplace/listings?account_id=${activeAccount.id}`,
        { cache: 'no-store' }
      );
      const json = await parseJson<{ data: Listing[] }>(response, 'Gagal memuat listing');
      setListings(json.data ?? []);
      if ((json.data ?? []).length === 0) toast.info('Tidak ada listing aktif di toko ini');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal memuat listing Shopee');
    } finally {
      setListingsLoading(false);
    }
  };

  const createLink = async () => {
    if (!activeAccount || !selListing || !selLocal) {
      toast.error('Pilih listing Shopee dan produk lokal dulu');
      return;
    }
    const [itemId, modelId] = selListing.split('::');
    const [productId, skuId] = selLocal.split('::');
    const listing = listings.find((entry) => entry.itemId === itemId);
    const model = listing?.models.find((entry) => entry.modelId === modelId);
    try {
      const response = await fetch('/api/shop/marketplace/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: activeAccount.id,
          product_id: productId,
          sku_id: skuId || null,
          marketplace_item_id: itemId,
          marketplace_model_id: modelId || null,
          marketplace_item_name: [listing?.itemName, model?.modelName]
            .filter(Boolean)
            .join(' — '),
        }),
      });
      await parseJson(response, 'Gagal membuat mapping');
      toast.success('Mapping tersimpan');
      setSelListing('');
      setSelLocal('');
      await loadLinks(activeAccount.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal membuat mapping');
    }
  };

  const deleteLink = async (linkId: string) => {
    if (!activeAccount) return;
    try {
      const response = await fetch(`/api/shop/marketplace/links?id=${linkId}`, {
        method: 'DELETE',
      });
      await parseJson(response, 'Gagal menghapus mapping');
      await loadLinks(activeAccount.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal menghapus mapping');
    }
  };

  const runSync = async () => {
    if (!activeAccount || syncing) return;
    setSyncing(true);
    try {
      const response = await fetch('/api/shop/marketplace/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: activeAccount.id }),
      });
      const json = await parseJson<{
        data: {
          pull: { imported: number; skipped: number; stockIssues: number };
          push: { pushed: number; failed: number };
        };
      }>(response, 'Sinkronisasi gagal');
      const { pull, push } = json.data;
      toast.success(
        `Sync selesai — ${pull.imported} order masuk, ${push.pushed} stok terkirim` +
          (pull.stockIssues ? ` (${pull.stockIssues} masalah stok — cek Pesanan)` : '')
      );
      await loadAccounts();
      await loadLinks(activeAccount.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sinkronisasi gagal');
    } finally {
      setSyncing(false);
    }
  };

  const updateBuffer = async (account: Account, raw: string) => {
    const buffer = Math.max(0, Math.floor(Number(raw)) || 0);
    if (buffer === account.stock_buffer) return;
    try {
      const response = await fetch('/api/shop/marketplace/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: account.id, stock_buffer: buffer }),
      });
      await parseJson(response, 'Gagal menyimpan buffer');
      toast.success(`Buffer stok = ${buffer}`);
      await loadAccounts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal menyimpan buffer');
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Marketplace"
        description="Omnichannel Shopee: BCD Coffee sebagai master stok — push stok, tarik pesanan."
      />

      <PurchasingListSection
        icon={Store}
        title="Akun Terhubung"
        description="Kredensial partner via env SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY"
        toolbar={
          <Button type="button" onClick={connectShopee} className="purchasing-main-button h-9">
            <Plug className="mr-1.5 h-4 w-4" />
            Hubungkan Toko Shopee
          </Button>
        }
      >
        {loading ? (
          <div className="flex justify-center px-4 py-10">
            <Loader2 className="h-6 w-6 animate-spin text-pink-500" />
          </div>
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
                  onClick={() => setActiveAccount(account)}
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
                    {account.last_pull_at
                      ? new Date(account.last_pull_at).toLocaleString('id-ID')
                      : 'belum pernah'}
                  </p>
                </button>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">Buffer stok</label>
                  <Input
                    type="number"
                    min={0}
                    defaultValue={account.stock_buffer}
                    onBlur={(event) => updateBuffer(account, event.target.value)}
                    className="h-8 w-20 text-right text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={syncing || account.status !== 'connected'}
                    onClick={() => {
                      setActiveAccount(account);
                      runSync();
                    }}
                    className="h-8"
                  >
                    {syncing && activeAccount?.id === account.id ? (
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

      {activeAccount ? (
        <PurchasingListSection
          icon={Link2}
          title={`Mapping Produk — ${activeAccount.shop_name || activeAccount.shop_id}`}
          description="Tautkan listing Shopee (item/variasi) ke produk/SKU lokal"
          toolbar={
            <Button type="button" variant="outline" size="sm" onClick={loadListings} className="h-9">
              {listingsLoading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Muat Listing Shopee
            </Button>
          }
        >
          <div className="space-y-4 px-5 py-4">
            {listings.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <select
                  value={selListing}
                  onChange={(event) => setSelListing(event.target.value)}
                  className="h-10 rounded-lg border border-gray-200/80 bg-white px-3 text-sm outline-none focus:border-pink-300"
                >
                  <option value="">— Pilih listing Shopee —</option>
                  {listings.flatMap((listing) =>
                    listing.models.length > 0
                      ? listing.models.map((model) => (
                          <option
                            key={`${listing.itemId}::${model.modelId}`}
                            value={`${listing.itemId}::${model.modelId}`}
                          >
                            {listing.itemName} — {model.modelName}
                          </option>
                        ))
                      : [
                          <option key={`${listing.itemId}::`} value={`${listing.itemId}::`}>
                            {listing.itemName}
                          </option>,
                        ]
                  )}
                </select>
                <select
                  value={selLocal}
                  onChange={(event) => setSelLocal(event.target.value)}
                  className="h-10 rounded-lg border border-gray-200/80 bg-white px-3 text-sm outline-none focus:border-pink-300"
                >
                  <option value="">— Pilih produk/SKU lokal —</option>
                  {merchandiseProducts.flatMap((product) =>
                    product.merchSkus.length > 0
                      ? product.merchSkus.map((sku) => (
                          <option key={`${product.id}::${sku.id}`} value={`${product.id}::${sku.id}`}>
                            {product.name} — {sku.name} ({sku.sku})
                          </option>
                        ))
                      : [
                          <option key={`${product.id}::`} value={`${product.id}::`}>
                            {product.name}
                          </option>,
                        ]
                  )}
                </select>
                <Button type="button" onClick={createLink} className="purchasing-main-button h-10">
                  Tautkan
                </Button>
              </div>
            ) : (
              <p className="text-xs text-gray-400">
                Klik &quot;Muat Listing Shopee&quot; untuk mengambil daftar produk toko, lalu
                tautkan ke produk lokal.
              </p>
            )}

            {links.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">Listing Shopee</th>
                      <th className="px-4 py-2 text-left font-semibold">Produk Lokal</th>
                      <th className="px-4 py-2 text-right font-semibold">Stok Terpush</th>
                      <th className="px-4 py-2 text-center font-semibold"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {links.map((link) => (
                      <tr key={link.id}>
                        <td className="px-4 py-2">
                          <p className="text-gray-900">
                            {link.marketplace_item_name || link.marketplace_item_id}
                          </p>
                          <p className="text-xs text-gray-400">
                            item {link.marketplace_item_id}
                            {link.marketplace_model_id ? ` / model ${link.marketplace_model_id}` : ''}
                          </p>
                        </td>
                        <td className="px-4 py-2 text-gray-700">
                          {link.product_name}
                          {link.sku_name ? ` — ${link.sku_name} (${link.sku_code})` : ''}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-700">
                          {link.last_pushed_stock ?? '—'}
                          {link.last_push_at ? (
                            <span className="block text-xs text-gray-400">
                              {new Date(link.last_push_at).toLocaleString('id-ID')}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => deleteLink(link.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-gray-400">Belum ada mapping untuk toko ini.</p>
            )}
          </div>
        </PurchasingListSection>
      ) : null}
    </div>
  );
}
