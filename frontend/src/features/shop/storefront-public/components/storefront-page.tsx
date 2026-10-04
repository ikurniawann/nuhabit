'use client';

// EPIC-039 Fase D — storefront publik: katalog → varian → keranjang →
// checkout (area + ongkir live) → redirect invoice Xendit.
// Keranjang disimpan di localStorage per slug.

import { useState } from 'react';
import { Loader2, Package, ShoppingBag, ShoppingCart } from 'lucide-react';
import { formatRupiah } from '@/lib/format';
import {
  addCartLine,
  cartCount,
  changeCartQuantity,
  removeCartLine,
} from '@/lib/shop/storefront-cart';
import type { CatalogProduct, CatalogSku } from '@/lib/shop/types';
import { useStorefrontCatalog, useStoredCart } from '../queries';
import { CartDrawer } from './cart-drawer';
import { CheckoutDrawer } from './checkout-drawer';
import { ProductDetailSheet } from './product-detail-sheet';

export function ShopStorefrontPage({ slug }: { slug: string }) {
  const catalog = useStorefrontCatalog(slug);
  const [cart, setCart] = useStoredCart(slug);
  const [detailProduct, setDetailProduct] = useState<CatalogProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const addToCart = (product: CatalogProduct, sku: CatalogSku | null) => {
    setCart((prev) => addCartLine(prev, product, sku));
    setDetailProduct(null);
    setCartOpen(true);
  };

  const clearCart = () => {
    setCart([]);
    try {
      window.localStorage.removeItem(`shop-cart-${slug}`);
    } catch {
      /* storage diblokir — abaikan */
    }
  };

  if (catalog.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-pink-500" />
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

  const { storefront, products } = catalog.data;
  const count = cartCount(cart);

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
            onClick={() => setCartOpen(true)}
            className="relative rounded-full bg-pink-600 p-2.5 text-white shadow hover:bg-pink-700"
            aria-label="Keranjang"
          >
            <ShoppingCart className="h-5 w-5" />
            {count > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-900 px-1 text-xs font-bold">
                {count}
              </span>
            ) : null}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {products.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-24 text-gray-400">
            <ShoppingBag className="h-10 w-10 opacity-40" />
            <p className="text-sm">Belum ada produk di toko ini</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => {
              const image = product.images[0] || product.imageUrl;
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => setDetailProduct(product)}
                  disabled={product.stock <= 0}
                  className="group flex flex-col overflow-hidden rounded-xl border border-gray-100 bg-white text-left shadow-sm transition hover:shadow-md disabled:opacity-60"
                >
                  <div className="flex aspect-square items-center justify-center bg-gray-100">
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={image} alt={product.name} className="h-full w-full object-cover" />
                    ) : (
                      <Package className="h-10 w-10 text-gray-300" />
                    )}
                  </div>
                  <div className="space-y-1 p-3">
                    <p className="line-clamp-2 text-sm font-medium text-gray-900">{product.name}</p>
                    <p className="text-sm font-semibold text-pink-600">{formatRupiah(product.price)}</p>
                    <p className="text-xs text-gray-400">
                      {product.stock > 0 ? `Stok ${product.stock}` : 'Stok habis'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>

      {detailProduct ? (
        <ProductDetailSheet product={detailProduct} onAdd={addToCart} onClose={() => setDetailProduct(null)} />
      ) : null}

      {cartOpen ? (
        <CartDrawer
          cart={cart}
          onChangeQty={(key, delta) => setCart((prev) => changeCartQuantity(prev, key, delta))}
          onRemove={(key) => setCart((prev) => removeCartLine(prev, key))}
          onCheckout={() => {
            setCartOpen(false);
            setCheckoutOpen(true);
          }}
          onClose={() => setCartOpen(false)}
        />
      ) : null}

      <CheckoutDrawer
        open={checkoutOpen}
        slug={slug}
        cart={cart}
        onPaid={clearCart}
        onClose={() => setCheckoutOpen(false)}
      />
    </div>
  );
}
