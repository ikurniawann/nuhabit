import { useState } from 'react';
import { X, Zap } from 'lucide-react';
import { formatRupiah } from '@/lib/format';
import type { CatalogProduct, CatalogSku } from '@/lib/shop/types';
import { PreorderBadge } from './preorder-note';

const sellable = (stock: number, preorder: boolean) => stock > 0 || preorder;

/**
 * Product detail and size picker (bottom sheet on phones, modal on wide
 * screens). "Add to Cart" stores the line; "Buy Now" goes straight to
 * checkout without touching the cart.
 */
export function ProductDetailSheet({
  product,
  onAdd,
  onBuyNow,
  onClose,
}: {
  product: CatalogProduct;
  onAdd: (product: CatalogProduct, sku: CatalogSku | null) => void;
  onBuyNow: (product: CatalogProduct, sku: CatalogSku | null) => void;
  onClose: () => void;
}) {
  const hasVariants = product.skus.length > 0;
  const [selected, setSelected] = useState<CatalogSku | null>(() =>
    hasVariants ? (product.skus.find((sku) => sellable(sku.stock, sku.preorder)) ?? null) : null
  );
  const description = product.longDescription || product.description;
  const chosen = hasVariants ? selected : null;
  const canBuy = hasVariants ? chosen !== null : sellable(product.stock, product.preorder);
  const price = chosen ? chosen.price : product.price;
  const preorder = chosen ? chosen.preorder : product.preorder && product.stock <= 0;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={product.name}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{product.name}</h2>
            {product.collection ? <p className="text-xs text-gray-400">{product.collection.name}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>
        {description ? <p className="mb-4 whitespace-pre-line text-sm text-gray-600">{description}</p> : null}

        {hasVariants ? (
          <div className="mb-4 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Choose a size</p>
            <div className="flex flex-wrap gap-2">
              {product.skus.map((sku) => {
                const available = sellable(sku.stock, sku.preorder);
                const active = chosen?.id === sku.id;
                return (
                  <button
                    key={sku.id}
                    type="button"
                    disabled={!available}
                    aria-pressed={active}
                    onClick={() => setSelected(sku)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      active ? 'border-forest bg-forest text-white' : 'border-gray-200 text-gray-800 hover:border-forest'
                    }`}
                  >
                    {sku.name}
                  </button>
                );
              })}
            </div>
            {chosen ? (
              <p className="text-xs text-gray-500">
                {chosen.preorder ? 'Out of stock, available for pre-order' : `${chosen.stock} in stock`}
              </p>
            ) : (
              <p className="text-xs text-red-500">All sizes are sold out</p>
            )}
          </div>
        ) : null}

        <div className="mb-4 flex items-center justify-between">
          <span className="text-lg font-semibold text-gray-900">{formatRupiah(price)}</span>
          {preorder ? <PreorderBadge until={product.preorderUntil} /> : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!canBuy}
            onClick={() => onAdd(product, chosen)}
            className="rounded-full border border-forest px-4 py-3 text-sm font-semibold text-forest hover:bg-surface disabled:opacity-50"
          >
            Add to Cart
          </button>
          <button
            type="button"
            disabled={!canBuy}
            onClick={() => onBuyNow(product, chosen)}
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-accent-strong px-4 py-3 text-sm font-semibold text-accent-foreground hover:bg-accent-dark disabled:opacity-50"
          >
            <Zap className="h-4 w-4" />
            Buy Now
          </button>
        </div>
      </div>
    </div>
  );
}
