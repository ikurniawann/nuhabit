import { productStartingPrice } from '@/lib/shop/storefront-cart';
import type { CatalogProduct } from '@/lib/shop/types';
import { PriceTag, SaleBadge } from './price-tag';
import { ProductPhoto } from './product-photo';

/** A horizontal row of compact cards: saved items, recently viewed, related products. */
export function ProductRow({
  title,
  products,
  onSelect,
  action,
}: {
  title: string;
  products: CatalogProduct[];
  onSelect: (product: CatalogProduct) => void;
  action?: React.ReactNode;
}) {
  if (products.length === 0) return null;
  return (
    <section aria-label={title} className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {action}
      </div>
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {products.map((product) => (
          <button
            key={product.id}
            type="button"
            onClick={() => onSelect(product)}
            className="group w-36 shrink-0 overflow-hidden rounded-xl border border-forest/10 bg-white text-left focus-visible:outline-2 focus-visible:outline-forest sm:w-44"
          >
            <div className="relative aspect-square overflow-hidden bg-[#f5f7f3]">
              <ProductPhoto src={product.images[0] || product.imageUrl} alt={product.name} compact />
              {product.salePercent ? <SaleBadge percent={product.salePercent} className="absolute left-2 top-2" /> : null}
            </div>
            <div className="p-2.5">
              <p className="line-clamp-2 text-xs font-semibold text-gray-900">{product.name}</p>
              <div className="mt-1 text-xs">
                <PriceTag price={productStartingPrice(product)} compareAtPrice={product.skus.length === 0 ? product.compareAtPrice : null} />
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
