'use client';

import { Suspense, useEffect, useReducer, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { RESTAURANT_FROM, isRestaurantImmersive, restaurantPath } from '@/features/pos/restaurant/nav';
import {
  cashierDesktopRoute,
  cashierTabletRoute,
  isPosTabletQuery,
  shouldShowSecondaryPosDisplays,
} from '@/features/pos/tablet-mode';
import { useHandheldClient } from '@/features/pos/use-handheld-client';
import { useLoyaltySettings } from '@/features/pos/loyalty-settings';
import { useResolvedBillingProfile } from '@/features/pos/billing-settings';
import { buildTopupCardPath } from '@/features/pos/nfc';
import { useCanUseCentralCashier } from '@/components/pos/confirm-stall-switch-dialog';
import { CartPanel } from '@/components/pos/CartPanel';
import { CustomizationModal } from '@/components/pos/CustomizationModal';
import { CustomerSearchModal } from '@/components/pos/CustomerSearchModal';
import { GiftCardSaleDialog } from '@/components/pos/GiftCardSaleDialog';
import { MerchSkuPickerDialog } from '@/components/pos/MerchSkuPickerDialog';
import { NFCModal } from '@/components/pos/NFCModal';
import { ShiftModal } from '@/components/pos/ShiftModal';
import { PageTransition } from '@/components/motion';
import { TooltipProvider } from '@/components/ui/tooltip';
import { usePosCart } from '@/hooks/use-pos-cart';
import { usePosShift } from '@/hooks/use-pos-shift';
import { usePosOnline } from '@/hooks/use-pos-online';
import { usePosOfflineQueue } from '@/hooks/use-pos-offline';
import { useLoyaltyFeatures } from '@/lib/crm/use-loyalty-features';
import { DEFAULT_BILLING_CHARGES } from '@/lib/pos/billing-settings';
import {
  canSellMixedStall,
  shouldCreateCheckout,
  shouldDisableMixedPromo,
  uniqueStallIds,
} from '@/lib/pos/central-cashier';
import { POS_SHIFT_MANAGEMENT_ENABLED } from '@/lib/pos/feature-flags';
import { capacityWarning, normalizeGuestCount } from '@/lib/pos/guest-count';
import { formatArkAmount } from '@/lib/pos/loyalty-settings';
import { firstNameOnly, publishCfdState } from '@/lib/pos/cfd';
import { newCartItemsForOpenBillAppend } from '@/lib/pos/table-sale-target';
import { formatRupiah as formatCurrency } from '@/lib/format';
import { checkGiftCard, checkNfcTab, saveCustomer, withCustomerDiscount } from '../api';
import { cashierCartPanelClass, cashierSplitRowClass } from '../cashier-workspace-layout';
import { cashierSessionReducer, initialCashierSession, promoBasis } from '../cashier-session';
import { stallBlockedReason } from '../catalog';
import { cfdCartState, computeCashierBill } from '../checkout';
import {
  CASHIER_ID,
  buildPosOrdersUrl,
  cashierRoute,
  shouldResetCashierSession,
  type CashierPageVariant,
} from '../constants';
import { applyHandoff, planHandoff } from '../handoff';
import { usePosActiveOffers } from '../offers';
import { PaymentModal } from '../payment';
import {
  useActiveStallName,
  useCashierCatalog,
  useCashierCheckout,
  useCashierCustomers,
  useCashierOrder,
  useCashierTables,
  useCustomerFavoriteProducts,
} from '../queries';
import { useCheckoutActions } from '../use-cashier-checkout';
import { useOpenBillActions } from '../use-open-bill';
import { useCatalogActions } from '../use-catalog-actions';
import { useCashierNfc } from '../use-cashier-nfc';
import { CardPrompts } from './card-prompts';
import { CashierHeader } from './cashier-header';
import { CashierCatalogPanel } from './cashier-catalog-panel';
import { GuestCountDialog } from './guest-count-dialog';
import { ReceiptResultDialog } from './receipt-result-dialog';
import { PosOfflineRegistrar } from './pos-offline-registrar';

function CashierPageContent({ variant }: { variant: CashierPageVariant }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isTabletMode = variant === 'fullscreen' || isPosTabletQuery(searchParams);
  const handheldClient = useHandheldClient();
  const homeRoute = cashierRoute(variant, searchParams);
  const paymentOrderId = searchParams.get('orderId');
  const paymentCheckoutId = searchParams.get('checkoutId');
  const autoPay = searchParams.get('pay') === '1';
  const fromRestaurant = searchParams.get('from') === RESTAURANT_FROM;
  const handoffTableId = searchParams.get('tableId');
  const returnToRestaurantPath = restaurantPath({ immersive: isRestaurantImmersive(searchParams) });

  const { data: loyaltySettings } = useLoyaltySettings();
  const formatArk = (value: number) => formatArkAmount(value, loyaltySettings?.ark_rate || 1000);
  // Saklar fitur CRM → Pengaturan: sembunyikan ARK Coin / XP bila dimatikan.
  const { arkCoin: arkEnabled, xp: xpEnabled } = useLoyaltyFeatures();

  const catalogQuery = useCashierCatalog();
  const products = catalogQuery.data?.products ?? [];
  const activeMode = catalogQuery.data?.activeMode ?? null;
  const allStalls = catalogQuery.data?.allStalls ?? false;
  const customersQuery = useCashierCustomers();
  const customers = customersQuery.data ?? [];
  const refetchCustomers = () => void customersQuery.refetch();
  const canUseCentralCashier = useCanUseCentralCashier();
  const canSellMixed = canSellMixedStall({
    hasCentralMenu: canUseCentralCashier,
    canCentralCheckout: canUseCentralCashier,
    activeMode: activeMode ?? 'unset',
  });
  const centralAllMode = canUseCentralCashier && activeMode === 'all';

  const cart = usePosCart();
  const [session, dispatch] = useReducer(cashierSessionReducer, undefined, initialCashierSession);
  // Tabel hanya utk nomor meja open bill dari Restaurant (kasir tidak memilih meja).
  const { data: tables = [] } = useCashierTables();
  const { data: paymentOrder } = useCashierOrder(paymentCheckoutId ? null : paymentOrderId);
  const { data: paymentCheckout } = useCashierCheckout(paymentCheckoutId);
  const { data: stallName = null } = useActiveStallName();

  const { isOnline } = usePosOnline();
  const { pendingCount, enqueue, refreshCount } = usePosOfflineQueue();
  const { shift, isActive: hasShift, loading: loadingShift, openShift, closeShift } = usePosShift(CASHIER_ID);
  const [showShiftModal, setShowShiftModal] = useState(false);
  const billingQuery = useResolvedBillingProfile({});
  const billingCharges = billingQuery.data?.charges?.length ? billingQuery.data.charges : DEFAULT_BILLING_CHARGES;

  /** Jumlah tamu (EPIC-038): dari ?pax= Restaurant, masih bisa dikoreksi. String: kosong ≠ 0. */
  const [guestCount, setGuestCount] = useState(searchParams.get('pax') ?? '');
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [customerPicker, setCustomerPicker] = useState({ open: false, search: '', nfcUid: null as string | null });

  const requireActiveShift = () => {
    if (!POS_SHIFT_MANAGEMENT_ENABLED) return true;
    if (loadingShift) {
      toast.message('Checking shift status...');
      return false;
    }
    if (!hasShift) {
      toast.error('Please open a shift before starting a transaction.');
      setShowShiftModal(true);
      return false;
    }
    return true;
  };

  /* Handoff URL (Orders / Restaurant / menu) diterapkan saat render, sekali per kunci. */
  applyHandoff(
    planHandoff({
      hydrated: cart.hydrated,
      params: {
        orderId: paymentOrderId,
        checkoutId: paymentCheckoutId,
        tableId: handoffTableId,
        orderType: searchParams.get('orderType'),
        fromRestaurant,
        autoPay,
        freshEntry: shouldResetCashierSession(searchParams),
      },
      order: paymentOrder,
      checkout: paymentCheckout,
      session,
    }),
    cart,
    dispatch
  );

  const customer = cart.selectedCustomerId
    ? customers.find((c) => c.id === cart.selectedCustomerId || c.phone === cart.selectedCustomerId) ?? null
    : null;
  // Promo basi saat subtotal item / customer berubah.
  const basis = promoBasis(cart.itemsSubtotal, cart.selectedCustomerId);
  if (session.promo.basis !== basis) dispatch({ type: 'promoBasisChanged', basis });

  const activeOffersQuery = usePosActiveOffers(true, cart.selectedCustomerId ?? null);
  const offers = activeOffersQuery.data ?? [];
  const membershipPct = customer ? customer.discount : 0;
  const bill = computeCashierBill({
    items: cart.items,
    offerRules: offers.map((offer) => offer.eval),
    promo: session.promo.applied,
    membershipPct,
    manualType: cart.manual_discount_type,
    manualValue: cart.manual_discount_value,
    charges: billingCharges,
    includeTax: cart.includeTax,
    includeService: cart.includeService,
    arkBalance: customer ? customer.ark_coin_balance : null,
    arkToUse: session.tender.arkToUse,
  });
  const cartStallIds = uniqueStallIds(cart.items.map((row) => row.warehouse_id));
  const mixedCart = shouldCreateCheckout(cartStallIds);

  // URL tableId dari Restaurant menang atas meja basi di localStorage.
  const tableId = fromRestaurant && handoffTableId ? handoffTableId : cart.selectedTable;
  const tableRow = tableId ? tables.find((table) => table.id === tableId) : undefined;
  // Jangan tampilkan UUID mentah bila daftar meja belum match.
  const tableLabel = tableId
    ? tableRow
      ? tableRow.label || tableRow.table_number || tableRow.name || tableRow.qr_code || 'Table'
      : 'Meja'
    : null;
  const tableCapacity = tableRow?.capacity ?? null;

  const { data: favorites = [] } = useCustomerFavoriteProducts(customer?.id, products);

  const nfc = useCashierNfc({
    customers,
    totalDue: bill.total,
    paymentOpen: session.paymentOpen,
    arkEnabled,
    selectCustomer: cart.setCustomer,
  });

  const shared = {
    cart,
    session,
    dispatch,
    bill,
    customer,
    guestCount: normalizeGuestCount(guestCount),
    shiftId: shift?.id || null,
    isOnline,
    paymentCheckoutId,
    fromRestaurant,
    requireActiveShift,
  };
  const checkout = useCheckoutActions({
    ...shared,
    // Bill self-order tamu: nama pemesan dari form wajib (bukan member).
    contactName: paymentOrder?.contact_name?.trim() || undefined,
    table: { id: tableId, label: tableLabel },
    stallName,
    xpEnabled,
    paymentOrderId,
    paymentCheckout,
    mixedCart,
    homeRoute,
    refetchCustomers,
    openNfc: nfc.openNfc,
    enqueueOffline: enqueue,
    refreshOfflineCount: refreshCount,
  });
  const openBillActions = useOpenBillActions({
    ...shared,
    tableId,
    restaurantPath: returnToRestaurantPath,
  });

  const catalog = useCatalogActions({
    cart,
    products,
    canSellMixed,
    centralAllMode,
    payingExistingCheckout: Boolean(paymentCheckoutId && autoPay),
    requireActiveShift,
    formatCurrency,
    onGiftCardBuyer: (buyer) => dispatch({ type: 'giftCardBuyerSet', buyer }),
  });

  /* EPIC-024: pancarkan keranjang/pembayaran ke layar customer (BroadcastChannel, satu arah). */
  const cfdDiscount = bill.stack.discount_amount;
  const cfdTax = bill.billCharges.tax_amount;
  const memberName = firstNameOnly(customer?.name);
  useEffect(() => {
    publishCfdState(
      cfdCartState({
        items: cart.items,
        subtotal: cart.subtotal,
        discount: cfdDiscount,
        tax: cfdTax,
        arkUsed: bill.arkToUseCapped,
        total: bill.total,
        payment: session.cfdPayment,
        memberName,
      })
    );
  }, [cart.items, cart.subtotal, cfdDiscount, cfdTax, bill.arkToUseCapped, bill.total, session.cfdPayment, memberName]);

  const openPayment = () => {
    if (cart.items.length === 0) return;
    if (!requireActiveShift()) return;
    const unsaved = newCartItemsForOpenBillAppend({
      items: cart.items,
      persistedItemIds: session.bill.persistedItemIds,
    });
    if (paymentCheckoutId && unsaved.length > 0) {
      toast.message('Order dulu item baru, baru bayar tagihan');
      return;
    }
    dispatch({ type: 'paymentOpened' });
  };

  const handleCreateCustomer = async (payload: {
    name: string;
    phone: string;
    email?: string;
    enroll_member: boolean;
    nfc_uid?: string;
    is_kol?: boolean;
  }) => {
    const response = await saveCustomer({ ...payload, membership_tier: 'regular' });
    await customersQuery.refetch();
    return withCustomerDiscount(response.data);
  };

  const shellHeight = isTabletMode ? 'h-[calc(100dvh-7rem)] min-h-[520px]' : 'h-[calc(100dvh-14rem)] min-h-[480px]';
  const dialog = catalog.dialog;

  return (
    <TooltipProvider>
      <PageTransition
        className={
          isTabletMode
            ? 'flex h-[calc(100dvh-1rem)] min-h-0 flex-col sm:h-[calc(100dvh-1.5rem)] md:h-[calc(100dvh-2rem)]'
            : undefined
        }
      >
        <div className={`flex flex-col ${isTabletMode ? 'min-h-0 flex-1 gap-2 touch-manipulation' : 'gap-4'}`}>
          <CashierHeader
            isTabletMode={isTabletMode}
            orderType={cart.orderType}
            tableLabel={tableLabel}
            guestCount={normalizeGuestCount(guestCount)}
            capacityWarning={capacityWarning(normalizeGuestCount(guestCount), tableCapacity)}
            fromRestaurant={fromRestaurant}
            showSecondaryDisplays={shouldShowSecondaryPosDisplays({ immersiveTablet: isTabletMode, handheldClient })}
            ordersHref={buildPosOrdersUrl({ from: 'cashier', tablet: isTabletMode })}
            onEditGuests={() => setShowGuestModal(true)}
            onBackToRestaurant={() => {
              if (cart.items.length > 0 && !window.confirm('Leave cashier and discard cart?')) return;
              router.push(returnToRestaurantPath);
            }}
            onToggleImmersive={(next) => {
              if (next) router.push(cashierTabletRoute(searchParams));
              else router.replace(cashierDesktopRoute(searchParams));
            }}
          />

          <div className={cashierSplitRowClass({ isTabletMode, shellHeight })}>
            <CashierCatalogPanel
              isTabletMode={isTabletMode}
              products={products}
              loading={catalogQuery.isPending}
              error={catalogQuery.error?.message ?? null}
              blockedReason={catalogQuery.data ? stallBlockedReason(products.length, catalogQuery.data.reason) : null}
              showStallFilters={centralAllMode}
              showStallNames={allStalls}
              offers={offers}
              customer={customer}
              favorites={favorites}
              arkEnabled={arkEnabled}
              xpEnabled={xpEnabled}
              formatCurrency={formatCurrency}
              formatArk={formatArk}
              orderType={cart.orderType}
              onOrderType={(orderType) => {
                cart.setOrderType(orderType);
                cart.setTable(null);
              }}
              onFindCustomer={() => setCustomerPicker((prev) => ({ ...prev, open: true }))}
              onClearCustomer={() => cart.setCustomer(null)}
              notices={{
                isOnline,
                pendingCount,
                loadingShift,
                hasShift,
                onOpenShift: () => setShowShiftModal(true),
              }}
              actions={catalog}
            />

            <CartPanel
              showArk={arkEnabled}
              className={cashierCartPanelClass(isTabletMode)}
              cart={cart.items}
              orderType={cart.orderType}
              selectedTable={tableLabel}
              subtotal={cart.subtotal}
              discountAmount={bill.stack.discount_amount}
              membershipDiscountAmount={bill.stack.membership_amount}
              membershipDiscountPct={membershipPct}
              promoApplied={session.promo.applied}
              promoDiscount={bill.stack.promo_amount}
              promoInput={session.promo.input}
              promoBusy={session.promo.busy}
              promoError={session.promo.error}
              promoDisabled={!isOnline || shouldDisableMixedPromo(cartStallIds)}
              onPromoInputChange={(value) => dispatch({ type: 'promoInputChanged', value })}
              onApplyPromo={openBillActions.applyPromo}
              onClearPromo={() => dispatch({ type: 'promoCleared' })}
              orderNotes={cart.notes}
              onOrderNotesChange={cart.setNotes}
              showStallBadges={allStalls}
              itemDiscountTotal={bill.stack.line_discount_total}
              offerDiscount={bill.stack.offer_amount}
              offerApplied={bill.offerEval.applied}
              manualDiscountAmount={bill.stack.manual_amount}
              manualDiscountType={cart.manual_discount_type}
              manualDiscountValue={cart.manual_discount_value}
              manualDiscountBasis={bill.manualDiscountBasis}
              onSetItemDiscount={cart.setItemDiscount}
              onSetManualDiscount={cart.setManualDiscount}
              selectedCustomer={customer}
              includeTax={cart.includeTax}
              includeService={cart.includeService}
              tax={bill.billCharges.tax_amount}
              serviceCharge={bill.billCharges.service_charge_amount}
              taxToggleLabel={bill.taxLabel}
              serviceToggleLabel={bill.serviceLabel}
              otherChargeLines={bill.otherChargeLines}
              arkToUseCapped={bill.arkToUseCapped}
              paymentMethod={session.tender.method}
              totalAfterArk={bill.totalAfterArk}
              total={bill.total}
              formatCurrency={formatCurrency}
              formatArk={formatArk}
              setIncludeTax={cart.setIncludeTax}
              setIncludeService={cart.setIncludeService}
              setShowPaymentModal={openPayment}
              onOpenBill={openBillActions.saveOpenBill}
              continuingCheckoutNumber={paymentCheckoutId ? session.bill.number : null}
              lockedItemIds={session.bill.persistedItemIds}
              isSavingBill={session.savingBill}
              canTransact={hasShift && !loadingShift}
              onOpenShift={POS_SHIFT_MANAGEMENT_ENABLED ? () => setShowShiftModal(true) : undefined}
              updateQuantity={cart.updateQty}
              removeFromCart={cart.removeItem}
              onClearCart={() => {
                if (cart.items.length === 0) return;
                cart.clearItems();
                dispatch({ type: 'cartCleared' });
                toast.success('Keranjang dikosongkan');
              }}
            />

            <CustomerSearchModal
              open={customerPicker.open}
              customers={customers}
              search={customerPicker.search}
              selectedCustomerId={cart.selectedCustomerId}
              onSearchChange={(search) => setCustomerPicker((prev) => ({ ...prev, search }))}
              onCreateCustomer={handleCreateCustomer}
              initialNfcUid={customerPicker.nfcUid}
              onSelect={(c) => {
                cart.setCustomer(c?.id ?? null);
                setCustomerPicker({ open: false, search: '', nfcUid: null });
                if (c) toast.success(`Member ${c.name || c.phone} dipilih`);
              }}
              onClose={() => setCustomerPicker((prev) => ({ ...prev, open: false, nfcUid: null }))}
            />

            <GuestCountDialog
              open={showGuestModal}
              value={guestCount}
              tableLabel={tableLabel}
              capacity={tableCapacity}
              onOpenChange={setShowGuestModal}
              onSave={setGuestCount}
            />

            <CustomizationModal
              showArk={arkEnabled}
              open={dialog?.kind === 'customize'}
              product={dialog?.kind === 'customize' ? dialog.product : null}
              value={dialog?.kind === 'customize' ? dialog.value : null}
              onChange={catalog.updateCustomization}
              onConfirm={catalog.confirmCustomization}
              onCancel={catalog.closeDialog}
              formatCurrency={formatCurrency}
              formatArk={formatArk}
              memberDiscountPercent={membershipPct}
            />

            <PaymentModal
              open={session.paymentOpen}
              total={bill.total}
              totalAfterArk={bill.totalAfterArk}
              selectedCustomer={customer}
              onClose={() => dispatch({ type: 'paymentClosed' })}
              submitting={checkout.submitting}
              isMixedCart={mixedCart}
              isCheckoutBill={Boolean(paymentCheckoutId)}
              payingOrderId={paymentOrderId}
              onPrepareMixedQrisCheckout={mixedCart ? checkout.prepareMixedQrisCheckout : undefined}
              onPrepareOrderQris={openBillActions.prepareOrderQris}
              onAbandonOrderQris={openBillActions.abandonOrderQris}
              onConfirm={checkout.confirmPayment}
              formatCurrency={formatCurrency}
              formatArk={formatArk}
              onTapNFC={nfc.openNfc}
              onCfdPayment={(payment) => dispatch({ type: 'cfdPaymentChanged', payment })}
              onCheckGiftCard={(code) => checkGiftCard(code, bill.total)}
              onCheckNfcTab={(uid) => checkNfcTab(uid, bill.total)}
            />

            {dialog?.kind === 'merch_sku' && (
              <MerchSkuPickerDialog
                product={dialog.product}
                onSelect={catalog.selectMerchSku}
                onClose={catalog.closeDialog}
                formatCurrency={formatCurrency}
              />
            )}

            {dialog?.kind === 'gift_card' && (
              <GiftCardSaleDialog
                open
                productName={dialog.product.name}
                onClose={catalog.closeDialog}
                onConfirm={catalog.confirmGiftCard}
                formatCurrency={formatCurrency}
              />
            )}

            <NFCModal
              open={nfc.nfc.open}
              input={nfc.nfc.input}
              searching={nfc.nfc.searching}
              error={nfc.nfc.error}
              onInputChange={nfc.setNfcInput}
              onSubmit={nfc.submitNfc}
              onCancel={nfc.cancelNfc}
            />

            <CardPrompts
              prompt={nfc.prompt}
              formatArk={formatArk}
              onDismiss={nfc.dismissPrompt}
              onCreateMember={(uid) => setCustomerPicker((prev) => ({ ...prev, open: true, nfcUid: uid }))}
              onTopup={(uid) => {
                dispatch({ type: 'paymentClosed' });
                router.push(buildTopupCardPath(uid));
              }}
            />

            <ReceiptResultDialog
              result={session.result}
              formatCurrency={formatCurrency}
              onClose={() => {
                const goBack = session.returnAfterResult;
                dispatch({ type: 'resultClosed' });
                if (goBack) router.push(returnToRestaurantPath);
              }}
            />

            {POS_SHIFT_MANAGEMENT_ENABLED ? (
              <ShiftModal
                open={showShiftModal}
                shift={shift}
                onClose={() => setShowShiftModal(false)}
                onOpenShift={openShift}
                onCloseShift={closeShift}
                formatCurrency={formatCurrency}
              />
            ) : null}
          </div>
        </div>
      </PageTransition>
    </TooltipProvider>
  );
}

export function CashierPage({ variant = 'embedded' }: { variant?: CashierPageVariant }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading cashier...
        </div>
      }
    >
      <PosOfflineRegistrar />
      <CashierPageContent variant={variant} />
    </Suspense>
  );
}
