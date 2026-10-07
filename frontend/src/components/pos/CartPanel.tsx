'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Gift, ShoppingBag, SlidersHorizontal, Trash2 } from 'lucide-react';
import { ManualDiscountDialog } from '@/components/pos/ManualDiscountDialog';
import type { PosCartItem } from '@/hooks/use-pos-cart';
import { lineGross } from '@/hooks/use-pos-cart';
import { cn } from '@/lib/utils';
import { formatDiscountLabel, type DiscountType } from '@/lib/pos/manual-discount';
import { allocateFreeUnitsToCartLines, type AppliedOffer } from '@/lib/promo/offer-evaluate';
import { CartExtras } from './cart-panel/cart-extras';
import { CartLine } from './cart-panel/cart-line';
import { CartActions, CartHeader } from './cart-panel/cart-chrome';
import { DiscountRow, SummaryRow } from './cart-panel/money';

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
  const money = { formatCurrency, formatArk: arkFormatter };
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
      <CartHeader
        itemCount={cart.reduce((sum, i) => sum + i.quantity, 0)}
        orderType={orderType}
        selectedTable={selectedTable}
        continuingCheckoutNumber={continuingCheckoutNumber}
        onClearCart={onClearCart}
      />

      <div className="min-h-[7rem] flex-1 space-y-1.5 overflow-y-auto px-3 py-2">
        {cart.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">
            <ShoppingBag className="mx-auto mb-2 h-10 w-10 opacity-40" />
            <p className="text-sm">No items yet</p>
          </div>
        ) : (
          cart.map((item) => (
            <CartLine
              key={item.id}
              item={item}
              freeInfo={freeByLine.get(item.id)}
              locked={lockedItemIdSet.has(item.id)}
              membershipDiscountPct={membershipDiscountPct}
              showStallBadges={showStallBadges}
              showArk={showArk}
              showItemDiscountUi={showItemDiscountUi}
              formatCurrency={formatCurrency}
              formatArk={formatArk}
              updateQuantity={updateQuantity}
              removeFromCart={removeFromCart}
              onOpenItemDiscount={setItemDialogId}
            />
          ))
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
        <SummaryRow label="Subtotal" amount={displaySubtotal} money={money} />
        {itemDiscountTotal > 0 && <DiscountRow label="Diskon item" amount={itemDiscountTotal} formatCurrency={formatCurrency} />}
        {summaryOfferDiscount > 0 && (
          <DiscountRow
            label={summaryOffers.length === 1 ? summaryOffers[0]!.name : `Promo paket (${summaryOffers.length})`}
            amount={summaryOfferDiscount}
            formatCurrency={formatCurrency}
          />
        )}
        {membershipAmt > 0 && selectedCustomer && (
          <DiscountRow
            label={`Member (${selectedCustomer.discount}%)`}
            amount={membershipAmt}
            formatCurrency={formatCurrency}
          />
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
            <span className="font-medium tabular-nums text-green-700">-{formatCurrency(promoDiscount)}</span>
          </div>
        ) : null}

        {/* Tablet-friendly (owner 2026-09-29): opsi yang jarang dipakai dilipat
            supaya daftar item mendapat ruang; nilai pajak/service tetap tampil. */}
        {!extrasOpen && tax > 0 ? <SummaryRow label={taxToggleLabel || 'Tax'} amount={tax} money={money} /> : null}
        {!extrasOpen && serviceCharge > 0 ? (
          <SummaryRow label={serviceToggleLabel || 'Service Charge'} amount={serviceCharge} money={money} />
        ) : null}
        <button
          type="button"
          onClick={() => setExtrasOpen((open) => !open)}
          aria-expanded={extrasOpen}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-dashed border-gray-300/80 bg-white px-2 py-1.5 text-left text-xs font-medium text-gray-600 transition hover:border-primary/40 hover:text-brand-text"
        >
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Diskon, promo, catatan & pajak</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1">
            {extrasActive.map((label) => (
              <span key={label} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-text">
                {label}
              </span>
            ))}
            <ChevronDown className={cn('h-3.5 w-3.5 transition', extrasOpen && 'rotate-180')} />
          </span>
        </button>
        {extrasOpen ? (
          <CartExtras
            money={money}
            manualDiscount={
              showManualUi
                ? {
                    amount: manualDiscountAmount,
                    label: manualLabel,
                    disabled: cart.length === 0 || (manualDiscountBasis <= 0 && manualDiscountAmount <= 0),
                  }
                : null
            }
            onOpenManualDiscount={() => setTxDialogOpen(true)}
            promo={
              !(promoApplied && promoDiscount > 0) && showPromoUi
                ? {
                    input: promoInput,
                    busy: promoBusy,
                    error: promoError,
                    disabled: promoDisabled,
                    onInputChange: onPromoInputChange,
                    onApply: onApplyPromo,
                  }
                : null
            }
            orderNotes={orderNotes}
            onOrderNotesChange={onOrderNotesChange}
            tax={{ label: taxToggleLabel, amount: tax, included: includeTax, onToggle: () => setIncludeTax(!includeTax) }}
            service={{
              label: serviceToggleLabel,
              amount: serviceCharge,
              included: includeService,
              onToggle: setIncludeService ? () => setIncludeService(!includeService) : undefined,
            }}
          />
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
            <div className="text-xl font-bold tabular-nums text-brand-text">
              {formatCurrency(totalAfterArk)}
            </div>
          </div>
        )}
      </div>

      <CartActions
        canTransact={canTransact}
        onOpenShift={onOpenShift}
        empty={cart.length === 0}
        isSavingBill={isSavingBill}
        orderLabel={continuingCheckoutNumber && hasNewItems ? 'Order lagi' : 'Order'}
        payLabel={`Pay ${formatCurrency(total)}`}
        onOpenBill={onOpenBill}
        onPay={setShowPaymentModal}
      />

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
