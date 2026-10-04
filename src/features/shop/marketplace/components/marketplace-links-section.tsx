'use client';

import { useState } from 'react';
import { Link2, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PurchasingListSection } from '@/features/purchasing/components/shared/purchasing-list-section';
import { usePosCatalogProducts } from '@/features/pos/products/queries';
import { formatDateTime } from '@/lib/format';
import {
  useCreateMarketplaceLink,
  useDeleteMarketplaceLink,
  useLoadListings,
  useMarketplaceLinks,
  type MarketplaceAccount,
} from '../queries';

const SELECT_CLASS =
  'h-10 rounded-lg border border-gray-200/80 bg-white px-3 text-sm outline-none focus:border-pink-300';

/**
 * Mapping listing Shopee (item/variasi) ↔ produk/SKU lokal untuk satu akun.
 * Parent me-render dengan key=account.id supaya listing & pilihan ter-reset
 * saat ganti akun.
 */
export function MarketplaceLinksSection({ account }: { account: MarketplaceAccount }) {
  const { data: products = [] } = usePosCatalogProducts();
  const merchandiseProducts = products.filter((product) => product.productKind === 'merchandise');
  const { data: links = [] } = useMarketplaceLinks(account.id);
  const listingsMutation = useLoadListings();
  const listings = listingsMutation.data ?? [];
  const createLink = useCreateMarketplaceLink();
  const deleteLink = useDeleteMarketplaceLink();

  const [selListing, setSelListing] = useState(''); // itemId::modelId
  const [selLocal, setSelLocal] = useState(''); // productId::skuId

  const submitLink = () => {
    if (!selListing || !selLocal) {
      toast.error('Pilih listing Shopee dan produk lokal dulu');
      return;
    }
    const [itemId, modelId] = selListing.split('::');
    const [productId, skuId] = selLocal.split('::');
    const listing = listings.find((entry) => entry.itemId === itemId);
    const model = listing?.models.find((entry) => entry.modelId === modelId);
    createLink.mutate(
      {
        account_id: account.id,
        product_id: productId,
        sku_id: skuId || null,
        marketplace_item_id: itemId,
        marketplace_model_id: modelId || null,
        marketplace_item_name: [listing?.itemName, model?.modelName].filter(Boolean).join(' — '),
      },
      {
        onSuccess: () => {
          setSelListing('');
          setSelLocal('');
        },
      }
    );
  };

  return (
    <PurchasingListSection
      icon={Link2}
      title={`Mapping Produk — ${account.shop_name || account.shop_id}`}
      description="Tautkan listing Shopee (item/variasi) ke produk/SKU lokal"
      toolbar={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => listingsMutation.mutate(account.id)}
          className="h-9"
        >
          {listingsMutation.isPending ? (
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
              className={SELECT_CLASS}
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
              className={SELECT_CLASS}
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
            <Button
              type="button"
              onClick={submitLink}
              disabled={createLink.isPending}
              className="purchasing-main-button h-10"
            >
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
                          {formatDateTime(link.last_push_at)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={deleteLink.isPending}
                        onClick={() => deleteLink.mutate(link.id)}
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
  );
}
