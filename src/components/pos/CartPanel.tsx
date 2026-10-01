'use client';

import { useMemo, useState } from 'react';
import { memberPrice } from '@/lib/pos/member-price';
import {
  Minus,
  Plus,
  Trash2,
  ShoppingBag,
  Utensils,
  Truck,
  Check,
  Loader2,
  Percent,
  ChevronRight,
  ChevronDown,
  SlidersHorizontal,
  Gift,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ManualDiscountDialog } from '@/components/pos/ManualDiscountDialog';
import type { PosCartItem } from '@/hooks/use-pos-cart';
import { lineDiscountAmount, lineGross } from '@/hooks/use-pos-cart';
import { HelpHint } from '@/components/ui/help-hint';
import { cn } from '@/lib/utils';
import {
  formatDiscountLabel,
  type DiscountType,
} from '@/lib/pos/manual-discount';
import {
  allocateFreeUnitsToCartLines,
  type AppliedOffer,
} from '@/lib/promo/offer-evaluate';

interface CartPanelProps {
  cart: PosCartItem[];
  orderType: 'dine_in' | 'takeaway' | 'delivery' | 'self_order';
  selectedTable: string | null;
  subtotal: number;
  discountAmount: number;
  selectedCustomer: { discount?: number; name?: string } | null;
  includeTax: boolean;
  includeService?: boolean;
  tax: number;
  serviceCharge?: number;
  /** Label for optional tax toggle; null = tax not optional / hide toggle */
  taxToggleLabel?: string | null;
  /** Label for optional service toggle; null = not optional / hide toggle */
  serviceToggleLabel?: string | null;
  /** Non-tax/service charge lines from billing breakdown (fee / rounding) */
  otherChargeLines?: Array<{ code: string; name: string; amount: number }>;
  arkToUseCapped: number;
  paymentMethod: string;
  totalAfterArk: number;
  total: number;
  formatCurrency: (value: number) => string;
  formatArk: (value: number) => string;
  /** Saklar fitur ARK Coin (CRM → Pengaturan). Default tampil. */
  showArk?: boolean;
  setIncludeTax: (val: boolean) => void;
  setIncludeService?: (val: boolean) => void;
  setShowPaymentModal: () => void;
  onOpenBill: () => void;
  isSavingBill: boolean;
  canTransact?: boolean;
  onOpenShift?: () => void;
  updateQuantity: (id: string, delta: number) => void;
  removeFromCart: (id: string) => void;
  /** Kosongkan item keranjang (meja/customer tetap) */
  onClearCart?: () => void;
  /** EPIC-032 C2 — kode promo kasir (opsional; tanpa props = tanpa UI promo) */
  membershipDiscountAmount?: number;
  /** Persen diskon member terpilih — harga baris dicoret + harga member. */
  membershipDiscountPct?: number;
  promoApplied?: { code: string; discount: number } | null;
  promoDiscount?: number;
  promoInput?: string;
  promoBusy?: boolean;
  promoError?: string | null;
  promoDisabled?: boolean;
  onPromoInputChange?: (value: string) => void;
  onApplyPromo?: () => void;
  onClearPromo?: () => void;
  /** Catatan transaksi — ikut tercetak di struk customer & CO dapur/bar */
  orderNotes?: string;
  onOrderNotesChange?: (value: string) => void;
  /** Mode Semua Stall — tampilkan badge stall asal per item */
  showStallBadges?: boolean;
  itemDiscountTotal?: number;
  /** Auto product offers (bundle/bxgy/volume) */
  offerDiscount?: number;
  offerApplied?: AppliedOffer[];
  manualDiscountAmount?: number;
  manualDiscountType?: DiscountType | null;
  manualDiscountValue?: number | null;
  manualDiscountBasis?: number;
  onSetItemDiscount?: (
    id: string,
    type: DiscountType | null,
    value: number | null
  ) => void;
  onSetManualDiscount?: (type: DiscountType | null, value: number | null) => void;
  className?: string;
  /** Open bill yang sedang dilanjutkan — item lama terkunci, item baru di-Order lagi. */
  continuingCheckoutNumber?: string | null;
  lockedItemIds?: string[];
}

