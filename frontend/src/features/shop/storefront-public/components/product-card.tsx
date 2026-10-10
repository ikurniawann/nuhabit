'use client';

import { useState } from 'react';
import { Heart, Plus } from 'lucide-react';
import { productIsAvailable, productStartingPrice } from '@/lib/shop/storefront-cart';
import { saleEndsText } from '@/lib/shop/storefront-discovery';
import { formatDateEn } from '@/lib/shop/format-en';
import type { CatalogProduct, CatalogSku } from '@/lib/shop/types';
import { PreorderBadge } from './preorder-note';
import { PriceTag, SaleBadge } from './price-tag';
import { ProductPhoto } from './product-photo';
import { RatingStars } from './rating-stars';

export type ProductCardActions = {
  onSelect: (product: CatalogProduct) => void;
  isSaved: (productId: string) => boolean;
  onToggleSaved: (product: CatalogProduct) => void;
  /** Quick add from the grid: one tap for a single-SKU product, a size chip for variants. */
  onQuickAdd: (product: CatalogProduct, sku: CatalogSku | null) => void;
};

const sellable = (sku: CatalogSku) => sku.stock > 0 || sku.preorder;

export function ProductGrid({ products, actions }: { products: CatalogProduct[]; actions: ProductCardActions }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} actions={actions} />
      ))}
    </div>
  );
}

export function ProductCard({ product, actions }: { product: CatalogProduct; actions: ProductCardActions }) {
  const [sizesOpen, setSizesOpen] = useState(false);
  const image = product.images[0] || product.imageUrl;
  const soldOut = !productIsAvailable(product);
  const saved = actions.isSaved(product.id);
  const hasVariants = product.skus.length > 0;
  const sale = saleEndsText(product, formatDateEn);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-forest/10 bg-white shadow-[0_8px_30px_rgb(0_40_26/0.06)] transition hover:-translate-y-1 hover:shadow-[0_16px_36px_rgb(0_40_26/0.12)]">
      <button
        type="button"
        onClick={() => actions.onSelect(product)}
        className="relative flex aspect-square items-center justify-center overflow-hidden bg-[#f5f7f3] text-left focus-visible:outline-2 focus-visible:outline-forest"
        aria-label={`View ${product.name}`}
      >
        <ProductPhoto src={image} alt={product.name} />
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          {soldOut ? <span className="rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-gray-700">Sold out</span> : null}
          {product.salePercent ? <SaleBadge percent={product.salePercent} /> : null}
          {product.preorder ? <PreorderBadge until={product.preorderUntil} /> : null}
          {!soldOut && product.lowStock ? <span className="rounded-full bg-lemon px-2 py-0.5 text-[11px] font-semibold text-forest">Low stock</span> : null}
          {product.backInStock ? <span className="rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-forest">Back in stock</span> : null}
        </div>
      </button>
      <button
        type="button"
        onClick={() => actions.onToggleSaved(product)}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${product.name} from saved` : `Save ${product.name}`}
        className="absolute right-2 top-2 rounded-full bg-white/95 p-2 text-forest shadow-sm hover:bg-white"
      >
        <Heart className={`h-4 w-4 ${saved ? 'fill-forest' : ''}`} />
      </button>
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        {product.collection ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-forest">{product.collection.name}</p> : null}
        <button type="button" onClick={() => actions.onSelect(product)} className="line-clamp-2 text-left text-sm font-semibold text-gray-900 hover:underline">
          {product.name}
        </button>
        {product.rating ? <div className="mt-1"><RatingStars rating={product.rating} compact /></div> : null}
        {sale ? <p className="mt-1 text-[11px] font-medium text-forest">{sale}</p> : null}
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <PriceTag price={productStartingPrice(product)} compareAtPrice={startingCompareAtPrice(product)} prefix={product.skus.length > 1 ? 'From ' : ''} />
          {!soldOut ? (
            <button
              type="button"
              onClick={() => (hasVariants ? setSizesOpen((open) => !open) : actions.onQuickAdd(product, null))}
              aria-expanded={hasVariants ? sizesOpen : undefined}
              aria-label={`Add ${product.name} to cart`}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-strong px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:bg-accent-dark"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          ) : null}
        </div>
        {hasVariants && sizesOpen ? (
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`Sizes for ${product.name}`}>
            {product.skus.map((sku) => (
              <button
                key={sku.id}
                type="button"
                disabled={!sellable(sku)}
                onClick={() => {
                  actions.onQuickAdd(product, sku);
                  setSizesOpen(false);
                }}
                className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-800 hover:border-forest disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sku.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The regular price of the SKU that sets the starting price, when it is on sale. */
function startingCompareAtPrice(product: CatalogProduct): number | null {
  if (product.skus.length === 0) return product.compareAtPrice;
  const starting = productStartingPrice(product);
  const sku = product.skus.find((candidate) => candidate.price === starting && sellable(candidate)) ?? product.skus[0];
  return sku.compareAtPrice;
}
