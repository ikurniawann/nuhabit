'use client';

// EPIC-039 Fase B — pemilih varian merchandise ber-SKU di kasir.
// Stok tampil per varian; varian stok ≤ 0 tetap bisa dipilih (server yang
// menolak bila allow_negative_stock produk dimatikan) tapi diberi tanda merah.

import { useMemo } from 'react';
import { Boxes } from 'lucide-react';
import type { Product, ProductSku } from '@/lib/pos-api';
import {
  Dialog,
  DialogPanel,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelDescription,
  DialogPanelBody,
} from '@/components/ui/dialog';

interface MerchSkuPickerDialogProps {
  product: Product;
  onSelect: (product: Product, sku: ProductSku) => void;
  onClose: () => void;
  formatCurrency: (value: number) => string;
}

export function MerchSkuPickerDialog({
  product,
  onSelect,
  onClose,
  formatCurrency,
}: MerchSkuPickerDialogProps) {
  const activeSkus = useMemo(
    () => (product.skus ?? []).filter((sku) => sku.is_active !== false),
    [product.skus]
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>Pilih Varian</DialogPanelTitle>
          <DialogPanelDescription>{product.name}</DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="max-h-[60vh] space-y-2 overflow-y-auto">
          {activeSkus.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">
              Tidak ada varian aktif — atur varian di master produk.
            </p>
          ) : (
            activeSkus.map((sku) => {
              const stock = Number(sku.stock_quantity ?? 0);
              const price = sku.price_override ?? product.base_price;
              const isOut = stock <= 0;
              return (
                <button
                  key={sku.id}
                  type="button"
                  onClick={() => onSelect(product, sku)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200/80 bg-white px-4 py-3 text-left transition hover:border-pink-300 hover:bg-pink-50/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{sku.name}</p>
                    <p className="text-xs text-gray-400">{sku.sku}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        isOut ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'
                      }`}
                    >
                      <Boxes className="h-3 w-3" />
                      {stock}
                    </span>
                    <span className="text-sm font-semibold text-gray-900">
                      {formatCurrency(price)}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}
