import { useState } from 'react';
import Link from 'next/link';
import { Package, X, Zap } from 'lucide-react';
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
  const images = [...new Set([product.images[0], product.imageUrl, ...product.images].filter((image): image is string => Boolean(image)))];
  const [activeImage, setActiveImage] = useState(0);
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
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-mint p-5 sm:rounded-3xl sm:p-7"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            {product.collection ? <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-forest">{product.collection.name}</p> : null}
            <h2 className="text-xl font-semibold text-gray-900 sm:text-2xl">{product.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-gray-100">
              {images.length > 0 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={images[activeImage]} alt={`${product.name}, image ${activeImage + 1} of ${images.length}`} className="h-full w-full object-cover" />
              ) : <Package className="h-14 w-14 text-gray-300" />}
            </div>
            {images.length > 1 ? (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Product images">
                {images.map((image, index) => (
                  <button key={`${image}-${index}`} type="button" onClick={() => setActiveImage(index)} aria-label={`Show image ${index + 1}`} aria-pressed={activeImage === index} className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${activeImage === index ? 'border-forest' : 'border-transparent'}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col">
        <p className="mb-5 text-xl font-bold text-gray-900">{formatRupiah(price)}</p>
        {description ? <p className="mb-5 whitespace-pre-line text-sm leading-6 text-gray-600">{description}</p> : null}

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

        <div className="mb-5 space-y-3 border-t border-gray-100 pt-4 text-sm text-gray-600">
          <details className="group rounded-xl bg-gray-50 px-4 py-3" open>
            <summary className="cursor-pointer font-semibold text-gray-900">Size & fit</summary>
            {product.sizeGuide ? (
              <p className="mt-3 whitespace-pre-line leading-6">{product.sizeGuide}</p>
            ) : (
              <p className="mt-3 leading-6">Measurements have not been added for this item. <Link href="/contact" className="font-semibold text-forest underline">Ask us about sizing</Link> before ordering.</p>
            )}
          </details>
          <details className="group rounded-xl bg-gray-50 px-4 py-3" open>
            <summary className="cursor-pointer font-semibold text-gray-900">Delivery & returns</summary>
            <div className="mt-3 space-y-2 leading-6">
              <p>Choose your destination at checkout to see live courier options and the full shipping cost before payment. Delivery estimates appear when the courier provides them.</p>
              <p>For return or exchange questions, <Link href="/contact" className="font-semibold text-forest underline">contact NüHabit</Link> with your product and order details. The team can confirm the available options before you order.</p>
            </div>
          </details>
        </div>

        {preorder ? <PreorderBadge until={product.preorderUntil} className="mb-4" /> : null}

        {!hasVariants && !preorder ? <p className="mb-4 text-xs text-gray-500">{product.stock > 0 ? `${product.stock} available` : 'Sold out'}</p> : null}

        <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
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
      </div>
    </div>
  );
}
