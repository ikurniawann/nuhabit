'use client';

// Public storefront: catalog by collection, size picker, cart (or Buy Now),
// checkout (area plus live shipping rates), redirect to the Xendit invoice.
// The cart lives in cart-store (localStorage per store slug).

import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, Package, Search, ShoppingBag, ShoppingCart, X } from 'lucide-react';
import { formatRupiah } from '@/lib/format';
import {
  addCartLine,
  cartCount,
  cartSubtotal,
  changeCartQuantity,
  changeCartVariant,
  filterAndSortProducts,
  groupByCollection,
  makeCartLine,
  productIsAvailable,
  productStartingPrice,
  removeCartLine,
  type CatalogSort,
  type CartLine,
} from '@/lib/shop/storefront-cart';
import type { CatalogProduct, CatalogSku } from '@/lib/shop/types';
import { pushShopEvent } from '../analytics';
import { bindCart, clearCart, closeCart, openCart, setCartNote, updateLines, useCart } from '../cart-store';
import { useStorefrontCatalog } from '../queries';
import { CartDrawer } from './cart-drawer';
import { CheckoutDrawer } from './checkout-drawer';
import { CollectionNav } from './collection-nav';
import { PreorderBadge } from './preorder-note';
import { ProductDetailSheet } from './product-detail-sheet';

