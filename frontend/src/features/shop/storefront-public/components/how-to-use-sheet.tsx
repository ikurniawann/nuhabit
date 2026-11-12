'use client';

import { X } from 'lucide-react';
import { exitMotion, useStoreDialog } from './use-store-dialog';

const STEPS = [
  {
    title: 'Find what you want',
    body: 'Type in Quick search to jump to a product, or browse the collections. The filters under All products narrow the list by size, price and availability.',
  },
  {
    title: 'Check the details',
    body: 'Open a product and choose a size. Size & fit lists the measurements, and Delivery & returns covers shipping. The heart saves it for later.',
  },
  {
    title: 'Add it or buy it',
    body: 'Add to Cart keeps shopping going. Buy Now takes that one item straight to checkout.',
  },
  {
    title: 'Check out',
    body: 'Enter your WhatsApp number, then choose delivery or a pickup branch if the store offers one. Add a promo code if you have one and tap Pay Now.',
  },
  {
    title: 'Pay',
    body: 'Xendit takes QRIS, virtual account, e-wallet and card. Signed-in members can also pay with ARK Coin when the store offers it.',
  },
  {
    title: 'Follow your order',
    body: 'We send your order status link on WhatsApp. Open it any time to see progress, the tracking number, or when your pickup is ready.',
  },
  {
    title: 'Leave a review',
    body: 'Once you have received an order, you can review its products from the product page.',
  },
];

/** The store's how-to guide, opened from the top of the storefront. */
export function HowToUseSheet({ onClose }: { onClose: () => void }) {
  const { panelRef, closing, requestClose } = useStoreDialog(onClose);

  return (
    <div className={`motion-fade-in fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center ${exitMotion.backdrop(closing)}`} onClick={requestClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="store-how-to-use"
        className={`motion-rise-in sm:motion-pop-in max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl ${exitMotion.sheet(closing)}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="store-how-to-use" className="text-xl font-semibold text-gray-900">How to use</h2>
          <button type="button" onClick={requestClose} aria-label="Close" className="p-2" data-autofocus>
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>
        <ol className="space-y-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-lime text-sm font-bold text-forest">
                {i + 1}
              </span>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{step.title}</h3>
                <p className="mt-0.5 text-sm leading-6 text-gray-600">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
