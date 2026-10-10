'use client';

import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from '@/components/ui/dialog';
import { syncMerchSkus } from '../api';
import {
  merchFormFromProduct,
  skuRowPayload,
  skuRowsFromMatrix,
  skuRowsFromProduct,
  validateMerchSettings,
  type MerchFormState,
} from '../product-rules';
import { usePurchasingProductOptions } from '../queries';
import type { PatchPosProductPayload, PosCatalogProduct } from '../types';
import { MerchSkuEditor } from './merch-sku-editor';
import { SkuMatrixPanel } from './sku-matrix-panel';

const selectClass =
  'h-10 w-full rounded-lg border border-gray-200/80 bg-white px-3 text-sm text-gray-700 outline-none transition focus:border-pink-300 focus:ring-1 focus:ring-pink-100 disabled:opacity-50';

/**
 * EPIC-039 — pengaturan merchandise: tautan purchasing, stok, berat, katalog
 * web, matriks varian dan varian ber-SKU. Render dengan key=product.id.
 */
export function MerchSettingsDialog({
  product,
  saving,
  onClose,
  onSaveProduct,
}: {
  product: PosCatalogProduct;
  saving: boolean;
  onClose: () => void;
  /** Patch produk (invalidasi katalog sekaligus memuat ulang SKU yang baru disinkronkan). */
  onSaveProduct: (payload: PatchPosProductPayload) => Promise<void>;
}) {
  const [form, setForm] = useState<MerchFormState>(() => merchFormFromProduct(product));
  const [skuRows, setSkuRows] = useState(() => skuRowsFromProduct(product));
  const [busy, setBusy] = useState(false);
  const [sizeGuide, setSizeGuide] = useState(product.sizeGuide ?? '');
  const options = usePurchasingProductOptions(true);
  const hasLiveSkus = skuRows.some((row) => !row.deleted);
  const patchForm = (patch: Partial<MerchFormState>) => setForm((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    if (options.error) toast.error('Gagal memuat master purchasing — tautan tetap bisa dikosongkan');
  }, [options.error]);

  async function save() {
    if (saving || busy) return;
    const checked = validateMerchSettings(form, skuRows, product.price);
    if (!checked.ok) {
      toast.error(checked.error);
      return;
    }
    setBusy(true);
    try {
      await syncMerchSkus(
        product.id,
        skuRows.map((row) => ({ id: row.id, deleted: row.deleted, payload: skuRowPayload(row) }))
      );
      await onSaveProduct({
        source_product_id: form.sourceProductId || null,
        inventory_quantity: checked.stock,
        inventory_tracking: true,
        weight_gram: checked.weightGram,
        size_guide: sizeGuide.trim() || null,
        web_distributed: form.webDistributed,
        sale_price_idr: checked.salePriceIdr,
        sale_until: checked.saleUntil,
        is_featured: form.isFeatured,
        is_new: form.isNew,
      });
      toast.success('Pengaturan merchandise tersimpan');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal menyimpan pengaturan merchandise');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>Pengaturan Merchandise</DialogPanelTitle>
          <DialogPanelDescription>{product.name}</DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="max-h-[65vh] space-y-4 overflow-y-auto">
          <div>
            <label htmlFor="merch-source" className="mb-1 block text-xs text-gray-500">
              Tautan master purchasing (item barang jadi)
            </label>
            <select
              id="merch-source"
              value={form.sourceProductId}
              onChange={(event) => patchForm({ sourceProductId: event.target.value })}
              disabled={options.isLoading}
              className={selectClass}
            >
              <option value="">— Tanpa tautan (stok diisi manual) —</option>
              {(options.data ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.kode ? `${option.kode} — ` : ''}
                  {option.nama || option.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-400">
              Bila tertaut, penerimaan barang (GRN) purchasing jalur Product otomatis menambah stok produk ini.
            </p>
          </div>

          <div>
            <label htmlFor="merch-size-guide" className="mb-1 block text-xs text-gray-500">Panduan ukuran untuk toko online</label>
            <textarea id="merch-size-guide" value={sizeGuide} onChange={(event) => setSizeGuide(event.target.value)} rows={4} className="w-full rounded-lg border border-gray-200/80 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-pink-300" placeholder={'Contoh format: S — lingkar dada … cm, panjang … cm\nM — lingkar dada … cm, panjang … cm'} />
            <p className="mt-1 text-xs text-gray-400">Isi ukuran produk yang sudah diukur. Kosongkan bila belum tersedia.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="merch-stock" className="mb-1 block text-xs text-gray-500">
                Stok saat ini{hasLiveSkus ? ' (diabaikan — pakai stok per varian)' : ''}
              </label>
              <Input
                id="merch-stock"
                type="number"
                min={0}
                value={form.stock}
                disabled={hasLiveSkus}
                onChange={(event) => patchForm({ stock: event.target.value })}
              />
            </div>
            <div>
              <label htmlFor="merch-weight" className="mb-1 block text-xs text-gray-500">
                Berat (gram)
              </label>
              <Input
                id="merch-weight"
                type="number"
                min={0}
                placeholder="utk ongkir toko online"
                value={form.weightGram}
                onChange={(event) => patchForm({ weightGram: event.target.value })}
              />
            </div>
          </div>

          {/* EPIC-039 Fase D — distribusi katalog toko online */}
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.webDistributed}
              onChange={(event) => patchForm({ webDistributed: event.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-pink-600"
            />
            Tampilkan di toko online (katalog web)
          </label>

          <fieldset className="space-y-3 rounded-lg border border-gray-200/80 p-3">
            <legend className="px-1 text-xs font-semibold text-gray-700">Promo dan sorotan toko online</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="merch-sale-price" className="mb-1 block text-xs text-gray-500">Harga promo (Rp)</label>
                <Input
                  id="merch-sale-price"
                  type="number"
                  min={0}
                  placeholder={`Normal ${product.price.toLocaleString('id-ID')}`}
                  value={form.salePrice}
                  onChange={(event) => patchForm({ salePrice: event.target.value })}
                />
              </div>
              <div>
                <label htmlFor="merch-sale-until" className="mb-1 block text-xs text-gray-500">Promo berakhir</label>
                <Input
                  id="merch-sale-until"
                  type="date"
                  value={form.saleUntil}
                  disabled={form.salePrice.trim() === ''}
                  onChange={(event) => patchForm({ saleUntil: event.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-gray-400">Harga promo tampil dicoret dengan harga normal di katalog, keranjang dan invoice. Kosongkan tanggal untuk promo tanpa batas.</p>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.isFeatured}
                  onChange={(event) => patchForm({ isFeatured: event.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-pink-600"
                />
                Produk unggulan (Featured)
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.isNew}
                  onChange={(event) => patchForm({ isNew: event.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-pink-600"
                />
                Produk baru (New arrivals)
              </label>
            </div>
          </fieldset>

          {product.productKind === 'merchandise' ? (
            <SkuMatrixPanel productId={product.id} onGenerated={(skus) => setSkuRows(skuRowsFromMatrix(skus))} />
          ) : null}

          <MerchSkuEditor rows={skuRows} onChange={setSkuRows} />
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || busy} className="purchasing-main-button">
            <Save className="mr-2 h-4 w-4" />
            Simpan
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
