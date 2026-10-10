'use client';

// Public storefront: promo banner, promo, new and featured rows, saved and
// recently viewed rows, catalog by collection with size and price filters
// in the URL, quick add from the grid, cart (or Buy Now), one-screen
// checkout (ship with live rates or branch pickup, promo code, Xendit or
// ARK Coin), redirect to the invoice or the status page.
// The cart lives in cart-store, saved and recent ids in saved-store
// (localStorage per store slug).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2, Package, Search, ShoppingBag, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import {
  addCartLine,
  cartCount,
  cartSubtotal,
  changeCartQuantity,
  changeCartVariant,
  groupByCollection,
  makeCartLine,
  removeCartLine,
  type CartLine,
} from '@/lib/shop/storefront-cart';
import {
  applyCatalogFilters,
  catalogFiltersQuery,
  catalogSections,
  catalogSizes,
  EMPTY_FILTERS,
  isBrowsing,
  parseCatalogFilters,
  productsByIds,
  type CatalogFilters,
} from '@/lib/shop/storefront-discovery';
import type { AppliedPromo, CatalogProduct, CatalogSku } from '@/lib/shop/types';
import { pushShopEvent } from '../analytics';
import { bindCart, clearCart, closeCart, openCart, setCartNote, setCartPendingCode, setCartPromo, updateLines, useCart } from '../cart-store';
import { useShopMember, useStorefrontCatalog } from '../queries';
import { bindSaved, pushRecent, useSaved } from '../saved-store';
import { useWishlist } from '../use-wishlist';
import { CartDrawer } from './cart-drawer';
import { CatalogFilterBar } from './catalog-filter-bar';
import { CheckoutSheet } from './checkout-sheet';
import { CollectionNav } from './collection-nav';
import { ProductGrid } from './product-card';
import { ProductDetailSheet } from './product-detail-sheet';
import { ProductRow } from './product-row';
import { PromoBanner } from './promo-banner';

