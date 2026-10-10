import { useState } from 'react';
import Link from 'next/link';
import { Heart, Loader2, X, Zap } from 'lucide-react';
import { formatDateEn } from '@/lib/shop/format-en';
import { relatedProducts, saleEndsText } from '@/lib/shop/storefront-discovery';
import type { CatalogProduct, CatalogSku } from '@/lib/shop/types';
import { useProductReviews } from '../queries';
import { PreorderBadge } from './preorder-note';
import { PriceTag, SaleBadge } from './price-tag';
import { ProductPhoto } from './product-photo';
import { ProductRow } from './product-row';
import { RatingStars, StarRow } from './rating-stars';

const sellable = (stock: number, preorder: boolean) => stock > 0 || preorder;

/**
 * Product detail and size picker (bottom sheet on phones, modal on wide
 * screens): sale price, rating and reviews, "You may also like". "Add to
 * Cart" stores the line; "Buy Now" goes straight to checkout without
 * touching the cart. Render with key=product.id so the picker resets.
 */
export function ProductDetailSheet({
  slug,
  product,
  products,
  saved,
  onToggleSaved,
  onSelect,
  onAdd,
  onBuyNow,
  onClose,
}: {
  slug: string;
  product: CatalogProduct;
  products: CatalogProduct[];
  saved: boolean;
  onToggleSaved: (product: CatalogProduct) => void;
  /** Open another product (a related one) in this sheet. */
  onSelect: (product: CatalogProduct) => void;
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
  const compareAtPrice = chosen ? chosen.compareAtPrice : product.compareAtPrice;
  const preorder = chosen ? chosen.preorder : product.preorder && product.stock <= 0;
  const sale = saleEndsText(product, formatDateEn);
  const related = relatedProducts(product, products);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={product.name}
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl sm:p-7"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            {product.collection ? <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-forest">{product.collection.name}</p> : null}
            <h2 className="text-xl font-semibold text-gray-900 sm:text-2xl">{product.name}</h2>
            {product.rating ? <div className="mt-1"><RatingStars rating={product.rating} /></div> : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onToggleSaved(product)}
              aria-pressed={saved}
              aria-label={saved ? 'Remove from saved' : 'Save for later'}
              className="rounded-full p-2 text-forest hover:bg-surface"
            >
              <Heart className={`h-5 w-5 ${saved ? 'fill-forest' : ''}`} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="p-2">
              <X className="h-5 w-5 text-gray-400" />
            </button>
          </div>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-gray-100">
              <ProductPhoto key={images[activeImage] ?? 'none'} src={images[activeImage]} alt={`${product.name}, image ${activeImage + 1} of ${images.length}`} />
            </div>
            {images.length > 1 ? (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Product images">
                {images.map((image, index) => (
                  <button key={`${image}-${index}`} type="button" onClick={() => setActiveImage(index)} aria-label={`Show image ${index + 1}`} aria-pressed={activeImage === index} className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${activeImage === index ? 'border-forest' : 'border-transparent'}`}>
                    <ProductPhoto src={image} alt={`${product.name}, thumbnail ${index + 1}`} compact />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <PriceTag price={price} compareAtPrice={compareAtPrice} size="lg" />
          {product.salePercent ? <SaleBadge percent={product.salePercent} /> : null}
        </div>
        {sale ? <p className="-mt-3 mb-5 text-xs font-medium text-forest">{sale}</p> : null}
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

        <div className="mt-8 border-t border-gray-100 pt-6">
          <ProductReviews slug={slug} product={product} />
        </div>
        {related.length > 0 ? (
          <div className="mt-6 border-t border-gray-100 pt-6">
            <ProductRow title="You may also like" products={related} onSelect={onSelect} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProductReviews({ slug, product }: { slug: string; product: CatalogProduct }) {
  const reviews = useProductReviews(slug, product.id);
  return (
    <section aria-label="Reviews">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-gray-900">Reviews</h3>
        {product.rating ? <RatingStars rating={product.rating} /> : null}
      </div>
      {reviews.isPending ? (
        <p className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading reviews</p>
      ) : reviews.isError || !reviews.data || reviews.data.length === 0 ? (
        <p className="text-sm text-gray-500">No reviews yet. Members can rate this item from their order page after it is paid.</p>
      ) : (
        <ul className="space-y-3">
          {reviews.data.map((review) => (
            <li key={review.id} className="rounded-xl bg-gray-50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StarRow value={review.rating} size="h-3.5 w-3.5" label={`${review.rating} out of 5`} />
                <span className="text-xs text-gray-400">{review.customerName || 'Member'}, {formatDateEn(review.createdAt)}</span>
              </div>
              {review.comment ? <p className="mt-1.5 text-sm leading-6 text-gray-700">{review.comment}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
