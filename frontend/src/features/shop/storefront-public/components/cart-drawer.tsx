import { Minus, Plus, Trash2, X } from 'lucide-react';
import { formatRupiah } from '@/lib/format';
import { cartSubtotal, type CartLine } from '@/lib/shop/storefront-cart';

export function CartDrawer({
  cart,
  onChangeQty,
  onRemove,
  onCheckout,
  onClose,
}: {
  cart: CartLine[];
  onChangeQty: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  onCheckout: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-md flex-col bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Keranjang</h2>
          <button type="button" onClick={onClose} aria-label="Tutup">
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {cart.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-400">Keranjang kosong</p>
          ) : (
            cart.map((line) => (
              <div key={line.key} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{line.name}</p>
                  {line.variantName ? <p className="text-xs text-gray-400">{line.variantName}</p> : null}
                  <p className="text-sm font-semibold text-pink-600">{formatRupiah(line.price)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onChangeQty(line.key, -1)}
                    className="rounded-full border border-gray-200 p-1"
                    aria-label="Kurangi"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-6 text-center text-sm font-medium">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => onChangeQty(line.key, 1)}
                    className="rounded-full border border-gray-200 p-1"
                    aria-label="Tambah"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => onRemove(line.key)} aria-label="Hapus">
                    <Trash2 className="h-4 w-4 text-red-400" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        {cart.length > 0 ? (
          <div className="border-t border-gray-100 px-5 py-4">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span className="font-semibold text-gray-900">{formatRupiah(cartSubtotal(cart))}</span>
            </div>
            <button
              type="button"
              onClick={onCheckout}
              className="w-full rounded-lg bg-pink-600 px-4 py-3 text-sm font-semibold text-white hover:bg-pink-700"
            >
              Lanjut ke Pengiriman
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