export function ShopStorefrontPage({ slug }: { slug: string }) {
  const catalog = useStorefrontCatalog(slug);
  const cart = useCart();
  const saved = useSaved();
  const [detailProduct, setDetailProduct] = useState<CatalogProduct | null>(null);
  // "Buy Now" lines: a one-line cart held in memory, apart from the stored
  // cart. null means checkout uses the cart.
  const [buyNow, setBuyNow] = useState<{ lines: CartLine[]; note: string; promo: AppliedPromo | null } | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  // Filters live in the URL query (the server render shows the loader, so
  // reading the query here never changes the first markup).
  const [filters, setFilters] = useState<CatalogFilters>(() =>
    typeof window === 'undefined' ? EMPTY_FILTERS : parseCatalogFilters(new URLSearchParams(window.location.search))
  );

  // The cart follows the store's real slug (/apparel loads slug "default").
  const shopSlug = catalog.data?.storefront.slug;
  useEffect(() => {
    if (shopSlug) {
      bindCart(shopSlug);
      bindSaved(shopSlug);
    }
  }, [shopSlug]);

  useEffect(() => {
    const query = catalogFiltersQuery(filters);
    const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', url);
    }
  }, [filters]);

  const member = useShopMember(shopSlug ?? slug, Boolean(shopSlug));
  const wishlist = useWishlist(shopSlug, member.data);

  const eventPayload = (product: CatalogProduct, sku: CatalogSku | null) => ({
    shop: shopSlug ?? slug,
    product: product.name,
    variant: sku?.name ?? null,
    qty: 1,
    value: sku ? sku.price : product.price,
  });

  const openProduct = (product: CatalogProduct) => {
    setDetailProduct(product);
    pushRecent(product.id);
    pushShopEvent('view_item', eventPayload(product, null));
  };

  const addToCart = (product: CatalogProduct, sku: CatalogSku | null) => {
    updateLines((lines) => addCartLine(lines, product, sku));
    pushShopEvent('add_to_cart', eventPayload(product, sku));
    setDetailProduct(null);
    openCart();
  };

  const quickAdd = (product: CatalogProduct, sku: CatalogSku | null) => {
    updateLines((lines) => addCartLine(lines, product, sku));
    pushShopEvent('add_to_cart', eventPayload(product, sku));
    toast.success('Added to cart', {
      description: sku ? `${product.name}, ${sku.name}` : product.name,
      action: { label: 'View cart', onClick: openCart },
    });
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
    setBuyNow({ lines, note: '', promo: null });
    startCheckout(lines);
  };

  const closeCheckout = () => {
    setCheckoutOpen(false);
    setBuyNow(null);
  };

  if (catalog.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-forest" />
      </div>
    );
  }
  if (catalog.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white px-6 text-center">
        <Package className="h-10 w-10 text-gray-300" />
        <p className="text-sm text-gray-500">{catalog.error.message || 'Store not found'}</p>
        <Link href="/" className="rounded-full bg-forest px-5 py-2.5 text-sm font-semibold text-white hover:bg-everglade">Back to Home</Link>
      </div>
    );
  }

  const { storefront, collections, products } = catalog.data;
  const browsing = isBrowsing(filters);
  const visibleProducts = applyCatalogFilters(products, filters);
  const groups = browsing
    ? groupByCollection(visibleProducts, collections ?? [])
    : [{ id: 'results', name: 'Results', products: visibleProducts }];
  const grouped = groups.length > 1;
  const sections = browsing ? catalogSections(products) : [];
  const count = cartCount(cart.lines);
  const checkoutLines = buyNow ? buyNow.lines : cart.lines;
  const cardActions = { onSelect: openProduct, isSaved: wishlist.has, onToggleSaved: wishlist.toggle, onQuickAdd: quickAdd };

  const copyBannerCode = (code: string) => {
    setCartPendingCode(code);
    pushShopEvent('select_promotion', { shop: storefront.slug, product: storefront.banner?.headline ?? code, variant: null, qty: 0, value: 0, code });
  };

  return (
    <div className="min-h-screen bg-white pb-24">
      <header className="sticky top-0 z-30 border-b border-forest/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-forest">NüHabit Shop</p>
            <p className="text-base font-semibold text-gray-900">{storefront.name}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-xs font-semibold text-forest underline-offset-4 hover:underline sm:text-sm">Home</Link>
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
        </div>
        {grouped ? <CollectionNav groups={groups} /> : null}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-8 overflow-hidden rounded-[2rem] bg-ink px-6 py-8 text-on-ink sm:px-10 sm:py-12">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-lime">The everyday collection</p>
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl">Made for your next move.</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-white/75 sm:text-base">
            {storefront.description || 'Gear and essentials for every part of your routine.'}
          </p>
          <a href="#shop-products" className="mt-6 inline-flex items-center gap-2 rounded-full bg-lime px-5 py-2.5 text-sm font-semibold text-forest hover:bg-lemon">
            Shop the collection <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        {storefront.banner ? <PromoBanner banner={storefront.banner} onCopyCode={copyBannerCode} /> : null}

        {browsing ? (
          <>
            {sections.map((section) => (
              <section key={section.id} id={`section-${section.id}`} aria-label={section.name} className="mb-10">
                <h2 className="mb-4 text-2xl font-semibold text-gray-900">{section.name}</h2>
                <ProductGrid products={section.products} actions={cardActions} />
              </section>
            ))}
            <ProductRow title="Saved" products={productsByIds(saved.wishlist, products)} onSelect={openProduct} />
            <ProductRow title="Recently viewed" products={productsByIds(saved.recent, products)} onSelect={openProduct} />
          </>
        ) : null}

        {products.length > 0 ? (
          <div id="shop-products" className="scroll-mt-36">
            <CatalogFilterBar filters={filters} sizes={catalogSizes(products)} count={visibleProducts.length} onChange={setFilters} />
          </div>
        ) : null}
        {products.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-24 text-gray-400">
            <ShoppingBag className="h-10 w-10 opacity-40" />
            <p className="text-sm">No products in this store yet</p>
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="rounded-2xl border border-forest/15 bg-white px-6 py-16 text-center">
            <Search className="mx-auto mb-3 h-8 w-8 text-gray-300" />
            <p className="font-medium text-gray-900">No matching products</p>
            <p className="mt-1 text-sm text-gray-500">Try another search, size or price range, or show sold-out items.</p>
            <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="mt-4 text-sm font-semibold text-forest underline">Clear filters</button>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.id} id={`collection-${group.id}`} className="scroll-mt-40 mb-10">
              {grouped ? <h3 className="mb-4 text-lg font-semibold text-gray-900">{group.name}</h3> : null}
              <ProductGrid products={group.products} actions={cardActions} />
            </section>
          ))
        )}
      </main>

      {detailProduct ? (
        <ProductDetailSheet
          key={detailProduct.id}
          slug={storefront.slug}
          product={detailProduct}
          products={products}
          saved={wishlist.has(detailProduct.id)}
          onToggleSaved={wishlist.toggle}
          onSelect={openProduct}
          onAdd={addToCart}
          onBuyNow={buyNowProduct}
          onClose={() => setDetailProduct(null)}
        />
      ) : null}

      {cart.open ? (
        <CartDrawer
          cart={cart.lines}
          note={cart.note}
          promo={cart.promo}
          freeShippingThreshold={storefront.settings.freeShippingThreshold}
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

      <CheckoutSheet
        open={checkoutOpen}
        slug={storefront.slug}
        cart={checkoutLines}
        note={buyNow ? buyNow.note : cart.note}
        settings={storefront.settings}
        branches={storefront.pickupBranches}
        promo={buyNow ? buyNow.promo : cart.promo}
        pendingCode={cart.pendingCode}
        onPromoChange={(promo) => {
          if (buyNow) setBuyNow({ ...buyNow, promo });
          else setCartPromo(promo);
        }}
        onPaid={() => {
          if (!buyNow) clearCart();
        }}
        onClose={closeCheckout}
      />
    </div>
  );
}
