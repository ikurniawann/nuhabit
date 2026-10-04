import { X } from 'lucide-react';
import { formatRupiah } from '@/lib/format';
import type { CatalogProduct, CatalogSku } from '@/lib/shop/types';

/** Detail produk + pilih varian (bottom sheet di ponsel, modal di layar lebar). */
export function ProductDetailSheet({
  product,
  onAdd,
  onClose,
}: {
  product: CatalogProduct;
  onAdd: (product: CatalogProduct, sku: CatalogSku | null) => void;
  onClose: () => void;
}) {
  const description = product.longDescription || product.description;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">{product.name}</h2>
          <button type="button" onClick={onClose} aria-label="Tutup">
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>
        {description ? <p className="mb-4 whitespace-pre-line text-sm text-gray-600">{description}</p> : null}
        {product.skus.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Pilih varian</p>
            {product.skus.map((sku) => (
              <button
                key={sku.id}
                type="button"
                disabled={sku.stock <= 0}
                onClick={() => onAdd(product, sku)}
                className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-left transition hover:border-pink-300 hover:bg-pink-50/40 disabled:opacity-50"
              >
                <span className="text-sm font-medium text-gray-900">{sku.name}</span>
                <span className="flex items-center gap-3 text-sm">
                  <span className={sku.stock > 0 ? 'text-gray-400' : 'text-red-500'}>
                    {sku.stock > 0 ? `Stok ${sku.stock}` : 'Habis'}
                  </span>
                  <span className="font-semibold text-pink-600">{formatRupiah(sku.price)}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onAdd(product, null)}
            className="w-full rounded-lg bg-pink-600 px-4 py-3 text-sm font-semibold text-white hover:bg-pink-700"
          >
            Tambah ke Keranjang — {formatRupiah(product.price)}
          </button>
        )}
      </div>
    </div>
  );
}