function MoneyPair({
  amount,
  formatCurrency,
  formatArk,
  className,
  arkClassName,
}: {
  amount: number;
  formatCurrency: (value: number) => string;
  /** Kosong = baris ARK tidak ditampilkan (fitur ARK Coin nonaktif). */
  formatArk?: (value: number) => string;
  className?: string;
  arkClassName?: string;
}) {
  return (
    <div className={cn('text-right leading-tight', className)}>
      <div className="font-medium text-foreground">{formatCurrency(amount)}</div>
      {formatArk && (
        <div className={cn('text-[11px] font-medium text-amber-600/90', arkClassName)}>
          {formatArk(amount)}
        </div>
      )}
    </div>
  );
}

export function CartPanel({
  cart,
  orderType,
  selectedTable,
  subtotal,
  discountAmount,
  selectedCustomer,
  includeTax,
  includeService = true,
  tax,
  serviceCharge = 0,
  taxToggleLabel = 'Tax (10%)',
  serviceToggleLabel = null,
  otherChargeLines = [],
  arkToUseCapped,
  paymentMethod,
  totalAfterArk,
  total,
  formatCurrency,
  formatArk,
  showArk = true,
  setIncludeTax,
  setIncludeService,
  setShowPaymentModal,
  onOpenBill,
  isSavingBill,
  canTransact = true,
  onOpenShift,
  updateQuantity,
  removeFromCart,
  onClearCart,
  membershipDiscountAmount,
  membershipDiscountPct = 0,
  promoApplied = null,
  promoDiscount = 0,
  promoInput = '',
  promoBusy = false,
  promoError = null,
  promoDisabled = false,
  onPromoInputChange,
  onApplyPromo,
  onClearPromo,
  orderNotes = '',
  onOrderNotesChange,
  showStallBadges = false,
  itemDiscountTotal = 0,
  offerDiscount = 0,
  offerApplied = [],
  manualDiscountAmount = 0,
  manualDiscountType = null,
  manualDiscountValue = null,
  manualDiscountBasis = 0,
  onSetItemDiscount,
  onSetManualDiscount,
  className,
  continuingCheckoutNumber = null,
  lockedItemIds = [],
}: CartPanelProps) {
  // ARK Coin nonaktif → semua angka ARK di keranjang disembunyikan.
  const arkFormatter = showArk ? formatArk : undefined;
  const lockedItemIdSet = useMemo(() => new Set(lockedItemIds), [lockedItemIds]);
  const hasNewItems = cart.some((item) => !lockedItemIdSet.has(item.id));
  const membershipAmt = membershipDiscountAmount ?? discountAmount;
  const showPromoUi = typeof onApplyPromo === 'function';
  const showManualUi = typeof onSetManualDiscount === 'function';
  const showItemDiscountUi = typeof onSetItemDiscount === 'function';

  const [itemDialogId, setItemDialogId] = useState<string | null>(null);
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const extrasActive = [
    manualDiscountAmount > 0 ? 'Diskon' : null,
    orderNotes.trim() ? 'Catatan' : null,
    taxToggleLabel && includeTax ? 'Pajak' : null,
    serviceToggleLabel && includeService ? 'Service' : null,
  ].filter((label): label is string => Boolean(label));

  const itemForDialog = itemDialogId ? cart.find((i) => i.id === itemDialogId) : null;
  const manualLabel = formatDiscountLabel(manualDiscountType, manualDiscountValue);

  const freeByLine = useMemo(
    () => allocateFreeUnitsToCartLines(cart, offerApplied),
    [cart, offerApplied]
  );
  const freeItemCount = useMemo(() => {
    let n = 0;
    for (const v of freeByLine.values()) n += v.freeQty;
    return n;
  }, [freeByLine]);
  /** BXGY sudah ditampilkan sebagai baris FREE — ringkasan hanya bundle/volume */
  const summaryOffers = useMemo(
    () =>
      offerApplied.filter(
        (a) => a.offer_type !== 'bxgy' || !(a.free_units && a.free_units.length > 0)
      ),
    [offerApplied]
  );
  const summaryOfferDiscount = useMemo(
    () => summaryOffers.reduce((s, a) => s + (Number(a.discount) || 0), 0),
    [summaryOffers]
  );
  /** Subtotal tampilan: nilai FREE (BXGY) sudah “keluar” lewat baris gratis */
  const displaySubtotal = Math.max(
    0,
    subtotal - Math.max(0, offerDiscount - summaryOfferDiscount)
  );

  return (
    <div
      className={cn(
        'flex w-full flex-col rounded-xl border border-gray-200/70 bg-white shadow-xs',
        className
      )}
    >
      <div className="border-b border-gray-200/70 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">Order</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {cart.reduce((sum, i) => sum + i.quantity, 0)} items
            </span>
            {onClearCart && (
              <button
                type="button"
                disabled={cart.length === 0}
                onClick={onClearCart}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition',
                  cart.length === 0
                    ? 'cursor-not-allowed border-gray-200/70 text-muted-foreground/50'
                    : 'border-red-200/80 text-red-600 hover:bg-red-50'
                )}
                title="Kosongkan keranjang"
                aria-label="Kosongkan keranjang"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {orderType === 'dine_in' && (
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              <Utensils className="h-3 w-3" /> Dine-in
            </span>
          )}
          {orderType === 'takeaway' && (
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
              <ShoppingBag className="h-3 w-3" /> Takeaway
            </span>
          )}
          {orderType === 'delivery' && (
            <span className="inline-flex items-center gap-1 rounded-md bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
              <Truck className="h-3 w-3" /> Delivery
            </span>
          )}
          {orderType === 'dine_in' && selectedTable ? (
            <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              Table {selectedTable}
            </span>
          ) : null}
          {continuingCheckoutNumber ? (
            <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              Open bill {continuingCheckoutNumber}
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-h-[7rem] flex-1 space-y-1.5 overflow-y-auto px-3 py-2">
        {cart.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">
            <ShoppingBag className="mx-auto mb-2 h-10 w-10 opacity-40" />
            <p className="text-sm">No items yet</p>
          </div>
        ) : (
          cart.map((item) => {
            const discAmt = lineDiscountAmount(item);
            const label = formatDiscountLabel(item.discount_type, item.discount_value);
            const netUnit = Math.max(0, item.price - (discAmt > 0 ? discAmt / item.quantity : 0));
            // Member terpilih (owner 2026-10-01): harga reguler dicoret + harga member.
            const memberUnit = memberPrice(netUnit, membershipDiscountPct);
            const showMemberPrice = memberUnit < netUnit;
            const freeInfo = freeByLine.get(item.id);
            const freeQty = freeInfo?.freeQty ?? 0;
            const paidQty = Math.max(0, item.quantity - freeQty);
            const showPaid = paidQty > 0 || freeQty === 0;
            const locked = lockedItemIdSet.has(item.id);

            return (
              <div key={item.id} className="space-y-1.5">
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
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
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
                              <span className="text-xs font-semibold text-primary">
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
                            onClick={() => setItemDialogId(item.id)}
                            title="Diskon item"
                            aria-label="Diskon item"
                            className={cn(
                              'flex h-7 w-7 items-center justify-center rounded-md border transition',
                              label
                                ? 'border-primary/30 bg-primary/10 text-primary'
                                : 'border-gray-200/80 bg-white text-muted-foreground hover:border-primary/30 hover:text-primary'
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
          })
        )}

        {freeItemCount > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-dashed border-emerald-300/80 bg-emerald-50/50 px-2.5 py-2 text-[11px] text-emerald-800">
            <Gift className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Promo diterapkan: {freeItemCount} item gratis dari Buy X Get Y.
            </span>
          </div>
        )}
      </div>

      <div className="space-y-1.5 border-t border-gray-200/70 bg-muted/20 px-3 py-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <MoneyPair
            amount={displaySubtotal}
            formatCurrency={formatCurrency}
            formatArk={arkFormatter}
          />
        </div>

        {itemDiscountTotal > 0 && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-green-700">Diskon item</span>
            <span className="font-medium tabular-nums text-green-700">
              -{formatCurrency(itemDiscountTotal)}
            </span>
          </div>
        )}

        {summaryOfferDiscount > 0 && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-green-700">
              {summaryOffers.length === 1
                ? summaryOffers[0]!.name
                : `Promo paket (${summaryOffers.length})`}
            </span>
            <span className="font-medium tabular-nums text-green-700">
              -{formatCurrency(summaryOfferDiscount)}
            </span>
          </div>
        )}

        {membershipAmt > 0 && selectedCustomer && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-green-700">Member ({selectedCustomer.discount}%)</span>
            <span className="font-medium tabular-nums text-green-700">
              -{formatCurrency(membershipAmt)}
            </span>
          </div>
        )}

        {promoApplied && promoDiscount > 0 ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium text-green-700">Promo {promoApplied.code}</span>
              {onClearPromo && (
                <button
                  type="button"
                  onClick={onClearPromo}
                  title="Hapus promo"
                  aria-label="Hapus promo"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <span className="font-medium tabular-nums text-green-700">
              -{formatCurrency(promoDiscount)}
            </span>
          </div>
        ) : null}

        {/* Tablet-friendly (owner 2026-09-29): opsi yang jarang dipakai dilipat
            supaya daftar item mendapat ruang; nilai pajak/service tetap tampil. */}
        {!extrasOpen && tax > 0 ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{taxToggleLabel || 'Tax'}</span>
            <MoneyPair amount={tax} formatCurrency={formatCurrency} formatArk={arkFormatter} />
          </div>
        ) : null}
        {!extrasOpen && serviceCharge > 0 ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{serviceToggleLabel || 'Service Charge'}</span>
            <MoneyPair amount={serviceCharge} formatCurrency={formatCurrency} formatArk={arkFormatter} />
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setExtrasOpen((open) => !open)}
          aria-expanded={extrasOpen}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-dashed border-gray-300/80 bg-white px-2 py-1.5 text-left text-xs font-medium text-gray-600 transition hover:border-primary/40 hover:text-primary"
        >
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Diskon, promo, catatan & pajak</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1">
            {extrasActive.map((label) => (
              <span key={label} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {label}
              </span>
            ))}
            <ChevronDown className={cn('h-3.5 w-3.5 transition', extrasOpen && 'rotate-180')} />
          </span>
        </button>
        {extrasOpen ? (
          <div className="space-y-2">
        {showManualUi && (
          <button
            type="button"
            disabled={cart.length === 0 || (manualDiscountBasis <= 0 && manualDiscountAmount <= 0)}
            onClick={() => setTxDialogOpen(true)}
            className={cn(
              'flex w-full items-center justify-between gap-3 rounded-md px-1 py-0.5 text-sm transition',
              'hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
              manualDiscountAmount > 0 ? 'text-green-700' : 'text-primary'
            )}
          >
            <span className="inline-flex items-center gap-1 text-left font-medium underline decoration-primary/40 underline-offset-2">
              <Percent className="h-3.5 w-3.5 shrink-0" />
              <span>
                Diskon transaksi
                {manualDiscountAmount > 0 && manualLabel ? ` (${manualLabel.replace(/^−/, '')})` : ''}
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
            </span>
            <span
              className={cn(
                'tabular-nums',
                manualDiscountAmount > 0 ? 'font-medium' : 'text-muted-foreground'
              )}
            >
              {manualDiscountAmount > 0 ? `-${formatCurrency(manualDiscountAmount)}` : 'Atur'}
            </span>
          </button>
        )}

        {!(promoApplied && promoDiscount > 0) && showPromoUi ? (
          <div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={promoInput}
                onChange={(e) => onPromoInputChange?.(e.target.value)}
                placeholder={promoDisabled ? 'Promo offline' : 'Kode promo'}
                disabled={promoDisabled}
                className="h-8 w-full rounded-md border border-gray-200/80 bg-white px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:bg-muted/40"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 px-2.5"
                disabled={promoDisabled || promoBusy || promoInput.trim().length < 3}
                onClick={onApplyPromo}
              >
                {promoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Pakai'}
              </Button>
            </div>
            {promoError && <p className="mt-1 text-[11px] text-red-600">{promoError}</p>}
          </div>
        ) : null}
        {onOrderNotesChange ? (
          <input
            type="text"
            value={orderNotes}
            onChange={(e) => onOrderNotesChange(e.target.value)}
            maxLength={200}
            placeholder="Catatan transaksi — tercetak di CO & struk"
            className="h-8 w-full rounded-md border border-gray-200/80 bg-white px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        ) : null}

        {taxToggleLabel ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIncludeTax(!includeTax)}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
              >
                <div
                  className={`flex h-4 w-4 items-center justify-center rounded border ${
                    includeTax ? 'border-primary bg-primary' : 'border-gray-300'
                  }`}
                >
                  {includeTax && <Check className="h-3 w-3 text-white" />}
                </div>
                <span>{taxToggleLabel}</span>
              </button>
              <HelpHint helpId="pos.tax-toggle" role="default" />
            </div>
            <MoneyPair amount={tax} formatCurrency={formatCurrency} formatArk={arkFormatter} />
          </div>
        ) : tax > 0 ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Tax</span>
            <MoneyPair amount={tax} formatCurrency={formatCurrency} formatArk={arkFormatter} />
          </div>
        ) : null}

        {serviceToggleLabel && setIncludeService ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIncludeService(!includeService)}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
              >
                <div
                  className={`flex h-4 w-4 items-center justify-center rounded border ${
                    includeService ? 'border-primary bg-primary' : 'border-gray-300'
                  }`}
                >
                  {includeService && <Check className="h-3 w-3 text-white" />}
                </div>
                <span>{serviceToggleLabel}</span>
              </button>
              <HelpHint helpId="pos.service-toggle" role="default" />
            </div>
            <MoneyPair
              amount={serviceCharge}
              formatCurrency={formatCurrency}
              formatArk={arkFormatter}
            />
          </div>
        ) : serviceCharge > 0 ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Service Charge</span>
            <MoneyPair
              amount={serviceCharge}
              formatCurrency={formatCurrency}
              formatArk={arkFormatter}
            />
          </div>
        ) : null}

          </div>
        ) : null}

        {otherChargeLines.map((line) => (
          <div key={line.code} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{line.name}</span>
            <span className="font-medium tabular-nums text-foreground">
              {line.amount < 0 ? '-' : ''}
              {formatCurrency(Math.abs(line.amount))}
            </span>
          </div>
        ))}

        {paymentMethod === 'ark_coin' && arkToUseCapped > 0 && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-amber-600">ARK Coin</span>
            <span className="font-medium tabular-nums text-amber-600">-{formatArk(arkToUseCapped)}</span>
          </div>
        )}

        {paymentMethod === 'ark_coin' ? (
          <div className="border-t border-gray-200/70 pt-2.5 text-center">
            <div className="text-xs font-medium text-muted-foreground">Total Payment</div>
            <div className="text-3xl font-bold text-amber-600">{formatArk(totalAfterArk)}</div>
            <div className="text-xs text-muted-foreground">≈ {formatCurrency(totalAfterArk)}</div>
          </div>
        ) : (
          <div className="flex items-end justify-between gap-3 border-t border-gray-200/70 pt-2.5">
            <div>
              <div className="text-sm font-semibold text-foreground">Total</div>
              {showArk && <div className="text-xs font-medium text-amber-600">{formatArk(totalAfterArk)}</div>}
            </div>
            <div className="text-xl font-bold tabular-nums text-primary">
              {formatCurrency(totalAfterArk)}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1.5 border-t border-gray-200/70 px-3 py-2">
        {!canTransact && (
          <div className="rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-800">
            Open a shift to pay or save orders.{' '}
            {onOpenShift && (
              <button
                type="button"
                onClick={onOpenShift}
                className="font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700"
              >
                Open shift
              </button>
            )}
          </div>
        )}
        <div className="flex gap-2">
        <Button
            type="button"
            variant="outline"
            onClick={onOpenBill}
            disabled={cart.length === 0 || isSavingBill || !canTransact}
            className="h-11 w-[38%] shrink-0 border-amber-200/80 font-semibold text-amber-700 hover:bg-amber-50/80"
          >
            {isSavingBill ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              continuingCheckoutNumber && hasNewItems ? 'Order lagi' : 'Order'
            )}
          </Button>
        <Button
            type="button"
            onClick={setShowPaymentModal}
            disabled={cart.length === 0 || !canTransact}
            className="h-11 min-w-0 flex-1 bg-primary text-base font-semibold hover:bg-primary/90"
          >
            Pay {formatCurrency(total)}
          </Button>
        </div>
      </div>

      {showItemDiscountUi && itemForDialog && (
        <ManualDiscountDialog
          open={Boolean(itemDialogId)}
          title="Diskon item"
          description={itemForDialog.name}
          basis={lineGross(itemForDialog)}
          formatCurrency={formatCurrency}
          initialType={itemForDialog.discount_type}
          initialValue={itemForDialog.discount_value}
          onClose={() => setItemDialogId(null)}
          onApply={(type, value) => {
            onSetItemDiscount?.(itemForDialog.id, type, value);
          }}
          onClear={() => {
            onSetItemDiscount?.(itemForDialog.id, null, null);
          }}
        />
      )}

      {showManualUi && (
        <ManualDiscountDialog
          open={txDialogOpen}
          title="Diskon transaksi"
          description="Diterapkan setelah membership dan promo"
          basis={manualDiscountBasis}
          formatCurrency={formatCurrency}
          initialType={manualDiscountType}
          initialValue={manualDiscountValue}
          onClose={() => setTxDialogOpen(false)}
          onApply={(type, value) => {
            onSetManualDiscount?.(type, value);
          }}
          onClear={() => {
            onSetManualDiscount?.(null, null);
          }}
        />
      )}
    </div>
  );
}
