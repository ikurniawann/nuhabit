import { Minus, Plus, Trash2, X } from 'lucide-react';
import { formatRupiah } from '@/lib/format';
import { cartLineIssue, type CartLine } from '@/lib/shop/storefront-cart';
import { checkoutTotals, freeShippingProgress } from '@/lib/shop/storefront-checkout';
import type { AppliedPromo, CatalogProduct, CatalogSku } from '@/lib/shop/types';
import { PreorderBadge } from './preorder-note';
import { ProductPhoto } from './product-photo';

/**
 * Cart drawer: change the size in place, quantity stepper, remove a line,
 * an order note, the applied promo and the free-shipping progress bar.
 * `products` supplies the other sizes on offer.
 */
export function CartDrawer({
  cart,
  note,
  promo,
  freeShippingThreshold,
  products,
  onChangeQty,
  onChangeVariant,
  onRemove,
  onNoteChange,
  onCheckout,
  onClose,
}: {
  cart: CartLine[];
  note: string;
  promo: AppliedPromo | null;
  freeShippingThreshold: number | null;
  products: CatalogProduct[];
  onChangeQty: (key: string, delta: number) => void;
  onChangeVariant: (key: string, product: CatalogProduct, sku: CatalogSku) => void;
  onRemove: (key: string) => void;
  onNoteChange: (note: string) => void;
  onCheckout: () => void;
  onClose: () => void;
}) {
  const productOf = (line: CartLine) => products.find((product) => product.id === line.productId);
  const hasIssue = cart.some((line) => cartLineIssue(line, products));
  const totals = checkoutTotals({ lines: cart, promo, method: 'ship', rateCost: null, freeShippingThreshold });
  const progress = freeShippingProgress(totals.subtotal, freeShippingThreshold);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Cart"
        className="flex h-full w-full max-w-md flex-col bg-white"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Cart</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {progress && cart.length > 0 ? (
            <FreeShippingBar text={progress.text} ratio={progress.ratio} unlocked={progress.unlocked} />
          ) : null}
          {cart.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-400">Your cart is empty</p>
          ) : (
            cart.map((line) => {
              const product = productOf(line);
              const sizes = product?.skus ?? [];
              const image = product?.images[0] || product?.imageUrl;
              const issue = cartLineIssue(line, products);
              return (
                <div key={line.key} className="rounded-lg border border-gray-100 p-3">
                  <div className="flex items-start gap-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-[#f5f7f3]"><ProductPhoto src={image} alt={line.name} compact /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">{line.name}</p>
                      {line.variantName ? <p className="text-xs text-gray-500">{line.variantName}</p> : null}
                      <p className="text-sm font-semibold text-gray-900">{formatRupiah(line.price)}</p>
                      {line.preorderUntil ? <PreorderBadge until={line.preorderUntil} className="mt-1" /> : null}
                      {issue ? <p className="mt-1 text-xs font-medium text-red-600">{issue}</p> : null}
                    </div>
                    <button type="button" onClick={() => onRemove(line.key)} aria-label={`Remove ${line.name}`}>
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    {line.skuId && sizes.length > 0 ? (
                      <label className="flex items-center gap-2 text-xs text-gray-500">
                        Size
                        <select
                          value={line.skuId}
                          aria-label={`Size for ${line.name}`}
                          onChange={(event) => {
                            const sku = sizes.find((candidate) => candidate.id === event.target.value);
                            if (product && sku) onChangeVariant(line.key, product, sku);
                          }}
                          className="rounded-full border border-gray-200 bg-white px-3 py-1 text-sm text-gray-900"
                        >
                          {sizes.map((sku) => (
                            <option key={sku.id} value={sku.id} disabled={sku.stock <= 0 && !sku.preorder}>
                              {sku.name}
                              {sku.stock <= 0 ? (sku.preorder ? ' (pre-order)' : ' (sold out)') : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <span className="text-xs text-gray-400">{line.variantName ?? ''}</span>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onChangeQty(line.key, -1)}
                        className="rounded-full border border-gray-200 p-1"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-6 text-center text-sm font-medium">{line.quantity}</span>
                      <button
                        type="button"
                        onClick={() => onChangeQty(line.key, 1)}
                        className="rounded-full border border-gray-200 p-1"
                        aria-label="Increase quantity"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          {cart.length > 0 ? (
            <textarea
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder="Order note (optional)"
              rows={2}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-forest"
            />
          ) : null}
        </div>
        {cart.length > 0 ? (
          <div className="border-t border-gray-100 px-5 py-4">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span className={promo ? 'text-gray-900' : 'font-semibold text-gray-900'}>{formatRupiah(totals.subtotal)}</span>
            </div>
            {promo ? (
              <>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-gray-500">Discount ({promo.code})</span>
                  <span className="text-everglade">-{formatRupiah(totals.discount)}</span>
                </div>
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="text-gray-500">After discount</span>
                  <span className="font-semibold text-gray-900">{formatRupiah(totals.subtotal - totals.discount)}</span>
                </div>
              </>
            ) : <div className="mb-2" />}
            <p className="mb-3 text-xs text-gray-500">Shipping and promo codes are set at checkout.</p>
            <button
              type="button"
              onClick={onCheckout}
              disabled={hasIssue}
              className="w-full rounded-full bg-accent-strong px-4 py-3 text-sm font-semibold text-accent-foreground hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              Checkout
            </button>
            {hasIssue ? <p className="mt-2 text-center text-xs text-red-600">Update or remove the marked items to continue.</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Progress toward the free-shipping threshold. */
export function FreeShippingBar({ text, ratio, unlocked }: { text: string; ratio: number; unlocked: boolean }) {
  return (
    <div className="rounded-xl bg-[#f5f7f3] px-3 py-2.5" data-testid="free-shipping-bar">
      <p className={`text-xs font-medium ${unlocked ? 'text-forest' : 'text-gray-700'}`}>{text}</p>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-forest/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label="Free shipping progress">
        <div className="h-full rounded-full bg-forest transition-[width]" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
    </div>
  );
}
