'use client';

import { Gift, Minus, Percent, Plus, Trash2 } from 'lucide-react';
import type { PosCartItem } from '@/hooks/use-pos-cart';
import { lineDiscountAmount } from '@/hooks/use-pos-cart';
import { formatDiscountLabel } from '@/lib/pos/manual-discount';
import { memberPrice } from '@/lib/pos/member-price';
import { cn } from '@/lib/utils';

/**
 * Satu baris keranjang: bagian berbayar (qty, harga member/diskon item) dan,
 * bila promo Buy X Get Y berlaku, baris FREE terpisah.
 */
export function CartLine({
  item,
  freeInfo,
  locked,
  membershipDiscountPct,
  showStallBadges,
  showArk,
  showItemDiscountUi,
  formatCurrency,
  formatArk,
  updateQuantity,
  removeFromCart,
  onOpenItemDiscount,
}: {
  item: PosCartItem;
  freeInfo?: { freeQty: number; offerName?: string | null };
  locked: boolean;
  membershipDiscountPct: number;
  showStallBadges: boolean;
  showArk: boolean;
  showItemDiscountUi: boolean;
  formatCurrency: (value: number) => string;
  formatArk: (value: number) => string;
  updateQuantity: (id: string, delta: number) => void;
  removeFromCart: (id: string) => void;
  onOpenItemDiscount: (id: string) => void;
}) {
  const discAmt = lineDiscountAmount(item);
  const label = formatDiscountLabel(item.discount_type, item.discount_value);
  const netUnit = Math.max(0, item.price - (discAmt > 0 ? discAmt / item.quantity : 0));
  // Member terpilih (owner 2026-10-01): harga reguler dicoret + harga member.
  const memberUnit = memberPrice(netUnit, membershipDiscountPct);
  const showMemberPrice = memberUnit < netUnit;
  const freeQty = freeInfo?.freeQty ?? 0;
  const paidQty = Math.max(0, item.quantity - freeQty);
  const showPaid = paidQty > 0 || freeQty === 0;

  return (
    <div className="space-y-1.5">
      {showPaid && (
        <div className="rounded-lg border border-gray-200/60 bg-muted/30 px-2.5 py-2">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {item.name}
                {showStallBadges && item.stallName ? (
                  <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-wide text-sky-700">
                    {item.stallName}
                  </span>
                ) : null}
              </div>
              {(item.variantName ||
                (item.modifierNames && item.modifierNames.length > 0)) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.variantName && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-text">
                      {item.variantName}
                    </span>
                  )}
                  {item.modifierNames?.map((mod, idx) => (
                    <span
                      key={idx}
                      className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                    >
                      {mod}
                    </span>
                  ))}
                </div>
              )}
              {item.notes && (
                <div className="mt-0.5 truncate text-[11px] italic text-muted-foreground">
                  {item.notes}
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-baseline gap-1.5">
                {showMemberPrice ? (
                  <>
                    <span className="text-[11px] text-muted-foreground line-through">
                      {formatCurrency(item.price)}
                    </span>
                    <span className="text-xs font-semibold text-brand-text">
                      {formatCurrency(memberUnit)}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {formatCurrency(discAmt > 0 ? netUnit : item.price)}
                  </span>
                )}
                {showArk && (
                  <span className="text-[11px] font-medium text-amber-600/90">
                    {formatArk(showMemberPrice ? memberUnit : discAmt > 0 ? netUnit : item.price)}
                  </span>
                )}
                {label && (
                  <span className="text-[11px] font-medium text-green-700">
                    {label}
                  </span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-center gap-1 self-center">
              <div className="flex items-center rounded-md border border-gray-200/80 bg-white">
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => updateQuantity(item.id, -1)}
                  className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                  aria-label="Kurangi qty"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="w-5 text-center text-xs font-semibold tabular-nums">
                  {paidQty > 0 ? paidQty : item.quantity}
                </span>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => updateQuantity(item.id, 1)}
                  className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                  aria-label="Tambah qty"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              {showItemDiscountUi && (
                <button
                  type="button"
                  onClick={() => onOpenItemDiscount(item.id)}
                  title="Diskon item"
                  aria-label="Diskon item"
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-md border transition',
                    label
                      ? 'border-primary/30 bg-primary/10 text-brand-text'
                      : 'border-gray-200/80 bg-white text-muted-foreground hover:border-primary/30 hover:text-brand-text'
                  )}
                >
                  <Percent className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                disabled={locked}
                onClick={() => removeFromCart(item.id)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                aria-label="Hapus item"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {freeQty > 0 && (
        <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/80 px-2.5 py-2">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center rounded-md bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Free
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                  <Gift className="h-3 w-3" />
                  {freeInfo?.offerName || 'Promo'}
                </span>
              </div>
              <div className="truncate text-sm font-medium text-foreground">
                {item.name}
                {showStallBadges && item.stallName ? (
                  <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-wide text-sky-700">
                    {item.stallName}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-xs font-medium text-emerald-700">
                {formatCurrency(0)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <div className="flex h-7 min-w-8 items-center justify-center rounded-md border border-emerald-200/80 bg-white px-2 text-xs font-semibold tabular-nums text-emerald-800">
                {freeQty}
              </div>
              {paidQty === 0 && (
                <button
                  type="button"
                  onClick={() => removeFromCart(item.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600"
                  aria-label="Hapus item gratis"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