export function ShopStorefrontPage({ slug }: { slug: string }) {
  const catalog = useStorefrontCatalog(slug);
  const cart = useCart();
  const [detailProduct, setDetailProduct] = useState<CatalogProduct | null>(null);
  // "Buy Now" lines: a one-line cart held in memory, apart from the stored
  // cart. null means checkout uses the cart.
  const [buyNow, setBuyNow] = useState<{ lines: CartLine[]; note: string } | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<CatalogSort>('featured');
  const [availableOnly, setAvailableOnly] = useState(false);

  // The cart follows the store's real slug (/apparel loads slug "default").
  const shopSlug = catalog.data?.storefront.slug;
  useEffect(() => {
    if (shopSlug) bindCart(shopSlug);
  }, [shopSlug]);

  const eventPayload = (product: CatalogProduct, sku: CatalogSku | null) => ({
    shop: shopSlug ?? slug,
    product: product.name,
    variant: sku?.name ?? null,
    qty: 1,
    value: sku ? sku.price : product.price,
  });

  const addToCart = (product: CatalogProduct, sku: CatalogSku | null) => {
    updateLines((lines) => addCartLine(lines, product, sku));
    pushShopEvent('add_to_cart', eventPayload(product, sku));
    setDetailProduct(null);
    openCart();
  };

  const startCheckout = (lines: CartLine[]) => {
    pushShopEvent('checkout_start', {
      shop: shopSlug ?? slug,
      product: lines.map((line) => line.name).join(', '),
      variant: lines.length === 1 ? lines[0].variantName : null,
      qty: cartCount(lines),
      value: cartSubtotal(lines),
    });
    closeCart();
    setCheckoutOpen(true);
  };

  const buyNowProduct = (product: CatalogProduct, sku: CatalogSku | null) => {
    const lines = [makeCartLine(product, sku)];
    pushShopEvent('buy_now', eventPayload(product, sku));
    setDetailProduct(null);
    setBuyNow({ lines, note: '' });
    startCheckout(lines);
  };

  const closeCheckout = () => {
    setCheckoutOpen(false);
    setBuyNow(null);
  };

  if (catalog.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-forest" />
      </div>
    );
  }
  if (catalog.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-gray-50 px-6 text-center">
        <Package className="h-10 w-10 text-gray-300" />
        <p className="text-sm text-gray-500">{catalog.error.message || 'Store not found'}</p>
      </div>
    );
  }

  const { storefront, collections, products } = catalog.data;
  const visibleProducts = filterAndSortProducts(products, search, availableOnly, sort);
  const groups = sort === 'featured' && !search.trim()
    ? groupByCollection(visibleProducts, collections ?? [])
    : [{ id: 'results', name: 'Results', products: visibleProducts }];
  const grouped = groups.length > 1;
  const count = cartCount(cart.lines);
  const checkoutLines = buyNow ? buyNow.lines : cart.lines;

  return (
    <div className="min-h-screen bg-[#f7f7f4] pb-24">
      <header className="sticky top-0 z-30 border-b border-gray-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-forest">NüHabit Shop</p>
            <p className="text-base font-semibold text-gray-900">{storefront.name}</p>
          </div>
          <button
            type="button"
            onClick={openCart}
            className="relative rounded-full bg-ink p-2.5 text-on-ink shadow hover:bg-ink-3"
            aria-label={`Cart, ${count} ${count === 1 ? 'item' : 'items'}`}
          >
            <ShoppingCart className="h-5 w-5" />
            {count > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-strong px-1 text-xs font-bold text-accent-foreground">
                {count}
              </span>
            ) : null}
          </button>
        </div>
        {grouped ? <CollectionNav groups={groups} /> : null}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-8 overflow-hidden rounded-[2rem] bg-ink px-6 py-8 text-on-ink sm:px-10 sm:py-12">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-lime-300">The everyday collection</p>
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl">Made for your next move.</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-white/75 sm:text-base">
            {storefront.description || 'Gear and essentials for every part of your routine.'}
          </p>
          <a href="#shop-products" className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-gray-900 hover:bg-gray-100">
            Shop the collection <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        {products.length > 0 ? (
          <div id="shop-products" className="scroll-mt-36">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-forest">Explore</p>
                <h2 className="text-2xl font-semibold text-gray-900">All products</h2>
                <p className="mt-1 text-sm text-gray-500">{visibleProducts.length} {visibleProducts.length === 1 ? 'product' : 'products'}</p>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                Sort by
                <select value={sort} onChange={(event) => setSort(event.target.value as CatalogSort)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-forest focus:outline-none">
                  <option value="featured">Featured</option>
                  <option value="price-asc">Price: low to high</option>
                  <option value="price-desc">Price: high to low</option>
                  <option value="name">Name: A to Z</option>
                </select>
              </label>
            </div>
            <div className="mb-7 flex flex-wrap items-center gap-3">
              <label className="relative min-w-56 flex-1 sm:max-w-md">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <span className="sr-only">Search products</span>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products, sizes, collections" className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-11 pr-10 text-sm outline-none focus:border-forest" />
                {search ? <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"><X className="h-4 w-4" /></button> : null}
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
                <input type="checkbox" checked={availableOnly} onChange={(event) => setAvailableOnly(event.target.checked)} className="accent-forest" />
                Available to order
              </label>
            </div>
          </div>
        ) : null}
        {products.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-24 text-gray-400">
            <ShoppingBag className="h-10 w-10 opacity-40" />
            <p className="text-sm">No products in this store yet</p>
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center">
            <Search className="mx-auto mb-3 h-8 w-8 text-gray-300" />
            <p className="font-medium text-gray-900">No matching products</p>
            <p className="mt-1 text-sm text-gray-500">Try another search or show sold-out items.</p>
            <button type="button" onClick={() => { setSearch(''); setAvailableOnly(false); }} className="mt-4 text-sm font-semibold text-forest underline">Clear filters</button>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.id} id={`collection-${group.id}`} className="scroll-mt-40 mb-10">
              {grouped ? <h3 className="mb-4 text-lg font-semibold text-gray-900">{group.name}</h3> : null}
              <ProductGrid products={group.products} onSelect={setDetailProduct} />
            </section>
          ))
        )}
      </main>

      {detailProduct ? (
        <ProductDetailSheet
          product={detailProduct}
          onAdd={addToCart}
          onBuyNow={buyNowProduct}
          onClose={() => setDetailProduct(null)}
        />
      ) : null}

      {cart.open ? (
        <CartDrawer
          cart={cart.lines}
          note={cart.note}
          products={products}
          onChangeQty={(key, delta) => updateLines((lines) => changeCartQuantity(lines, key, delta))}
          onChangeVariant={(key, product, sku) => updateLines((lines) => changeCartVariant(lines, key, product, sku))}
          onRemove={(key) => updateLines((lines) => removeCartLine(lines, key))}
          onNoteChange={setCartNote}
          onCheckout={() => {
            setBuyNow(null);
            startCheckout(cart.lines);
          }}
          onClose={closeCart}
        />
      ) : null}

      <CheckoutDrawer
        open={checkoutOpen}
        slug={storefront.slug}
        cart={checkoutLines}
        note={buyNow ? buyNow.note : cart.note}
        onPaid={() => {
          if (!buyNow) clearCart();
        }}
        onClose={closeCheckout}
      />
    </div>
  );
}

function ProductGrid({
  products,
  onSelect,
}: {
  products: CatalogProduct[];
  onSelect: (product: CatalogProduct) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
      {products.map((product) => {
        const image = product.images[0] || product.imageUrl;
        const soldOut = !productIsAvailable(product);
        return (
          <button
            key={product.id}
            type="button"
            onClick={() => onSelect(product)}
            className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-forest"
          >
            <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-gray-100">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt={product.name} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
              ) : (
                <Package className="h-10 w-10 text-gray-300" />
              )}
              {product.preorder ? <PreorderBadge until={product.preorderUntil} className="absolute left-2 top-2" /> : null}
              {soldOut ? <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-gray-700">Sold out</span> : null}
            </div>
            <div className="flex flex-1 flex-col p-3 sm:p-4">
              {product.collection ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-forest">{product.collection.name}</p> : null}
              <p className="line-clamp-2 text-sm font-semibold text-gray-900">{product.name}</p>
              {product.description ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">{product.description}</p> : null}
              <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                <p className="text-sm font-bold text-gray-900">{product.skus.length > 1 ? 'From ' : ''}{formatRupiah(productStartingPrice(product))}</p>
                {!soldOut ? <span className="text-xs font-semibold text-forest">View <span aria-hidden="true">→</span></span> : null}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
