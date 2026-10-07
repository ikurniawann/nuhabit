"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatRupiah } from "@/lib/format";
import { cartSubtotal, parseStoredCart, type CartLine } from "@/lib/shop/storefront-cart";

declare global {
  interface Window {
    /** Set by the storefront page when its own cart drawer is mounted. */
    nhStorefront?: { openCart(): void };
  }
}

const DEFAULT_SHOP = "apparel";

function readLines(): CartLine[] {
  try {
    return parseStoredCart(window.localStorage.getItem(`shop-cart-${DEFAULT_SHOP}`));
  } catch {
    return [];
  }
}

/**
 * The cart slide-over: hands off to the storefront's own drawer when one is
 * mounted, otherwise shows the stored lines with a link to the shop.
 */
export default function CartPanel({ onClose }: { branchSlug?: string; onClose(): void }) {
  // Only mounted in the browser, inside an open Sheet.
  const [lines] = useState<CartLine[]>(readLines);

  useEffect(() => {
    if (window.nhStorefront) {
      onClose();
      window.nhStorefront.openCart();
    }
  }, [onClose]);

  return (
    <div className="space-y-4 text-sm text-body">
      {lines.length === 0 ? (
        <p>Keranjangmu masih kosong.</p>
      ) : (
        <ul className="divide-y divide-border">
          {lines.map((line) => (
            <li key={line.key} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{line.name}</p>
                {line.variantName ? <p className="text-xs text-muted-foreground">{line.variantName}</p> : null}
              </div>
              <p className="shrink-0 tabular-nums">
                {line.quantity} × {formatRupiah(line.price)}
              </p>
            </li>
          ))}
          <li className="flex items-center justify-between py-3 font-semibold text-foreground">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatRupiah(cartSubtotal(lines))}</span>
          </li>
        </ul>
      )}
      <Button asChild>
        <a href={`/${DEFAULT_SHOP}`}>{lines.length === 0 ? "Belanja di Toko" : "Lanjut ke checkout"}</a>
      </Button>
    </div>
  );
}
