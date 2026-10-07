'use client';

// Storefront publik: katalog per koleksi → ukuran → keranjang (atau Beli
// Sekarang) → checkout (area + ongkir live) → redirect invoice Xendit.
// Keranjang hidup di cart-store (localStorage per slug toko).

import { useEffect, useState } from 'react';
import { Loader2, Package, ShoppingBag, ShoppingCart } from 'lucide-react';
import { formatRupiah } from '@/lib/format';
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
  // Baris "Beli Sekarang": keranjang satu baris di memori, terpisah dari
  // keranjang tersimpan. null berarti checkout memakai keranjang.
  const [buyNow, setBuyNow] = useState<{ lines: CartLine[]; note: string } | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  // Keranjang mengikuti slug asli toko (/apparel memuat slug "default").
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
        <p className="text-sm text-gray-500">{catalog.error.message || 'Toko tidak ditemukan'}</p>
      </div>
    );
  }

  const { storefront, collections, products } = catalog.data;
  const groups = groupByCollection(products, collections);
  const grouped = groups.length > 1;
  const count = cartCount(cart.lines);
  const checkoutLines = buyNow ? buyNow.lines : cart.lines;

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <header className="sticky top-0 z-30 border-b border-gray-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{storefront.name}</h1>
            {storefront.description ? <p className="text-xs text-gray-400">{storefront.description}</p> : null}
          </div>
          <button
            type="button"
            onClick={openCart}
            className="relative rounded-full bg-ink p-2.5 text-on-ink shadow hover:bg-ink-3"
            aria-label={`Keranjang, ${count} item`}
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

      <main className="mx-auto max-w-5xl px-4 py-6">
        {products.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-24 text-gray-400">
            <ShoppingBag className="h-10 w-10 opacity-40" />
            <p className="text-sm">Belum ada produk di toko ini</p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.id} id={`koleksi-${group.id}`} className="scroll-mt-32 mb-8">
              {grouped ? <h2 className="mb-3 text-base font-semibold text-gray-900">{group.name}</h2> : null}
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
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => {
        const image = product.images[0] || product.imageUrl;
        const soldOut = product.stock <= 0 && !product.preorder;
        return (
          <button
            key={product.id}
            type="button"
            onClick={() => onSelect(product)}
            disabled={soldOut}
            className="group flex flex-col overflow-hidden rounded-xl border border-gray-100 bg-white text-left shadow-sm transition hover:shadow-md disabled:opacity-60"
          >
            <div className="relative flex aspect-square items-center justify-center bg-gray-100">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                <Package className="h-10 w-10 text-gray-300" />
              )}
              {product.preorder ? <PreorderBadge until={null} className="absolute left-2 top-2" /> : null}
            </div>
            <div className="space-y-1 p-3">
              <p className="line-clamp-2 text-sm font-medium text-gray-900">{product.name}</p>
              <p className="text-sm font-semibold text-gray-900">{formatRupiah(product.price)}</p>
              <p className="text-xs text-gray-400">
                {product.stock > 0 ? `Stok ${product.stock}` : product.preorder ? 'Pre-order' : 'Stok habis'}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
