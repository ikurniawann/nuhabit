import { ArrowRight, Plus } from 'lucide-react';
import { formatRupiah } from '@/lib/format';
import { productIsAvailable, productStartingPrice } from '@/lib/shop/storefront-cart';
import type { CatalogProduct, PublicStorefront } from '@/lib/shop/types';
import { PriceTag, SaleBadge } from './price-tag';
import { ProductPhoto } from './product-photo';

const HERO_PHOTO = '/member-assets/img/class-eng.jpg';

/** The product the hero card points at: a sale first, then a featured one, then anything in stock. */
function spotlight(products: CatalogProduct[]): CatalogProduct | undefined {
  const available = products.filter(productIsAvailable);
  return available.find((p) => (p.salePercent ?? 0) > 0) ?? available.find((p) => p.isFeatured) ?? available[0];
}

/** Photo hero in a rounded frame: headline bottom left, store facts as chips, one product card bottom right. */
export function StorefrontHero({ storefront, products, onSelect }: {
  storefront: PublicStorefront;
  products: CatalogProduct[];
  onSelect: (product: CatalogProduct) => void;
}) {
  const product = spotlight(products);
  const { freeShippingThreshold, pickupEnabled } = storefront.settings;
  const facts = [
    `${products.length} ${products.length === 1 ? 'product' : 'products'}`,
    freeShippingThreshold ? `Free shipping from ${formatRupiah(freeShippingThreshold)}` : null,
    pickupEnabled && storefront.pickupBranches.length > 0 ? 'Pick up at the gym' : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <section className="relative isolate mb-6 flex min-h-[30rem] flex-col justify-end overflow-hidden rounded-hero bg-ink text-on-ink md:min-h-[34rem]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={HERO_PHOTO} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover grayscale" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-ink via-ink/60 to-ink/10" />

      <ul aria-label="Store facts" className="absolute top-6 right-6 hidden flex-col items-end gap-2 md:flex">
        {facts.map((fact) => (
          <li key={fact} className="flex items-center gap-2 rounded-full bg-white/10 py-1.5 pr-4 pl-1.5 text-sm font-semibold ring-1 ring-white/15 backdrop-blur-md">
            <span className="flex size-6 items-center justify-center rounded-full bg-lime text-forest"><Plus className="h-3.5 w-3.5" /></span>
            {fact}
          </li>
        ))}
      </ul>

      <div className="grid gap-6 p-6 md:p-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
        <div>
          <p className="mb-4 inline-block rounded-full bg-lime px-3 py-1 text-xs font-bold uppercase tracking-wider text-forest">{storefront.name}</p>
          <h1 className="max-w-3xl font-display text-4xl font-extrabold uppercase leading-[0.92] tracking-tight sm:text-6xl lg:text-7xl">Made for your next move.</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-on-ink-muted sm:text-base">
            {storefront.description || 'Gear and essentials for every part of your routine.'}
          </p>
          <a href="#shop-products" className="mt-6 inline-flex items-center gap-2 rounded-full bg-lime px-6 py-3 text-sm font-bold uppercase tracking-wide text-forest hover:bg-lemon">
            Shop the collection <ArrowRight className="h-4 w-4" />
          </a>
        </div>
        {product ? (
          <button type="button" onClick={() => onSelect(product)} className="group flex items-center gap-3 rounded-2xl bg-card p-3 text-left text-foreground shadow-float focus-visible:outline-2 focus-visible:outline-lime">
            <span className="relative size-20 shrink-0 overflow-hidden rounded-xl">
              <ProductPhoto src={product.images[0] || product.imageUrl} alt={product.name} compact />
              {product.salePercent ? <SaleBadge percent={product.salePercent} className="absolute left-1 top-1" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-forest">{product.salePercent ? 'On sale now' : 'Spotlight'}</span>
              <span className="mt-0.5 line-clamp-2 block text-sm font-bold">{product.name}</span>
              <span className="mt-1 block"><PriceTag price={productStartingPrice(product)} compareAtPrice={product.skus.length === 0 ? product.compareAtPrice : null} /></span>
            </span>
          </button>
        ) : null}
      </div>
    </section>
  );
}
