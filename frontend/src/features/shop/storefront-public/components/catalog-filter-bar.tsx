'use client';

import { Search, X } from 'lucide-react';
import type { CatalogSort } from '@/lib/shop/storefront-cart';
import type { CatalogFilters } from '@/lib/shop/storefront-discovery';

const FIELD_CLASS = 'rounded-xl border border-forest/15 bg-white px-3 py-2 text-sm text-forest focus:border-forest focus:outline-none';

/** Search, sort, availability, size chips and the price range (all mirrored in the URL). */
export function CatalogFilterBar({
  filters,
  sizes,
  count,
  onChange,
}: {
  filters: CatalogFilters;
  sizes: string[];
  count: number;
  onChange: (next: CatalogFilters) => void;
}) {
  const patch = (next: Partial<CatalogFilters>) => onChange({ ...filters, ...next });
  const toggleSize = (size: string) =>
    patch({ sizes: filters.sizes.includes(size) ? filters.sizes.filter((item) => item !== size) : [...filters.sizes, size] });
  const priceValue = (value: number | null) => (value === null ? '' : String(value));
  const parsePrice = (raw: string) => {
    const n = Number(raw.replace(/\D/g, ''));
    return n > 0 ? n : null;
  };

  return (
    <div className="mb-7 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-forest">Explore</p>
          <h2 className="text-2xl font-semibold text-gray-900">All products</h2>
          <p className="mt-1 text-sm text-gray-500">{count} {count === 1 ? 'product' : 'products'}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Sort by
          <select value={filters.sort} onChange={(event) => patch({ sort: event.target.value as CatalogSort })} className={FIELD_CLASS}>
            <option value="featured">Featured</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="name">Name: A to Z</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-56 flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <span className="sr-only">Search products</span>
          <input value={filters.search} onChange={(event) => patch({ search: event.target.value })} placeholder="Search products, sizes, collections" className="w-full rounded-xl border border-forest/15 bg-white py-3 pl-11 pr-10 text-sm outline-none focus:border-forest" />
          {filters.search ? <button type="button" onClick={() => patch({ search: '' })} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"><X className="h-4 w-4" /></button> : null}
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-forest/15 bg-white px-4 py-3 text-sm text-gray-700">
          <input type="checkbox" checked={filters.availableOnly} onChange={(event) => patch({ availableOnly: event.target.checked })} className="accent-forest" />
          Available to order
        </label>
        <fieldset className="flex items-center gap-2 text-sm text-gray-600">
          <legend className="sr-only">Price range</legend>
          <label className="flex items-center gap-1.5">
            <span>Price</span>
            <input inputMode="numeric" aria-label="Minimum price" placeholder="Min" value={priceValue(filters.priceMin)} onChange={(event) => patch({ priceMin: parsePrice(event.target.value) })} className={`w-24 ${FIELD_CLASS}`} />
          </label>
          <span aria-hidden="true">to</span>
          <input inputMode="numeric" aria-label="Maximum price" placeholder="Max" value={priceValue(filters.priceMax)} onChange={(event) => patch({ priceMax: parsePrice(event.target.value) })} className={`w-24 ${FIELD_CLASS}`} />
        </fieldset>
      </div>
      {sizes.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sizes">
          <span className="text-sm text-gray-600">Size</span>
          {sizes.map((size) => {
            const active = filters.sizes.includes(size);
            return (
              <button
                key={size}
                type="button"
                aria-pressed={active}
                onClick={() => toggleSize(size)}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition ${active ? 'border-forest bg-forest text-white' : 'border-gray-200 text-gray-700 hover:border-forest'}`}
              >
                {size}
              </button>
            );
          })}
          {filters.sizes.length > 0 ? <button type="button" onClick={() => patch({ sizes: [] })} className="text-xs font-semibold text-forest underline">Any size</button> : null}
        </div>
      ) : null}
    </div>
  );
}
