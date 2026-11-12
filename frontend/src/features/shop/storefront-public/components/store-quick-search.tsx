'use client';

import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatRupiah } from '@/lib/format';
import { productStartingPrice } from '@/lib/shop/storefront-cart';
import { applyCatalogFilters, EMPTY_FILTERS } from '@/lib/shop/storefront-discovery';
import type { CatalogProduct } from '@/lib/shop/types';
import { ProductPhoto } from './product-photo';

const MAX_HITS = 6;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Jumps straight to a product, unlike the catalog bar, which filters the grid.
 * Ctrl+K, Cmd+K or / focuses it; arrows, Enter and Escape drive the results.
 */
export function StoreQuickSearch({
  products,
  onSelect,
  onSeeAll,
}: {
  products: CatalogProduct[];
  onSelect: (product: CatalogProduct) => void;
  onSeeAll: (query: string) => void;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const trimmed = query.trim();
  const found = useMemo(
    () => (trimmed ? applyCatalogFilters(products, { ...EMPTY_FILTERS, search: trimmed }) : []),
    [products, trimmed]
  );
  const hits = found.slice(0, MAX_HITS);
  // The last option shows every match in the catalog.
  const seeAllIndex = found.length > MAX_HITS ? hits.length : -1;
  const optionCount = hits.length + (seeAllIndex >= 0 ? 1 : 0);
  const open = trimmed.length > 0;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (!shortcut && (event.key !== '/' || isTyping(event.target))) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const finish = (action: () => void) => {
    setQuery('');
    inputRef.current?.blur();
    action();
  };
  const seeAll = () => finish(() => onSeeAll(trimmed));
  const choose = (index: number) => {
    if (index === seeAllIndex) seeAll();
    else if (hits[index]) finish(() => onSelect(hits[index]));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && optionCount) {
      event.preventDefault();
      setActive((i) => (i + 1) % optionCount);
    } else if (event.key === 'ArrowUp' && optionCount) {
      event.preventDefault();
      setActive((i) => (i - 1 + optionCount) % optionCount);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'Escape') {
      setQuery('');
      inputRef.current?.blur();
    }
  };

  const optionClass =
    'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface aria-selected:bg-surface';

  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Quick search"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && optionCount ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setQuery('')}
        placeholder="Quick search products"
        className="h-11 w-full rounded-full border border-border bg-white pl-10 pr-4 text-base text-forest focus:border-forest focus:outline-none sm:pr-14 sm:text-sm"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-gray-500 sm:block">
        /
      </kbd>
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Quick search results"
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-[60dvh] overflow-y-auto rounded-2xl border border-border bg-white p-1 shadow-lg animate-in fade-in-0 slide-in-from-top-1 duration-(--motion-fast) ease-(--ease-standard)"
        >
          {hits.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-gray-500">No products match &ldquo;{trimmed}&rdquo;</p>
          ) : (
            hits.map((product, i) => (
              <button
                key={product.id}
                id={`${listId}-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                className={optionClass}
              >
                <span className="relative size-11 shrink-0 overflow-hidden rounded-lg">
                  <ProductPhoto src={product.images[0] || product.imageUrl} alt="" compact />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">{product.name}</span>
                  <span className="block text-xs text-gray-500">{formatRupiah(productStartingPrice(product))}</span>
                </span>
              </button>
            ))
          )}
          {seeAllIndex >= 0 ? (
            <button
              id={`${listId}-${seeAllIndex}`}
              type="button"
              role="option"
              aria-selected={seeAllIndex === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(seeAllIndex)}
              onClick={seeAll}
              className={`${optionClass} justify-center text-sm font-semibold text-forest`}
            >
              See all {found.length} results
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
