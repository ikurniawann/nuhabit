'use client';

import { Suspense, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Search, Utensils, ShoppingBag, Table as TableIcon,
  User, Users, X, Sparkles, Printer, CheckCircle, AlertCircle, Loader2, ArrowLeft,
  MessageCircle,
  Monitor as MonitorIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { RESTAURANT_FROM, isRestaurantImmersive, restaurantPath } from '@/features/pos/restaurant/nav';
import {
  cashierDesktopRoute,
  cashierTabletRoute,
  isPosTabletQuery,
  shouldShowSecondaryPosDisplays,
} from '@/features/pos/tablet-mode';
import { useHandheldClient } from '@/features/pos/use-handheld-client';
import {
  cashierCartPanelClass,
  cashierLeftPanelClass,
  cashierProductGridClass,
  cashierProductScrollClass,
  cashierSplitRowClass,
} from '@/features/pos/cashier/cashier-workspace-layout';
import { PosTabletChromeControls } from '@/features/pos/components/pos-tablet-chrome-controls';
import { useCanUseCentralCashier } from '@/components/pos/confirm-stall-switch-dialog';
import { CashierStallGate } from '@/features/pos/cashier/components/cashier-stall-gate';
import {
  MIXED_ARK_UNSUPPORTED_MESSAGE,
  MIXED_LINE_DISCOUNT_UNSUPPORTED_MESSAGE,
  MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE,
  MIXED_PROMO_UNSUPPORTED_MESSAGE,
  MIXED_SPLIT_UNSUPPORTED_MESSAGE,
  buildCheckoutBillPayBody,
  canSellMixedStall,
  isCheckoutBillUnsupportedTender,
  isMixedUnsupportedTender,
  mayConfirmMixedQris,
  resolveAddCatalogItem,
  shouldCreateCheckout,
  shouldDisableSplitBill,
  shouldDisableMixedPromo,
  uniqueStallIds,
} from '@/lib/pos/central-cashier';
import { newCartItemsForOpenBillAppend } from '@/lib/pos/table-sale-target';
import { StallSwitchButton } from '@/features/pos/cashier/components/stall-switch-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogPanel,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelDescription,
  DialogPanelBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatAmount } from '@/lib/purchasing/utils';
import { capacityWarning, normalizeGuestCount } from '@/lib/pos/guest-count';
import {
  type Customer,
  type Product,
  type PosTable,
  openBill,
  saveCustomer,
  createSplitOrder,
} from '../api';
import { completeCheckout, updateOrderStatus, type ProductSku } from '@/lib/pos-api';
import { formatPaymentMethodLabel } from '@/features/pos/reports/utils/transaction-labels';
import { isFocPaymentMethod } from '@/lib/pos/payment-methods';
import { MerchSkuPickerDialog } from '@/components/pos/MerchSkuPickerDialog';
import { useCashierCheckout, useCashierOrder, useCashierTables, useCustomerFavoriteProducts } from '../queries';
import { useLoyaltyFeatures } from '@/lib/crm/use-loyalty-features';
import { computeCustomizationPrice, defaultCustomizationSelection } from '@/lib/pos/customization-price';
import { usePayOpenOrder } from '../mutations';
import { usePosCart } from '@/hooks/use-pos-cart';
import { usePosProducts } from '@/hooks/use-pos-products';
import { usePosCustomers, type CustomerWithDiscount } from '@/hooks/use-pos-customers';
import { usePosCheckout } from '@/hooks/use-pos-checkout';
import { usePosShift } from '@/hooks/use-pos-shift';
import { usePosOnline } from '@/hooks/use-pos-online';
import { usePosOfflineQueue } from '@/hooks/use-pos-offline';
import { POS_SHIFT_MANAGEMENT_ENABLED } from '@/lib/pos/feature-flags';
import {
  calculateBillCharges,
  DEFAULT_BILLING_CHARGES,
  resolveEnabledOptionalCodes,
  taxToggleLabel,
  serviceToggleLabel,
} from '@/lib/pos/billing-settings';
import { useResolvedBillingProfile } from '@/features/pos/billing-settings';
import {
  planOfferQuickAdd,
  usePosActiveOffers,
  type PosActiveOffer,
} from '@/features/pos/cashier/offers';
import { evaluateOfferRules } from '@/lib/promo/offer-evaluate';
import { PosOfferBanners } from '@/components/pos/PosOfferBanners';
import { ShiftModal } from '@/components/pos/ShiftModal';
import { PosProductThumbnail } from '@/components/pos/PosProductThumbnail';

const CASHIER_ID = '00000000-0000-0000-0000-000000000001';
import { CartPanel } from '@/components/pos/CartPanel';
import { CustomizationModal, type SelectedCustomization } from '@/components/pos/CustomizationModal';
import { PaymentModal, type PaymentMethod } from '@/components/pos/PaymentModal';
import {
  GiftCardSaleDialog,
  type GiftCardSaleValues,
} from '@/components/pos/GiftCardSaleDialog';
import {
  firstNameOnly,
  idleCfdState,
  publishCfdState,
  type CfdPayment,
} from '@/lib/pos/cfd';
import { NFCModal } from '@/components/pos/NFCModal';
import { CustomerSearchModal } from '@/components/pos/CustomerSearchModal';
import { usePosNfcOptional, findCustomerByCard, POS_NFC_CARD_EVENT, buildTopupCardPath } from '@/features/pos/nfc';
import { resolveCashierNfcAction } from '../nfc-scan-action';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { printThermalReceipt, type ReceiptPayload } from '@/components/pos/PrintReceipt';
import type { SplitConfig } from '@/components/pos/SplitBillModal';
import { SplitBillModal } from '@/components/pos/SplitBillModal';
import { SplitPaymentScreen } from '@/components/pos/SplitPaymentScreen';
import {
  buildPosOrdersUrl,
  cashierRoute,
  shouldResetCashierSession,
  type CashierPageVariant,
} from '../constants';
import { PageTransition } from '@/components/motion';
import { HelpHint } from '@/components/ui/help-hint';
import { TooltipProvider } from '@/components/ui/tooltip';
import { floorLabel, floorSortKey } from '@/features/pos/tables/floor-options';
import { useLoyaltySettings } from '@/features/pos/loyalty-settings';
import { formatArkAmount } from '@/lib/pos/loyalty-settings';

/* ─── helpers ─────────────────────────────────────────────────────── */
const formatCurrency = (value: number) => formatAmount(value);

const LAST_RECEIPT_KEY = 'pos:lastReceipt';
const LAST_OPEN_CHECKOUT_KEY = 'pos:lastOpenCheckoutId';

function readLastOpenCheckoutId() {
  try {
    return window.sessionStorage.getItem(LAST_OPEN_CHECKOUT_KEY);
  } catch {
    return null;
  }
}

function writeLastOpenCheckoutId(id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(LAST_OPEN_CHECKOUT_KEY, id);
    else window.sessionStorage.removeItem(LAST_OPEN_CHECKOUT_KEY);
  } catch {
    // sessionStorage can be blocked; append still works via in-memory ref
  }
}

const getTableDisplayName = (table?: PosTable | null) =>
  table?.label || table?.table_number || table?.name || table?.qr_code || 'Table';

function groupCashierTablesByFloor(tables: PosTable[]) {
  const map = new Map<string, PosTable[]>();
  for (const table of tables) {
    const key = String(table.floor ?? '').trim();
    const list = map.get(key) ?? [];
    list.push(table);
    map.set(key, list);
  }

  return [...map.entries()]
    .sort(([a], [b]) => floorSortKey(a) - floorSortKey(b))
    .map(([floorKey, groupTables]) => ({
      floorKey,
      label: floorLabel(floorKey),
      tables: [...groupTables].sort((a, b) =>
        getTableDisplayName(a).localeCompare(getTableDisplayName(b), undefined, {
          numeric: true,
        })
      ),
    }));
}

// Diskon dari konfigurasi tier CRM yang disertakan server (EPIC-011)
const withCustomerDiscount = (customer: Customer): CustomerWithDiscount => ({
  ...customer,
  discount: Number(customer.discount_percent) || 0,
});

/* ─── page ────────────────────────────────────────────────────────── */
function CashierPageNewContent({ variant }: { variant: CashierPageVariant }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: loyaltySettings } = useLoyaltySettings();
  const formatArk = (value: number) =>
    formatArkAmount(value, loyaltySettings?.ark_rate || 1000);
  const isTabletMode =
    variant === 'fullscreen' || isPosTabletQuery(searchParams);
  const handheldClient = useHandheldClient();
  const showSecondaryDisplays = shouldShowSecondaryPosDisplays({
    immersiveTablet: isTabletMode,
    handheldClient,
  });
  const homeRoute = cashierRoute(variant, searchParams);
  const paymentOrderId = searchParams.get('orderId');
  const paymentCheckoutId = searchParams.get('checkoutId');
  const loadedPaymentOrderRef = useRef<string | null>(null);
  const loadedPaymentCheckoutRef = useRef<string | null>(null);
  const lastOpenCheckoutIdRef = useRef<string | null>(null);
  const [persistedCartItemIds, setPersistedCartItemIds] = useState<string[]>([]);
  const autoPay = searchParams.get('pay') === '1';
  const autoPayAppliedRef = useRef(false);
  const fromRestaurant = searchParams.get('from') === RESTAURANT_FROM;
  const returnToRestaurantPath = restaurantPath({
    immersive: isRestaurantImmersive(searchParams),
  });
  const handoffTableId = searchParams.get('tableId');
  /**
   * Jumlah tamu (EPIC-038). Diisi pramusaji saat mendudukkan di halaman
   * Restaurant lalu dioper lewat ?pax=, dan MASIH bisa dikoreksi di sini —
   * tamu sering menyusul atau pergi antara duduk dan bayar.
   * String, bukan number: input kosong harus tetap bisa dibedakan dari 0.
   */
  const [guestCount, setGuestCount] = useState<string>(searchParams.get('pax') ?? '');
  const [showGuestModal, setShowGuestModal] = useState(false);
  /** Nilai sementara di dalam dialog — baru disimpan saat ditekan Simpan,
   *  supaya batal tidak mengubah angka yang sudah benar. */
  const [guestDraft, setGuestDraft] = useState('');
  const handoffOrderType = searchParams.get('orderType');
  const handoffKeyRef = useRef<string | null>(null);
  const pendingRestaurantReturnRef = useRef(false);
  const { products, categories, loading, error, stallBlockedReason, activeMode, allStalls } = usePosProducts();
  const canUseCentralCashier = useCanUseCentralCashier();
  const canSellMixed = canSellMixedStall({
    hasCentralMenu: canUseCentralCashier,
    canCentralCheckout: canUseCentralCashier,
    activeMode,
  });
  const { customers, findCustomer, refetch: refetchCustomers } = usePosCustomers();
  const cart = usePosCart();
  // Saklar fitur CRM → Pengaturan: sembunyikan ARK Coin / XP bila dimatikan.
  const { arkCoin: arkEnabled, xp: xpEnabled } = useLoyaltyFeatures();
  const { checkout, submitting } = usePosCheckout();
  const payOpenOrderMutation = usePayOpenOrder();
  const { data: tables = [], isLoading: loadingTables, error: tablesQueryError } = useCashierTables();
  const tableError = tablesQueryError instanceof Error ? tablesQueryError.message : null;
  const { data: paymentOrder } = useCashierOrder(paymentCheckoutId ? null : paymentOrderId);
  // Bill self-order tamu: nama pemesan dari form wajib (bukan member) → struk tidak "Walk-in".
  const orderContactName = paymentOrder?.contact_name?.trim() || undefined;
  const { data: paymentCheckout } = useCashierCheckout(paymentCheckoutId);

  useEffect(() => {
    if (paymentCheckoutId) {
      lastOpenCheckoutIdRef.current = paymentCheckoutId;
      writeLastOpenCheckoutId(paymentCheckoutId);
      return;
    }
    lastOpenCheckoutIdRef.current = null;
    writeLastOpenCheckoutId(null);
  }, [paymentCheckoutId]);

  // URL tableId from restaurant must win over stale localStorage cart table.
  const effectiveTableId =
    fromRestaurant && handoffTableId ? handoffTableId : cart.selectedTable;

  /* UI state */
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStallFilter, setSelectedStallFilter] = useState<'All' | string>('All');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [pendingNfcUid, setPendingNfcUid] = useState<string | null>(null);
  const [createMemberPromptUid, setCreateMemberPromptUid] = useState<string | null>(null);
  const [topupPrompt, setTopupPrompt] = useState<{
    uid: string;
    balance: number;
    name?: string | null;
  } | null>(null);

  const [customerSearch, setCustomerSearch] = useState('');
  const [showProductSuggestions, setShowProductSuggestions] = useState(false);
  const [activeProductSuggestion, setActiveProductSuggestion] = useState(0);
  const [showTableModal, setShowTableModal] = useState(false);

  /* Customization */
  const [custom, setCustom] = useState<SelectedCustomization | null>(null);
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(null);

  /* Payment */
  const [showPayment, setShowPayment] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [payingOrderNumber, setPayingOrderNumber] = useState<string | null>(null);
  const [cashReceived, setCashReceived] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [currentArkToUse, setCurrentArkToUse] = useState(0);

  /* NFC */
  const [showNFC, setShowNFC] = useState(false);
  const [nfcInput, setNfcInput] = useState('');
  const [nfcSearching, setNfcSearching] = useState(false);
  const [nfcError, setNfcError] = useState('');
  const posNfc = usePosNfcOptional();
  const setPaymentNfcActive = posNfc?.setPaymentNfcActive;

  useEffect(() => {
    // Cashier claims all NFC scans so they select/create members instead of redirecting to topup.
    setPaymentNfcActive?.(true);
    return () => setPaymentNfcActive?.(false);
  }, [setPaymentNfcActive]);

  /* Result */
  const [resultPayload, setResultPayload] = useState<ReceiptPayload | null>(null);
  /* Kirim struk via WA dari modal sukses (fitur WA struk). Member → nomor
   * profil dipakai otomatis; non-member → kasir mengetik nomor dulu. */
  const [waPhoneInput, setWaPhoneInput] = useState("");
  const [waPrefillFromMember, setWaPrefillFromMember] = useState(false);
  const [waSending, setWaSending] = useState(false);
  const [waSentTo, setWaSentTo] = useState<string | null>(null);
  const [waError, setWaError] = useState<string | null>(null);
  const receiptRevealTimerRef = useRef<number | null>(null);
  const receiptWaPhoneRef = useRef("");
  const storeResultPayload = useCallback((payload: ReceiptPayload) => {
    window.sessionStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(payload));
    lastOpenCheckoutIdRef.current = null;
    writeLastOpenCheckoutId(null);
    // EPIC-024: layar customer merayakan transaksi selesai + kembalian.
    // Semua jalur sukses bayar (online/offline/open-bill) lewat sini —
    // satu titik publish, display menahan layar ini beberapa detik.
    publishCfdState({
      ...idleCfdState(),
      status: 'done',
      total: payload.total,
      done_change: payload.change > 0 ? payload.change : 0,
      updated_at: Date.now(),
    });
    // Base UI Dialog tidak bisa close+open di tick yang sama — tutup payment
    // dulu, baru buka modal Print Struk setelah overlay unmount.
    setShowPayment(false);
    if (receiptRevealTimerRef.current) {
      window.clearTimeout(receiptRevealTimerRef.current);
    }
    // Snapshot sebelum cart.clearCart() — effect sync ref akan kosong
    // begitu member dilepas, jadi jangan baca ref lagi di dalam timeout.
    const phoneAtPay = receiptWaPhoneRef.current;
    receiptRevealTimerRef.current = window.setTimeout(() => {
      setResultPayload(payload);
      setWaPhoneInput(phoneAtPay);
      setWaPrefillFromMember(Boolean(phoneAtPay));
      receiptRevealTimerRef.current = null;
    }, 120);
  }, []);

  useEffect(() => {
    return () => {
      if (receiptRevealTimerRef.current) {
        window.clearTimeout(receiptRevealTimerRef.current);
      }
    };
  }, []);

  /* EPIC-024 — state pembayaran dari PaymentModal utk customer display */
  const [cfdPayment, setCfdPayment] = useState<CfdPayment | null>(null);

  /* EPIC-034 Fase B — jual gift card: produk yang sedang dijual + data
     pembeli (nomor WA dipakai mengirim kode setelah lunas). */
  const [giftCardProduct, setGiftCardProduct] = useState<Product | null>(null);
  // EPIC-039 Fase B — produk merchandise ber-varian: pilih SKU dulu
  const [merchSkuProduct, setMerchSkuProduct] = useState<Product | null>(null);
  const [giftCardBuyer, setGiftCardBuyer] = useState<{
    name: string | null;
    phone: string | null;
  } | null>(null);

  /* Offline */
  const { isOnline } = usePosOnline();
  const { pendingCount, enqueue, syncQueue, refreshCount } = usePosOfflineQueue();
  const [showOfflineQueue, setShowOfflineQueue] = useState(false);
  const [lastResultType, setLastResultType] = useState<'standard' | 'offlined' | null>(null);

  /* Split Bill */
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [savingBill, setSavingBill] = useState(false);
  const [splitOrder, setSplitOrder] = useState<any | null>(null);
  const [showSplitPayment, setShowSplitPayment] = useState(false);

  /* Shift */
  const { shift, isActive: hasShift, loading: loadingShift, openShift, closeShift } = usePosShift(CASHIER_ID);
  const [showShiftModal, setShowShiftModal] = useState(false);

  /* Billing config — resolve from session branch/stall (API falls back to cookies) */
  const billingQuery = useResolvedBillingProfile({});
  const billingCharges = billingQuery.data?.charges?.length
    ? billingQuery.data.charges
    : DEFAULT_BILLING_CHARGES;

  const canTransact = hasShift && !loadingShift;

  const requireActiveShift = useCallback(() => {
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
  }, [hasShift, loadingShift]);

  const selectedCustomer = useMemo(() => {
    if (!cart.selectedCustomerId) return null;
    return findCustomer(cart.selectedCustomerId) || null;
  }, [cart.selectedCustomerId, findCustomer]);

  useEffect(() => {
    receiptWaPhoneRef.current = String(
      selectedCustomer?.phone || giftCardBuyer?.phone || ""
    ).trim();
  }, [selectedCustomer?.phone, giftCardBuyer?.phone]);

  const { data: favorites = [], isLoading: loadingFav } = useCustomerFavoriteProducts(
    selectedCustomer?.id,
    products
  );

  const handleCreateCustomer = useCallback(async (payload: {
    name: string;
    phone: string;
    email?: string;
    enroll_member: boolean;
    nfc_uid?: string;
    is_kol?: boolean;
  }) => {
    const response = await saveCustomer({
      name: payload.name,
      phone: payload.phone,
      email: payload.email,
      membership_tier: 'regular',
      enroll_member: payload.enroll_member,
      nfc_uid: payload.nfc_uid,
      is_kol: payload.is_kol,
    });
    await refetchCustomers();
    return withCustomerDiscount(response.data);
  }, [refetchCustomers]);

  const tableById = useMemo(() => {
    return new Map(tables.map((table) => [table.id, table]));
  }, [tables]);

  const tablesByFloor = useMemo(
    () => groupCashierTablesByFloor(tables),
    [tables]
  );

  const selectedTableDisplay = useMemo(() => {
    if (!effectiveTableId) return null;
    const selected = tableById.get(effectiveTableId);
    if (selected) return getTableDisplayName(selected);
    // Jangan tampilkan UUID mentah bila daftar meja belum match.
    return "Meja";
  }, [effectiveTableId, tableById]);

  const selectedTableCapacity = useMemo(() => {
    if (!effectiveTableId) return null;
    return tableById.get(effectiveTableId)?.capacity ?? null;
  }, [effectiveTableId, tableById]);

  const guestCapacityWarning = useMemo(
    () => capacityWarning(normalizeGuestCount(guestCount), selectedTableCapacity),
    [guestCount, selectedTableCapacity]
  );

  /* Load existing open bill when redirected from Orders */
  useEffect(() => {
    if (!cart.hydrated) return;
    if (paymentCheckoutId) return;
    if (!paymentOrderId || !paymentOrder || loadedPaymentOrderRef.current === paymentOrderId) return;

    const order = paymentOrder;
    loadedPaymentOrderRef.current = paymentOrderId;
    cart.clearCart();
    cart.setOrderType((order.order_type as 'dine_in' | 'takeaway' | 'delivery' | 'self_order') || 'dine_in');

    (order.items || []).forEach((item, index) => {
      const qty = Number(item.quantity) || 1;
      const variants = Array.isArray(item.variants) ? item.variants : [];
      const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
      cart.addItem({
        id: item.id || `${item.product_id}-${index}`,
        productId: item.product_id,
        name: item.product_name,
        price: Number(item.total_amount || item.subtotal || item.unit_price || 0) / qty,
        quantity: qty,
        variantName: variants.map((v) => v?.name).filter(Boolean).join(', ') || undefined,
        modifierNames: modifiers.map((m) => m?.name).filter((name): name is string => Boolean(name)),
        station: item.station,
      });
    });

    cart.setTable(order.table_id || null);
    cart.setCustomer(order.customer_id || null);
    cart.setNotes(order.notes || '');
    setPayingOrderNumber(order.order_number || null);
    setPaymentMethod('cash');
    setCashReceived(String(Number(order.total_amount || 0)));
  }, [cart.hydrated, paymentCheckoutId, paymentOrderId, paymentOrder, cart]);

  /* Load a collapsed kasir-pusat checkout as one bill. */
  useEffect(() => {
    if (!cart.hydrated) return;
    if (!paymentCheckoutId || !paymentCheckout || loadedPaymentCheckoutRef.current === paymentCheckoutId) {
      return;
    }

    loadedPaymentCheckoutRef.current = paymentCheckoutId;
    cart.clearCart();
    cart.setOrderType(
      (paymentCheckout.order_type as 'dine_in' | 'takeaway' | 'delivery' | 'self_order') || 'dine_in'
    );

    const hydratedIds: string[] = [];
    (paymentCheckout.items || []).forEach((item, index) => {
      const qty = Number(item.quantity) || 1;
      const variants = Array.isArray(item.variants) ? item.variants : [];
      const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
      const lineId = item.id || `${item.product_id}-${index}`;
      hydratedIds.push(lineId);
      cart.addItem({
        id: lineId,
        productId: item.product_id,
        name: item.product_name,
        price: Number(item.total_amount || item.subtotal || item.unit_price || 0) / qty,
        quantity: qty,
        variantName: variants.map((v) => v?.name).filter(Boolean).join(', ') || undefined,
        modifierNames: modifiers.map((m) => m?.name).filter((name): name is string => Boolean(name)),
        station: item.station,
        warehouse_id: item.warehouse_id,
      });
    });
    setPersistedCartItemIds(hydratedIds);

    cart.setTable(paymentCheckout.table_id || null);
    cart.setCustomer(paymentCheckout.customer_id || null);
    cart.setNotes(paymentCheckout.notes || '');
    setPayingOrderNumber(paymentCheckout.order_number || paymentCheckout.checkout_number || null);
    setPaymentMethod('cash');
    setCashReceived(String(Number(paymentCheckout.total_amount || 0)));
  }, [cart.hydrated, paymentCheckoutId, paymentCheckout, cart]);

  const resetFreshCashierRef = useRef(false);
  useEffect(() => {
    if (!cart.hydrated || resetFreshCashierRef.current) return;
    if (!shouldResetCashierSession(searchParams)) return;
    resetFreshCashierRef.current = true;
    loadedPaymentCheckoutRef.current = null;
    loadedPaymentOrderRef.current = null;
    setPersistedCartItemIds([]);
    setPayingOrderNumber(null);
    cart.clearCart();
  }, [cart.hydrated, cart.clearCart, searchParams]);

  /* Auto-open payment when handed off with pay=1 (e.g. Pre Settlement from restaurant) */
  useEffect(() => {
    if (!autoPay || autoPayAppliedRef.current) return;
    if (paymentCheckoutId) {
      if (!paymentCheckout) return;
      autoPayAppliedRef.current = true;
      setShowPayment(true);
      return;
    }
    if (!paymentOrderId || !paymentOrder) return;
    autoPayAppliedRef.current = true;
    setShowPayment(true);
  }, [autoPay, paymentCheckoutId, paymentCheckout, paymentOrderId, paymentOrder]);

  /* Apply restaurant handoff after cart localStorage hydrate so URL table wins. */
  useEffect(() => {
    if (!fromRestaurant || !cart.hydrated) return;

    const handoffKey = `${handoffTableId ?? ''}|${handoffOrderType ?? ''}|${paymentOrderId ?? ''}|${paymentCheckoutId ?? ''}`;
    if (handoffKeyRef.current === handoffKey) return;
    handoffKeyRef.current = handoffKey;

    if (handoffOrderType === 'takeaway' || handoffOrderType === 'dine_in') {
      cart.setOrderType(handoffOrderType);
    }
    if (handoffTableId) {
      cart.setOrderType('dine_in');
      cart.setTable(handoffTableId);
    } else if (handoffOrderType === 'takeaway' || handoffOrderType === 'dine_in') {
      cart.setTable(null);
    }
  }, [
    fromRestaurant,
    handoffTableId,
    handoffOrderType,
    paymentOrderId,
    paymentCheckoutId,
    cart.hydrated,
    cart.setOrderType,
    cart.setTable,
  ]);

  /* Return to restaurant board after a successful pay / open-bill save */
  const maybeReturnToRestaurant = useCallback(() => {
    if (!fromRestaurant) return false;
    router.push(returnToRestaurantPath);
    return true;
  }, [fromRestaurant, returnToRestaurantPath, router]);

  const deferReturnToRestaurant = useCallback(() => {
    if (!fromRestaurant) return false;
    pendingRestaurantReturnRef.current = true;
    return true;
  }, [fromRestaurant]);

  const sendReceiptWa = useCallback(async (phoneOverride?: string) => {
    const orderId = resultPayload?.orderId;
    if (!orderId) {
      setWaError("Order offline belum tersinkron — kirim WA setelah online.");
      return;
    }
    try {
      setWaSending(true);
      setWaError(null);
      const res = await fetch(`/api/pos/orders/${orderId}/send-wa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(phoneOverride ? { phone: phoneOverride } : {}),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Gagal mengirim WA");
      setWaSentTo(json.data?.phone ?? "nomor tujuan");
      toast.success(`Struk terkirim ke ${json.data?.phone ?? "WA pelanggan"}`);
    } catch (err) {
      setWaError(err instanceof Error ? err.message : "Gagal mengirim WA");
    } finally {
      setWaSending(false);
    }
  }, [resultPayload?.orderId]);

  const closeResultModal = useCallback(() => {
    setResultPayload(null);
    setWaPhoneInput("");
    setWaPrefillFromMember(false);
    setWaSentTo(null);
    setWaError(null);
    if (pendingRestaurantReturnRef.current) {
      pendingRestaurantReturnRef.current = false;
      router.push(returnToRestaurantPath);
    }
  }, [returnToRestaurantPath, router]);

  const handleBackToRestaurant = useCallback(() => {
    if (cart.items.length > 0 && !window.confirm('Leave cashier and discard cart?')) {
      return;
    }
    router.push(returnToRestaurantPath);
  }, [cart.items.length, returnToRestaurantPath, router]);

  /* EPIC-032 C2 — kode promo kasir (preview server; final di-hold saat order) */
  const [promoApplied, setPromoApplied] = useState<{ code: string; discount: number } | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const activeOffersQuery = usePosActiveOffers(true);

  const offerEval = useMemo(() => {
    const rules = (activeOffersQuery.data ?? []).map((o) => o.eval).filter(Boolean);
    if (rules.length === 0 || cart.items.length === 0) {
      return { offer_discount: 0, applied: [] as ReturnType<typeof evaluateOfferRules>['applied'] };
    }
    return evaluateOfferRules(
      cart.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.price,
      })),
      rules
    );
  }, [activeOffersQuery.data, cart.items]);

  /* Financials — item → offer → membership → promo → manual transaksi */
  const membershipDiscount = selectedCustomer ? selectedCustomer.discount : 0;
  const discountStack = useMemo(
    () =>
      cart.buildDiscountStack(
        membershipDiscount,
        promoApplied?.discount ?? 0,
        offerEval.offer_discount
      ),
    [
      cart.items,
      cart.manual_discount_type,
      cart.manual_discount_value,
      cart.buildDiscountStack,
      membershipDiscount,
      promoApplied,
      offerEval.offer_discount,
    ]
  );
  const membershipDiscountAmount = discountStack.membership_amount;
  const promoDiscount = discountStack.promo_amount;
  const offerDiscount = discountStack.offer_amount;
  const itemDiscountTotal = discountStack.line_discount_total;
  const manualDiscountAmount = discountStack.manual_amount;
  const manualDiscountBasis = Math.max(
    0,
    discountStack.items_subtotal -
      offerDiscount -
      membershipDiscountAmount -
      promoDiscount
  );
  const discountAmount = discountStack.discount_amount;
  const afterDiscount = discountStack.after_discount;
  const billCharges = useMemo(
    () =>
      calculateBillCharges({
        subtotalAfterDiscount: afterDiscount,
        charges: billingCharges,
        enabledOptionalCodes: resolveEnabledOptionalCodes(
          billingCharges,
          cart.includeTax,
          cart.includeService
        ),
      }),
    [afterDiscount, billingCharges, cart.includeTax, cart.includeService]
  );
  const taxAmount = billCharges.tax_amount;
  const serviceChargeAmount = billCharges.service_charge_amount;
  const otherChargesAmount = billCharges.other_charges_amount;
  const total = billCharges.total;
  const taxLabel = taxToggleLabel(billingCharges);
  const serviceLabel = serviceToggleLabel(billingCharges);
  const otherChargeLines = useMemo(
    () =>
      billCharges.breakdown
        .filter((line) => line.kind !== 'tax' && line.kind !== 'service')
        .map((line) => ({
          code: line.code,
          name: line.name,
          amount: line.amount,
        })),
    [billCharges.breakdown]
  );
  const maxArkUsable = selectedCustomer ? Math.min(selectedCustomer.ark_coin_balance, total) : 0;
  const arkToUseCapped = Math.min(currentArkToUse, maxArkUsable);
  const totalAfterArk = total - arkToUseCapped;

  /* Nama stall aktif untuk header struk (permintaan owner: struk memuat
   * asal stall). Sekali fetch per mount — stall hanya berubah lewat reload. */
  const [receiptStallName, setReceiptStallName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/stall-options')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled) setReceiptStallName(json?.data?.active?.name ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /* Blok tambahan struk (redesign struk, owner 2026-08-16): Subtotal kotor,
   * rincian diskon per jenis, dan stall — di-spread ke semua ReceiptPayload. */
  const receiptExtras = useMemo(() => {
    const discountLines: Array<{ label: string; amount: number }> = [];
    if (discountStack.line_discount_total > 0) {
      discountLines.push({ label: 'Diskon Item', amount: discountStack.line_discount_total });
    }
    if (offerDiscount > 0) {
      discountLines.push({
        label:
          offerEval.applied.length === 1 ? `Promo ${offerEval.applied[0].name}` : 'Penawaran',
        amount: offerDiscount,
      });
    }
    if (membershipDiscountAmount > 0) {
      discountLines.push({
        label: `Diskon Member (${membershipDiscount}%)`,
        amount: membershipDiscountAmount,
      });
    }
    if (promoDiscount > 0) {
      discountLines.push({
        label: promoApplied?.code ? `Promo ${promoApplied.code}` : 'Promo',
        amount: promoDiscount,
      });
    }
    if (manualDiscountAmount > 0) {
      discountLines.push({
        label:
          cart.manual_discount_type === 'percent'
            ? `Diskon Manual (${cart.manual_discount_value}%)`
            : 'Diskon Manual',
        amount: manualDiscountAmount,
      });
    }
    return {
      subtotal: discountStack.gross_subtotal,
      discountLines,
      stallName: receiptStallName,
    };
  }, [
    discountStack.line_discount_total,
    discountStack.gross_subtotal,
    offerDiscount,
    offerEval.applied,
    membershipDiscountAmount,
    membershipDiscount,
    promoDiscount,
    promoApplied,
    manualDiscountAmount,
    cart.manual_discount_type,
    cart.manual_discount_value,
    receiptStallName,
  ]);

  /* Promo basi saat cart / diskon item berubah (basis = setelah line discount) */
  useEffect(() => {
    setPromoApplied(null);
    setPromoError(null);
  }, [cart.itemsSubtotal]);

  const applyPromo = useCallback(async () => {
    const code = promoInput.trim();
    if (!code || promoBusy) return;
    if (!isOnline) {
      setPromoError('Kode promo membutuhkan koneksi internet');
      return;
    }
    setPromoBusy(true);
    setPromoError(null);
    try {
      const res = await fetch('/api/pos/promo-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, subtotal: cart.itemsSubtotal }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setPromoError(body.error || 'Gagal memeriksa kode');
        return;
      }
      if (!body.data.ok) {
        setPromoError(body.data.message || 'Kode tidak berlaku');
        return;
      }
      setPromoApplied({ code: code.toUpperCase(), discount: body.data.discount });
      setPromoInput('');
    } catch {
      setPromoError('Jaringan bermasalah — coba lagi');
    } finally {
      setPromoBusy(false);
    }
  }, [promoInput, promoBusy, isOnline, cart.itemsSubtotal]);

  /* EPIC-024 — pancarkan state cart/pembayaran ke customer display
     (BroadcastChannel, satu arah). Publish adalah sinkronisasi ke sistem
     eksternal — persis guna useEffect. */
  useEffect(() => {
    if (cart.items.length === 0 && !cfdPayment) {
      publishCfdState(idleCfdState());
      return;
    }
    publishCfdState({
      status: cfdPayment ? 'payment' : 'cart',
      items: cart.items.map((item) => ({
        name: item.name,
        qty: item.quantity,
        unit_price: item.price,
        line_total: Math.round(item.price * item.quantity),
      })),
      subtotal: cart.subtotal,
      discount: discountAmount,
      tax: taxAmount,
      ark_used: arkToUseCapped,
      total,
      payment: cfdPayment,
      member_name: firstNameOnly(selectedCustomer?.name),
      updated_at: Date.now(),
    });
  }, [
    cart.items,
    cart.subtotal,
    discountAmount,
    taxAmount,
    arkToUseCapped,
    total,
    cfdPayment,
    selectedCustomer?.name,
  ]);

  const uniqueStallsFromProducts = useMemo(() => {
    const byId = new Map<string, string>();
    for (const product of products) {
      if (!product.warehouse_id || byId.has(product.warehouse_id)) continue;
      const name = product.warehouse_name?.trim();
      byId.set(product.warehouse_id, name || 'Stall');
    }
    return [...byId.entries()].map(([id, label]) => ({ id, label }));
  }, [products]);

  const stallFilters = useMemo(
    () => [{ id: 'All', label: 'Semua stall' }, ...uniqueStallsFromProducts],
    [uniqueStallsFromProducts]
  );

  const showStallFilters = canUseCentralCashier && activeMode === 'all';
  const cartStallIds = useMemo(
    () => uniqueStallIds(cart.items.map((row) => row.warehouse_id)),
    [cart.items]
  );
  const isMixedCart = shouldCreateCheckout(cartStallIds);

  /* Product filter */
  const filteredProducts = useMemo(() => products.filter((product) => {
    const okStall =
      selectedStallFilter === 'All' ||
      product.warehouse_id === selectedStallFilter;
    const okCat =
      selectedCategory === 'All' ||
      (product.category?.name || 'Uncategorized') === selectedCategory;
    const okSearch = (product.name || "").toLowerCase().includes(searchTerm.toLowerCase());
    return okStall && okCat && okSearch;
  }), [products, selectedStallFilter, selectedCategory, searchTerm]);

  const tryAddCatalogItem = useCallback((
    product: Product,
    item: Omit<Parameters<typeof cart.addItem>[0], 'warehouse_id' | 'warehouse_name'>
  ) => {
    const existing = cart.items.map((row) => row.warehouse_id);
    const check = resolveAddCatalogItem({
      canSellMixed,
      existingStallIds: existing,
      incomingWarehouseId: product.warehouse_id,
      centralAllMode: canUseCentralCashier && activeMode === 'all',
      payingExistingCheckout: Boolean(paymentCheckoutId && autoPay),
    });
    if (!check.ok) {
      toast.error(check.message);
      return false;
    }
    cart.addItem({
      ...item,
      warehouse_id: product.warehouse_id,
      warehouse_name: product.warehouse_name,
    });
    return true;
  }, [activeMode, autoPay, canSellMixed, canUseCentralCashier, cart, paymentCheckoutId]);

  const productSuggestions = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return [];

    return products
      .filter((product) => {
        const name = (product.name || "").toLowerCase();
        const sku = (product.sku || '').toLowerCase();
        return name.includes(query) || sku.includes(query);
      })
      .slice(0, 8);
  }, [products, searchTerm]);

  /* ─── Actions ──────────────────────────────────────────────────── */
  const openCustomization = useCallback((product: Product) => {
    if (!requireActiveShift()) return;

    // EPIC-034 Fase B — gift card bukan produk biasa: harganya TIDAK dari
    // katalog, kasir memilih nominal dulu di dialog khusus.
    if (product.product_kind === 'gift_card') {
      setGiftCardProduct(product);
      return;
    }

    // EPIC-039 Fase B — merchandise ber-varian wajib pilih SKU (stok per
    // varian; server menolak order tanpa sku_id utk produk ber-SKU)
    if (
      product.product_kind === 'merchandise' &&
      (product.skus ?? []).some((sku) => sku.is_active !== false)
    ) {
      setMerchSkuProduct(product);
      return;
    }

    if ((product.variants && product.variants.length > 0) || (product.modifiers && product.modifiers.length > 0)) {
      const { selectedVariant, selectedModifiers } = defaultCustomizationSelection(product);
      setCustomizingProduct(product);
      setCustom({
        product,
        selectedVariant,
        selectedModifiers,
        quantity: 1,
        notes: '',
      });
    } else {
      tryAddCatalogItem(product, {
        id: product.id,
        productId: product.id,
        name: product.name,
        price: product.base_price,
        quantity: 1,
        imageUrl: product.image_url,
        station: product.station,
        stallName: product.stall_name ?? undefined,
      });
    }
  }, [cart, requireActiveShift, tryAddCatalogItem]);

  const applyOfferToCart = useCallback(
    (offer: PosActiveOffer) => {
      if (!requireActiveShift()) return;

      const plan = planOfferQuickAdd(offer);
      if (plan.length === 0) {
        toast.error(
          offer.offer_type === "volume" && offer.volume_basis === "spend"
            ? "Promo volume belanja: pilih produk eligible lalu tambah sampai min tercapai"
            : "Promo ini belum punya produk yang bisa ditambahkan otomatis"
        );
        return;
      }

      const byId = new Map(products.map((p) => [p.id, p]));
      let added = 0;
      const skipped: string[] = [];
      const missing: string[] = [];

      for (const row of plan) {
        const product = byId.get(row.productId);
        if (!product) {
          missing.push(row.label);
          continue;
        }
        if (product.product_kind === "gift_card") {
          skipped.push(product.name);
          continue;
        }
        if (
          product.product_kind === "merchandise" &&
          (product.skus ?? []).some((sku) => sku.is_active !== false)
        ) {
          skipped.push(product.name);
          continue;
        }
        if (
          (product.variants && product.variants.length > 0) ||
          (product.modifiers && product.modifiers.length > 0)
        ) {
          skipped.push(product.name);
          continue;
        }

        if (!tryAddCatalogItem(product, {
          id: product.id,
          productId: product.id,
          name: product.name,
          price: product.base_price,
          quantity: row.qty,
          imageUrl: product.image_url,
          station: product.station,
          warehouse_id: product.warehouse_id ?? product.stall_warehouse_id ?? undefined,
          warehouse_name: product.warehouse_name ?? product.stall_name ?? null,
          stallName: product.stall_name ?? product.warehouse_name ?? undefined,
        })) {
          continue;
        }
        added += 1;
      }

      if (added > 0) {
        toast.success(`Promo “${offer.name}” ditambahkan ke keranjang`);
      }
      if (skipped.length > 0) {
        toast.message(
          `Perlu pilih varian/opsi: ${skipped.slice(0, 3).join(", ")}${
            skipped.length > 3 ? "…" : ""
          }`
        );
      }
      if (missing.length > 0) {
        toast.error(
          `Produk tidak tersedia di stall: ${missing.slice(0, 3).join(", ")}`
        );
      }
      if (added === 0 && skipped.length === 0 && missing.length === 0) {
        toast.error("Tidak ada produk yang bisa ditambahkan");
      } else if (
        added > 0 &&
        offer.offer_type === "volume" &&
        offer.volume_basis === "spend"
      ) {
        toast.message("Tambah qty sampai min belanja promo tercapai");
      }
    },
    [cart, products, requireActiveShift, tryAddCatalogItem]
  );

  /* EPIC-034 Fase B — nominal gift card dikonfirmasi → masuk keranjang.
     Harga baris = nominal yang dipilih; server memvalidasi ulang. */
  const handleConfirmGiftCardSale = useCallback((values: GiftCardSaleValues) => {
    const product = giftCardProduct;
    if (!product) return;
    if (!tryAddCatalogItem(product, {
      // id unik per nominal supaya dua nominal berbeda tidak digabung jadi
      // satu baris keranjang (kartu berbeda, saldo berbeda)
      id: `${product.id}-${values.nominal}`,
      productId: product.id,
      name: `${product.name} ${formatCurrency(values.nominal)}`,
      price: values.nominal,
      quantity: values.quantity,
      imageUrl: product.image_url,
      station: product.station,
      warehouse_id: product.warehouse_id ?? product.stall_warehouse_id ?? undefined,
      warehouse_name: product.warehouse_name ?? product.stall_name ?? null,
      stallName: product.stall_name ?? product.warehouse_name ?? undefined,
    })) {
      return;
    }
    setGiftCardBuyer(
      values.buyerName || values.buyerPhone
        ? { name: values.buyerName, phone: values.buyerPhone }
        : null
    );
    setGiftCardProduct(null);
  }, [cart, giftCardProduct, tryAddCatalogItem]);

  const selectProductFromSearch = useCallback((product: Product) => {
    openCustomization(product);
    setSearchTerm('');
    setShowProductSuggestions(false);
    setActiveProductSuggestion(0);
  }, [openCustomization]);

  /* EPIC-039 Fase B — varian dipilih → masuk keranjang (id komposit per SKU
     supaya dua varian berbeda tidak digabung; harga = override ?? produk) */
  const handleSelectMerchSku = useCallback((product: Product, sku: ProductSku) => {
    if (!requireActiveShift()) return;
    if (!tryAddCatalogItem(product, {
      id: `${product.id}::sku:${sku.id}`,
      productId: product.id,
      skuId: sku.id,
      skuCode: sku.sku,
      name: `${product.name} — ${sku.name}`,
      price: sku.price_override ?? product.base_price,
      quantity: 1,
      imageUrl: product.image_url,
      station: product.station,
      warehouse_id: product.warehouse_id ?? product.stall_warehouse_id ?? undefined,
      warehouse_name: product.warehouse_name ?? product.stall_name ?? null,
      stallName: product.stall_name ?? product.warehouse_name ?? undefined,
    })) {
      return;
    }
    setMerchSkuProduct(null);
  }, [cart, requireActiveShift, tryAddCatalogItem]);

  /* EPIC-039 Fase B — scan barcode: input search yang persis cocok dengan
     barcode/kode SKU varian langsung menambahkan varian itu ke keranjang
     (scanner mengetik kode utuh; tidak mengganggu pencarian nama biasa) */
  useEffect(() => {
    const code = searchTerm.trim().toLowerCase();
    if (!code || code.length < 4) return;
    for (const product of products) {
      const sku = (product.skus ?? []).find(
        (candidate) =>
          candidate.is_active !== false &&
          ((candidate.barcode || '').toLowerCase() === code ||
            (candidate.sku || "").toLowerCase() === code)
      );
      if (sku) {
        handleSelectMerchSku(product, sku);
        setSearchTerm('');
        setShowProductSuggestions(false);
        return;
      }
    }
  }, [searchTerm, products, handleSelectMerchSku]);

  const handleConfirmCustomization = useCallback(() => {
    if (!custom || !customizingProduct) return;
    if (!requireActiveShift()) return;
    const product = customizingProduct;
    const { variantName, variantAdj, modifierNames, modifierAdj, unitPrice: finalPrice } =
      computeCustomizationPrice(product, custom);
    const compositeId = `${product.id}::${variantName ?? ''}::${modifierNames.join(',')}`;
    if (!tryAddCatalogItem(product, {
      id: compositeId,
      productId: product.id,
      name: product.name,
      price: finalPrice,
      quantity: custom.quantity,
      variantName,
      modifierNames,
      variantPriceAdj: variantAdj,
      modifierPriceAdj: modifierAdj,
      notes: custom.notes,
      imageUrl: product.image_url,
      station: product.station,
      warehouse_id: product.warehouse_id ?? product.stall_warehouse_id ?? undefined,
      warehouse_name: product.warehouse_name ?? product.stall_name ?? null,
      stallName: product.stall_name ?? product.warehouse_name ?? undefined,
    })) {
      return;
    }
    setCustom(null);
    setCustomizingProduct(null);
  }, [custom, customizingProduct, cart, requireActiveShift, tryAddCatalogItem]);

  const openPaymentModal = useCallback(() => {
    if (cart.items.length === 0) return;
    if (!requireActiveShift()) return;
    const unsaved = newCartItemsForOpenBillAppend({
      items: cart.items,
      persistedItemIds: persistedCartItemIds,
    });
    if (paymentCheckoutId && unsaved.length > 0) {
      toast.message('Order dulu item baru, baru bayar tagihan');
      return;
    }
    setShowPayment(true);
  }, [cart.items, paymentCheckoutId, persistedCartItemIds, requireActiveShift]);

  const processNFCCard = useCallback((cardData: string) => {
    const trimmed = cardData.trim();
    if (!trimmed) return;
    setNfcSearching(true);
    setNfcError('');

    const found = findCustomerByCard(customers, trimmed);
    const enforceArkBalance = showPayment || showNFC;
    const action = resolveCashierNfcAction({
      memberFound: Boolean(found),
      balance: Number(found?.ark_coin_balance || 0),
      totalDue: total,
      enforceArkBalance,
    });

    setNfcSearching(false);
    setNfcInput('');

    if (action === 'create') {
      setShowNFC(false);
      setCreateMemberPromptUid(trimmed.toUpperCase());
      return;
    }

    if (action === 'topup' && found && arkEnabled) {
      setShowNFC(false);
      setTopupPrompt({
        uid: (found.nfc_uid || trimmed).toUpperCase(),
        balance: Number(found.ark_coin_balance || 0),
        name: found.name,
      });
      cart.setCustomer(found.id);
      return;
    }

    if (found) {
      cart.setCustomer(found.id);
      setShowNFC(false);
      toast.success(`Member ${found.name || found.phone} selected`);
    }
  }, [customers, total, cart, showPayment, showNFC, arkEnabled]);

  useEffect(() => {
    function onBridgeCard(event: Event) {
      const card = (event as CustomEvent<{ card?: string }>).detail?.card;
      if (!card) return;
      processNFCCard(card);
    }

    window.addEventListener(POS_NFC_CARD_EVENT, onBridgeCard);
    return () => window.removeEventListener(POS_NFC_CARD_EVENT, onBridgeCard);
  }, [processNFCCard]);

  /* Checkout */
  const handleCreateOrder = useCallback(async (overrides?: {
    method?: PaymentMethod;
    nfcTabUid?: string;
    giftCardCode?: string;
    cashReceived?: string;
    arkToUse?: number;
    checkoutId?: string;
    checkoutNumber?: string;
    queueNumber?: string | null;
    /** Bug #5 fix (insiden 2026-08-25) — order disiapkan onPrepareOrderQris. */
    orderId?: string;
    orderNumber?: string;
    xenditQrId?: string;
    xenditExternalId?: string;
    paymentMethodCode?: string;
    paymentMethodName?: string;
    supervisorPin?: string;
  }) => {
    if (processingPayment) return;
    // Bug #5 fix (insiden 2026-08-25): order QRIS jual instan yang sudah
    // disiapkan (unpaid) TIDAK boleh dijegal oleh guard "cart kosong" —
    // cart di layar bisa saja sudah dikosongkan di render lain sementara
    // order 'unpaid'-nya masih menunggu settle. Guard cart-kosong hanya
    // relevan utk jalur create-baru (bukan settle order yang sudah ada).
    if (cart.items.length === 0 && !overrides?.orderId && !paymentOrderId) return;
    if (!requireActiveShift()) return;

    const method = overrides?.method ?? paymentMethod;
    const catalogCode = overrides?.paymentMethodCode;
    const catalogName = overrides?.paymentMethodName;
    // Metode FOC (Free of Charge) — wajib PIN supervisor, diverifikasi server.
    const focSelected = isFocPaymentMethod(catalogCode, catalogName);
    const focPin = overrides?.supervisorPin?.trim() || '';
    if (focSelected && !selectedCustomer) {
      toast.error('Metode FOC membutuhkan customer/member — pilih customer dulu');
      return;
    }
    if (focSelected && !focPin) {
      toast.error('Metode FOC membutuhkan PIN supervisor');
      return;
    }
    if (focSelected && !isOnline) {
      toast.error('Metode FOC membutuhkan koneksi — PIN supervisor diverifikasi server');
      return;
    }
    const focFields = focSelected ? { supervisor_pin: focPin } : {};
    const receiptMethod = formatPaymentMethodLabel(method, {
      code: catalogCode,
      name: catalogName,
    });
    const catalogFields = {
      payment_method_code: catalogCode,
      payment_method_name: catalogName,
    };
    const mixedCart = shouldCreateCheckout(
      uniqueStallIds(cart.items.map((row) => row.warehouse_id))
    );
    if (mixedCart && isMixedUnsupportedTender(method)) {
      toast.error(MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE);
      return;
    }
    // Diskon transaksi (mis. diskon manual) lolos: server membaginya pro-rata
    // per stall. Promo & diskon per item masih ditolak — lihat central-cashier.
    if (mixedCart && promoApplied) {
      toast.error(MIXED_PROMO_UNSUPPORTED_MESSAGE);
      return;
    }
    if (mixedCart && itemDiscountTotal > 0) {
      toast.error(MIXED_LINE_DISCOUNT_UNSUPPORTED_MESSAGE);
      return;
    }
    if (paymentCheckoutId && isCheckoutBillUnsupportedTender(method)) {
      toast.error(
        method === 'ark_coin'
          ? MIXED_ARK_UNSUPPORTED_MESSAGE
          : MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE
      );
      return;
    }
    if (mixedCart && !isOnline && !overrides?.checkoutId) {
      toast.error('Checkout multi-stall membutuhkan koneksi');
      return;
    }

    if (mixedCart && method === 'qris') {
      const paidCheckoutId = overrides?.checkoutId;
      if (
        !paidCheckoutId ||
        !mayConfirmMixedQris({
          isMixedCart: true,
          method: 'qris',
          qrisPaid: true,
          checkoutId: paidCheckoutId,
        })
      ) {
        toast.error('Menunggu pembayaran QRIS');
        return;
      }
      setProcessingPayment(true);
      try {
        await completeCheckout(paidCheckoutId, {
          payment_method: 'qris',
          amount_paid: total,
          ...catalogFields,
        });
        const receipt: ReceiptPayload = {
          orderId: paidCheckoutId,
          orderNumber: overrides.checkoutNumber,
          checkoutNumber: overrides.checkoutNumber,
          queueNumber: overrides.queueNumber ?? null,
          orderType: cart.orderType,
          table: selectedTableDisplay,
          items: [...cart.items],
          notes: cart.notes,
          total,
          change: 0,
          paymentMethod: receiptMethod,
          customerName: selectedCustomer?.name ?? orderContactName,
          discountAmount,
          taxAmount,
          chargesBreakdown: billCharges.breakdown,
        };
        storeResultPayload(receipt);
        toast.success(
          overrides.queueNumber
            ? `Pembayaran berhasil — Antrian ${overrides.queueNumber}`
            : 'Pembayaran berhasil'
        );
        setShowPayment(false);
        setLastResultType('standard');
        cart.clearCart();
        setCashReceived('');
        setPaymentMethod('cash');
        setCurrentArkToUse(0);
        deferReturnToRestaurant();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Pembayaran QRIS gagal');
      } finally {
        setProcessingPayment(false);
      }
      return;
    }

    const cashValue = overrides?.cashReceived ?? cashReceived;
    const arkValue = overrides?.arkToUse ?? currentArkToUse;
    const arkCapped = Math.min(arkValue, maxArkUsable);
    const payTotal = total - (method === 'ark_coin' ? arkCapped : arkToUseCapped);

    // EPIC-034 Fase C — bayar dgn saldo gift card. Kode dioper eksplisit dari
    // PaymentModal (state paymentMethod belum ter-flush di tick yang sama),
    // alasan yang sama dgn NFC Tab di bawah. Debit-nya server-authoritative:
    // saldo kurang / kartu mati ditolak di sana, bukan di klien.
    if (overrides?.method === 'gift_card') {
      const giftCardCode = overrides.giftCardCode?.trim().toUpperCase() || '';
      if (!giftCardCode) { toast.error('Masukkan kode gift card dulu'); return; }
      if (!isOnline) {
        toast.error('Pembayaran gift card membutuhkan koneksi — gunakan metode lain saat offline');
        return;
      }

      setProcessingPayment(true);
      try {
        let orderId: string;
        let orderNumber: string;
        let queueNumber: string | null = null;
        const cTotal = total;

        if (paymentCheckoutId) {
          toast.error(MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE);
          setProcessingPayment(false);
          return;
        } else if (paymentOrderId) {
          const data = await payOpenOrderMutation.mutateAsync({
            orderId: paymentOrderId,
            payload: {
              payment_status: 'paid',
              payment_method: 'gift_card',
              amount_paid: 0,
              ark_coins_used: 0,
              gift_card_code: giftCardCode,
              ...catalogFields,
            },
          });
          orderId = paymentOrderId;
          orderNumber = payingOrderNumber || data.data?.order_number || paymentOrderId;
          queueNumber = data.data?.queue_number || null;
        } else {
          const res = await checkout({
            cart: cart.items,
            orderType: cart.orderType,
            selectedTable: effectiveTableId,
            selectedCustomer,
            paymentMethod: 'gift_card',
            cashReceived: '',
            includeTax: cart.includeTax,
            notes: cart.notes,
            arkToUse: 0,
            shiftId: shift?.id || null,
            giftCardCode,
            paymentMethodCode: catalogCode,
            paymentMethodName: catalogName,
            promo: promoApplied,
            billCharges,
            manualDiscountType: cart.manual_discount_type,
            manualDiscountValue: cart.manual_discount_value,
            offerDiscount,
            offerLabels: offerEval.applied.map((a) => a.name),
          });
          if (!res.success) {
            toast.error(res.error || 'Pembayaran gift card gagal');
            setProcessingPayment(false);
            return;
          }
          orderId = res.orderId || '';
          orderNumber = res.orderNumber || '';
          queueNumber = res.queueNumber || null;
        }

        const receipt: ReceiptPayload = {
          orderId,
          orderNumber,
          queueNumber,
          orderType: cart.orderType,
          table: selectedTableDisplay,
          items: [...cart.items],
          notes: cart.notes,
          total: cTotal,
          change: 0,
          paymentMethod: receiptMethod,
          customerName: selectedCustomer?.name ?? orderContactName,
          discountAmount,
          taxAmount,
          chargesBreakdown: billCharges.breakdown,
          ...receiptExtras,
        };
        storeResultPayload(receipt);
        setShowPayment(false);
        setLastResultType('standard');
        cart.clearCart();
        setCashReceived('');
        setPaymentMethod('cash');
        setCurrentArkToUse(0);
        loadedPaymentOrderRef.current = null;
        if (paymentOrderId && !deferReturnToRestaurant()) {
          router.replace(homeRoute);
        } else if (!paymentOrderId) {
          deferReturnToRestaurant();
        }
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Pembayaran gift card gagal');
      } finally {
        setProcessingPayment(false);
      }
      return;
    }

    // NFC Tab (EPIC-023 Fase C): nilai dioper eksplisit dari PaymentModal —
    // state paymentMethod belum ter-flush di tick yang sama (stale closure).
    if (overrides?.method === 'nfc_tab') {
      const nfcTabUid = overrides.nfcTabUid?.trim() || '';
      if (!nfcTabUid) { toast.error('Tap gelang pengunjung dulu'); return; }
      if (!isOnline) {
        toast.error('Pembayaran NFC Tab membutuhkan koneksi — gunakan metode lain saat offline');
        return;
      }

      setProcessingPayment(true);
      try {
        let orderId: string;
        let orderNumber: string;
        let queueNumber: string | null = null;
        const cTotal = total;

        if (paymentCheckoutId) {
          toast.error(MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE);
          setProcessingPayment(false);
          return;
        } else if (paymentOrderId) {
          const data = await payOpenOrderMutation.mutateAsync({
            orderId: paymentOrderId,
            payload: {
              payment_status: 'paid',
              payment_method: 'nfc_tab',
              amount_paid: 0,
              ark_coins_used: 0,
              nfc_tab_uid: nfcTabUid,
              ...catalogFields,
            },
          });
          orderId = paymentOrderId;
          orderNumber = payingOrderNumber || data.data?.order_number || paymentOrderId;
          queueNumber = data.data?.queue_number || null;
        } else {
          const res = await checkout({
            cart: cart.items,
            orderType: cart.orderType,
            selectedTable: effectiveTableId,
            selectedCustomer,
            paymentMethod: 'nfc_tab',
            cashReceived: '',
            includeTax: cart.includeTax,
            notes: cart.notes,
            arkToUse: 0,
            shiftId: shift?.id || null,
            nfcTabUid,
            paymentMethodCode: catalogCode,
            paymentMethodName: catalogName,
            promo: promoApplied,
            billCharges,
            manualDiscountType: cart.manual_discount_type,
            manualDiscountValue: cart.manual_discount_value,
            offerDiscount,
            offerLabels: offerEval.applied.map((a) => a.name),
          });
          if (!res.success) {
            toast.error(res.error || 'Charge ke tab gagal');
            setProcessingPayment(false);
            return;
          }
          orderId = res.orderId || '';
          orderNumber = res.orderNumber || '';
          queueNumber = res.queueNumber || null;
        }

        const receipt: ReceiptPayload = {
          orderId,
          orderNumber,
          queueNumber,
          orderType: cart.orderType,
          table: selectedTableDisplay,
          items: [...cart.items],
          notes: cart.notes,
          total: cTotal,
          change: 0,
          paymentMethod: receiptMethod,
          customerName: selectedCustomer?.name ?? orderContactName,
          discountAmount,
          taxAmount,
          chargesBreakdown: billCharges.breakdown,
          ...receiptExtras,
        };
        storeResultPayload(receipt);
        setShowPayment(false);
        setLastResultType('standard');
        cart.clearCart();
        setCashReceived('');
        setPaymentMethod('cash');
        setCurrentArkToUse(0);
        loadedPaymentOrderRef.current = null;
        if (paymentOrderId && !deferReturnToRestaurant()) {
          router.replace(homeRoute);
        } else if (!paymentOrderId) {
          deferReturnToRestaurant();
        }
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Charge ke tab gagal');
      } finally {
        setProcessingPayment(false);
      }
      return;
    }

    if (method === 'ark_coin' && !selectedCustomer) { setShowNFC(true); return; }
    // FOC: tidak ada uang diterima — lewati validasi nominal tunai.
    if (method === 'cash' && !focSelected && (parseFloat(cashValue) || 0) < payTotal) {
      toast.error('Nominal tunai kurang dari total tagihan');
      return;
    }

    setProcessingPayment(true);

    if (paymentCheckoutId) {
      if (promoApplied) {
        toast.error('Kode promo belum didukung untuk pembayaran open bill — hapus kode dulu');
        setProcessingPayment(false);
        return;
      }
      try {
        if (method === 'ark_coin') {
          toast.error(MIXED_ARK_UNSUPPORTED_MESSAGE);
          setProcessingPayment(false);
          return;
        }
        const tender = buildCheckoutBillPayBody({
          method,
          cashReceived: cashValue,
          total: payTotal,
          paymentMethodCode: catalogCode,
          paymentMethodName: catalogName,
        });
        const completeRes = await completeCheckout(paymentCheckoutId, {
          ...tender,
          ...focFields,
        });
        const focApprovedName =
          (completeRes.data as { comp_approved_name?: string | null } | undefined)
            ?.comp_approved_name ?? null;
        const receipt: ReceiptPayload = {
          orderId: paymentCheckoutId,
          orderNumber: payingOrderNumber || paymentCheckoutId,
          checkoutNumber: paymentCheckout?.checkout_number || payingOrderNumber,
          queueNumber: null,
          orderType: cart.orderType,
          table: selectedTableDisplay,
          items: [...cart.items],
          notes: cart.notes,
          total: payTotal,
          change: method === 'cash' ? (parseFloat(cashValue) || 0) - payTotal : 0,
          paymentMethod: receiptMethod,
          customerName: selectedCustomer?.name ?? orderContactName,
          discountAmount,
          taxAmount,
          // FOC = komplimen: struk menampilkan diskon 100% + total 0 + label
          // penyetuju (server sudah menggratiskan checkout & anak-ordernya).
          ...(focSelected
            ? {
                total: 0,
                change: 0,
                discountAmount: payTotal,
                compType: 'foc_comp',
                compApprovedName: focApprovedName,
              }
            : {}),
        };
        storeResultPayload(receipt);
        if (selectedCustomer) void refetchCustomers();
        setShowPayment(false);
        setLastResultType('standard');
        cart.clearCart();
        setCashReceived('');
        setPaymentMethod('cash');
        setCurrentArkToUse(0);
        loadedPaymentOrderRef.current = null;
        loadedPaymentCheckoutRef.current = null;
        if (!deferReturnToRestaurant()) {
          router.replace(homeRoute);
        }
        setProcessingPayment(false);
        return;
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Payment failed');
        setProcessingPayment(false);
        return;
      }
    }

    const targetOrderId = paymentOrderId || overrides?.orderId || null;
    if (targetOrderId) {
      if (promoApplied) {
        toast.error('Kode promo belum didukung untuk pembayaran open bill — hapus kode dulu');
        setProcessingPayment(false);
        return;
      }
      const paymentMethodForApi = method === 'credit_card' ? 'credit' : method;
      const paidAmount = method === 'cash' ? (parseFloat(cashValue) || payTotal) : payTotal;
      try {
        const data = await payOpenOrderMutation.mutateAsync({
          orderId: targetOrderId,
          payload: {
            payment_status: 'paid',
            payment_method: paymentMethodForApi,
            amount_paid: paidAmount,
            ark_coins_used: method === 'ark_coin' ? arkCapped : 0,
            xendit_qr_id: overrides?.xenditQrId,
            xendit_external_id: overrides?.xenditExternalId,
            ...catalogFields,
            ...focFields,
          },
        });

        const receipt: ReceiptPayload = {
          orderId: targetOrderId,
          orderNumber: payingOrderNumber || overrides?.orderNumber || data.data?.order_number || targetOrderId,
          queueNumber: data.data?.queue_number || null,
          orderType: cart.orderType,
          table: selectedTableDisplay,
          items: [...cart.items],
          notes: cart.notes,
          total: payTotal,
          change: method === 'cash' ? (parseFloat(cashValue) || 0) - payTotal : 0,
          paymentMethod: receiptMethod,
          customerName: selectedCustomer?.name ?? orderContactName,
          discountAmount,
          taxAmount,
          // EPIC-041: snapshot ARK/XP dari respons pembayaran utk struk
          arkPaid: method === 'ark_coin' ? arkCapped : 0,
          arkBalanceAfter: data.ark_balance_after ?? null,
          // XP nonaktif (CRM → Pengaturan): blok XP tidak dicetak di struk.
          xpEarned: xpEnabled ? data.crm_xp?.xpAwarded : undefined,
          xpTotalAfter: xpEnabled ? (data.xp_total_after ?? null) : null,
          ...receiptExtras,
          // FOC = komplimen: total 0, diskon 100%, label penyetuju di struk.
          ...(focSelected
            ? {
                total: 0,
                change: 0,
                discountAmount: payTotal,
                compType: 'foc_comp',
                compApprovedName:
                  (data.data as { comp_approved_name?: string | null } | undefined)
                    ?.comp_approved_name ?? null,
              }
            : {}),
        };
        storeResultPayload(receipt);
        // Saldo ARK/XP customer berubah di server — segarkan cache kasir
        if (selectedCustomer) void refetchCustomers();
        setShowPayment(false);
        setLastResultType('standard');
        cart.clearCart();
        setCashReceived('');
        setPaymentMethod('cash');
        setCurrentArkToUse(0);
        loadedPaymentOrderRef.current = null;
        if (!deferReturnToRestaurant()) {
          router.replace(homeRoute);
        }
        setProcessingPayment(false);
        return;
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Payment failed');
        setProcessingPayment(false);
        return;
      }
    }

    if (!isOnline) {
      if (promoApplied) {
        toast.error('Kode promo membutuhkan koneksi — hapus kode atau tunggu online');
        setProcessingPayment(false);
        return;
      }
      const cSubtotal = cart.subtotal;
      const cTotal = total;
      const payload = {
        order_type: cart.orderType,
        customer_id: selectedCustomer?.id,
        cashier_id: CASHIER_ID,
        table_id: effectiveTableId || undefined,
        guest_count: normalizeGuestCount(guestCount),
        items: cart.items.map(item => ({
          product_id: item.productId,
          sku_id: item.skuId,
          product_name: item.name,
          product_sku: item.skuCode || item.productId,
          quantity: item.quantity,
          unit_price: item.price,
          subtotal: item.price * item.quantity,
          total_amount: item.price * item.quantity,
        })),
        subtotal: cSubtotal,
        discount_amount: discountAmount,
        tax_amount: taxAmount,
        service_charge_amount: serviceChargeAmount,
        other_charges_amount: otherChargesAmount,
        charges_breakdown: billCharges.breakdown,
        total_amount: cTotal,
        payment_method: method === 'qris' ? 'qris' : method === 'credit_card' ? 'credit' : method === 'ark_coin' ? 'ark_coin' : 'cash',
        amount_paid: method === 'cash' ? (parseFloat(cashValue) || cTotal) : cTotal,
        ...catalogFields,
        include_tax: cart.includeTax,
        membership_discount_pct: membershipDiscount,
        notes: cart.notes,
        ark_coins_used: method === 'ark_coin' ? arkCapped : 0,
        shift_id: shift?.id || undefined,
      };
      await enqueue(payload, 'order');
      const receipt: ReceiptPayload = {
        orderId: 'OFFLINE-' + Date.now().toString(36).toUpperCase(),
        orderNumber: 'OFFLINE-' + Date.now().toString(36).toUpperCase(),
        orderType: cart.orderType,
        table: selectedTableDisplay,
        items: [...cart.items],
        notes: cart.notes,
        total: cTotal,
        change: method === 'cash' ? (parseFloat(cashValue) || 0) - cTotal : 0,
        paymentMethod: receiptMethod,
        customerName: selectedCustomer?.name ?? orderContactName,
        discountAmount,
        taxAmount,
        chargesBreakdown: billCharges.breakdown,
        // Offline: tanpa respons server, saldo/XP tidak diketahui — hanya
        // nominal ARK yang dipakai; baris "Sisa saldo" sengaja dilewati.
        arkPaid: method === 'ark_coin' ? arkCapped : 0,
        ...receiptExtras,
      };
      storeResultPayload(receipt);
      setShowPayment(false);
      setLastResultType('offlined');
      cart.clearCart();
      setCashReceived('');
      setPaymentMethod('cash');
      setCurrentArkToUse(0);
      await refreshCount();
      deferReturnToRestaurant();
      setProcessingPayment(false);
      return;
    }

    const res = await checkout({
      cart: cart.items,
      orderType: cart.orderType,
      selectedTable: effectiveTableId,
      selectedCustomer,
      paymentMethod: method,
      cashReceived: cashValue,
      includeTax: cart.includeTax,
      notes: cart.notes,
      arkToUse: method === 'ark_coin' ? arkCapped : 0,
      shiftId: shift?.id || null,
      giftCardBuyer,
      promo: promoApplied,
      billCharges,
      manualDiscountType: cart.manual_discount_type,
      manualDiscountValue: cart.manual_discount_value,
      offerDiscount,
      offerLabels: offerEval.applied.map((a) => a.name),
      xenditQrId: overrides?.xenditQrId,
      xenditExternalId: overrides?.xenditExternalId,
      paymentMethodCode: catalogCode,
      paymentMethodName: catalogName,
      supervisorPin: focSelected ? focPin : undefined,
    });

    if (res.success) {
      // EPIC-034 Fase B — order lunas tapi kartu gagal terbit: uang sudah
      // diterima, jadi jangan diam — kasir wajib melihat peringatannya.
      if (res.giftCardError) {
        toast.error(res.giftCardError, { duration: 15000 });
      }
      const receipt: ReceiptPayload = {
        orderId: res.orderId,
        orderNumber: res.orderNumber,
        checkoutNumber: res.checkoutNumber,
        queueNumber: res.queueNumber || null,
        orderType: cart.orderType,
        table: selectedTableDisplay,
        items: [...cart.items],
        notes: cart.notes,
        total: res.total,
        change: res.change,
        paymentMethod: receiptMethod,
        customerName: selectedCustomer?.name ?? orderContactName,
        discountAmount,
        taxAmount,
        chargesBreakdown: billCharges.breakdown,
        giftCards: res.giftCards,
        // EPIC-041 task 1-2 — blok ARK & XP di struk, dari snapshot respons
        // pembayaran (bukan fetch susulan yang bisa balapan).
        arkPaid: method === 'ark_coin' ? arkCapped : 0,
        arkBalanceAfter: res.arkBalanceAfter ?? null,
        xpEarned: xpEnabled ? res.xpEarned : undefined,
        xpTotalAfter: xpEnabled ? (res.xpTotalAfter ?? null) : null,
        ...receiptExtras,
        // FOC = komplimen: total 0, diskon 100%, label penyetuju di struk.
        ...(focSelected
          ? {
              total: 0,
              change: 0,
              discountAmount: res.total,
              compType: 'foc_comp',
              compApprovedName: res.compApprovedName ?? null,
            }
          : {}),
      };
      storeResultPayload(receipt);
      toast.success(
        res.queueNumber
          ? `Pembayaran berhasil — Antrian ${res.queueNumber}`
          : 'Pembayaran berhasil'
      );
      setGiftCardBuyer(null);
      // Saldo ARK/XP customer berubah di server — segarkan cache kasir
      if (selectedCustomer) void refetchCustomers();
      setShowPayment(false);
      setLastResultType('standard');
      cart.clearCart();
      setCashReceived('');
      setPaymentMethod('cash');
      setCurrentArkToUse(0);
      deferReturnToRestaurant();
    } else {
      toast.error(res.error || 'Payment failed');
    }
    setProcessingPayment(false);
  }, [cart, paymentMethod, selectedCustomer, cashReceived, currentArkToUse, maxArkUsable, totalAfterArk, arkToUseCapped, checkout, discountAmount, taxAmount, isOnline, enqueue, membershipDiscount, shift, refreshCount, paymentOrderId, paymentCheckoutId, paymentCheckout, payingOrderNumber, router, processingPayment, selectedTableDisplay, effectiveTableId, requireActiveShift, payOpenOrderMutation, deferReturnToRestaurant, storeResultPayload, refetchCustomers, promoApplied, giftCardBuyer, billCharges, serviceChargeAmount, otherChargesAmount, total, homeRoute, guestCount, offerDiscount, offerEval, xpEnabled]);

  /* Split Bill */
  const handleConfirmSplit = useCallback(async (config: SplitConfig) => {
    if (cart.items.length === 0) return;
    if (shouldDisableSplitBill(uniqueStallIds(cart.items.map((row) => row.warehouse_id)))) {
      toast.error(MIXED_SPLIT_UNSUPPORTED_MESSAGE);
      return;
    }
    // EPIC-032 C2 — promo belum didukung split bill: totals split tidak
    // melewati validasi promo server, jangan biarkan diskon promo bocor
    if (promoApplied) {
      toast.error('Kode promo belum didukung untuk split bill — hapus kode dulu');
      return;
    }
    if (!requireActiveShift()) return;
    setShowSplitModal(false);

    if (!isOnline) {
      const payload = {
        order_type: cart.orderType,
        customer_id: selectedCustomer?.id,
        cashier_id: CASHIER_ID,
        server_id: undefined,
        table_id: effectiveTableId || undefined,
        guest_count: normalizeGuestCount(guestCount),
        shift_id: shift?.id,
        items: cart.items.map(item => ({
          product_id: item.productId,
          sku_id: item.skuId,
          product_name: item.name,
          product_sku: item.skuCode || item.productId,
          quantity: item.quantity,
          unit_price: item.price,
          subtotal: item.price * item.quantity,
          total_amount: item.price * item.quantity,
        })),
        subtotal: cart.subtotal,
        discount_amount: discountAmount,
        tax_amount: taxAmount,
        service_charge_amount: serviceChargeAmount,
        other_charges_amount: otherChargesAmount,
        charges_breakdown: billCharges.breakdown,
        total_amount: total,
        notes: cart.notes,
        include_tax: cart.includeTax,
        membership_discount_pct: membershipDiscount,
        splits: config.splits.map(s => ({
          label: s.label,
          subtotal: s.subtotal || 0,
          tax_amount: s.tax_amount || 0,
          discount_amount: s.discount_amount || 0,
          total_amount: s.total,
          customer_id: s.customerId,
          items: s.items,
        })),
      };
      await enqueue(payload, 'split');
      const receipt: ReceiptPayload = {
        orderId: 'OFFLINE-SPLIT-' + Date.now().toString(36).toUpperCase(),
        orderNumber: 'OFFLINE-SPLIT-' + Date.now().toString(36).toUpperCase(),
        orderType: cart.orderType,
        table: selectedTableDisplay,
        items: [...cart.items],
        notes: cart.notes,
        total,
        change: 0,
        paymentMethod,
        customerName: selectedCustomer?.name ?? orderContactName,
        discountAmount,
        taxAmount,
        chargesBreakdown: billCharges.breakdown,
        ...receiptExtras,
      };
      storeResultPayload(receipt);
      setLastResultType('offlined');
      cart.clearCart();
      await refreshCount();
      return;
    }

    try {
      const res = await createSplitOrder({
        order_type: cart.orderType,
        customer_id: selectedCustomer?.id,
        cashier_id: CASHIER_ID,
        server_id: undefined,
        table_id: effectiveTableId || undefined,
        guest_count: normalizeGuestCount(guestCount),
        shift_id: shift?.id,
        items: cart.items.map(item => ({
          product_id: item.productId,
          sku_id: item.skuId,
          product_name: item.name,
          product_sku: item.skuCode || item.productId,
          quantity: item.quantity,
          unit_price: item.price,
          subtotal: item.price * item.quantity,
          total_amount: item.price * item.quantity,
        })),
        subtotal: cart.subtotal,
        discount_amount: discountAmount,
        tax_amount: taxAmount,
        service_charge_amount: serviceChargeAmount,
        other_charges_amount: otherChargesAmount,
        charges_breakdown: billCharges.breakdown,
        total_amount: total,
        notes: cart.notes,
        include_tax: cart.includeTax,
        membership_discount_pct: membershipDiscount,
        splits: config.splits.map(s => ({
          label: s.label,
          subtotal: s.subtotal || 0,
          tax_amount: s.tax_amount || 0,
          discount_amount: s.discount_amount || 0,
          total_amount: s.total,
          customer_id: s.customerId,
          items: s.items,
        })),
      });

      if (res.success && res.data) {
        setSplitOrder(res.data);
        setShowSplitPayment(true);
        cart.clearCart();
      } else {
        toast.error(res.error || 'Failed to create split order');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to create split order');
    }
  }, [cart, selectedCustomer, discountAmount, taxAmount, total, membershipDiscount, isOnline, enqueue, paymentMethod, shift, refreshCount, selectedTableDisplay, effectiveTableId, requireActiveShift, storeResultPayload, promoApplied, serviceChargeAmount, otherChargesAmount, billCharges, guestCount, receiptExtras]);

  const handleSplitComplete = useCallback(() => {
    setShowSplitPayment(false);
    setSplitOrder(null);
    setResultPayload(null);
    // Pembayaran split bisa memakai ARK Coin — segarkan cache customer
    void refetchCustomers();
  }, [refetchCustomers]);

  /* Open Bill */
  const handleOpenBill = useCallback(async () => {
    if (cart.items.length === 0) return;
    if (!requireActiveShift()) return;
    const continueCheckoutId =
      paymentCheckoutId || lastOpenCheckoutIdRef.current || readLastOpenCheckoutId() || undefined;
    const appendItems = newCartItemsForOpenBillAppend({
      items: cart.items,
      persistedItemIds: persistedCartItemIds,
    });
    const isAppend = Boolean(continueCheckoutId && persistedCartItemIds.length > 0);
    if (isAppend && appendItems.length === 0) {
      toast.message('Belum ada item baru — tambah menu lalu Order lagi');
      return;
    }
    const sendItems = isAppend ? appendItems : cart.items;
    const sendSubtotal = sendItems.reduce(
      (sum, item) => sum + Number(item.price) * Number(item.quantity),
      0
    );
    try {
      setSavingBill(true);
      const res = await openBill({
        order_type: cart.orderType as any,
        customer_id: selectedCustomer?.id,
        cashier_id: CASHIER_ID,
        server_id: undefined,
        table_id: effectiveTableId || undefined,
        checkout_id: continueCheckoutId,
        guest_count: normalizeGuestCount(guestCount),
        shift_id: shift?.id || undefined,
        items: sendItems.map((item) => {
          return {
            product_id: item.productId,
            sku_id: item.skuId,
            product_name: item.name,
            product_sku: item.skuCode || item.productId,
            variants: item.variantName ? [{ name: item.variantName, group: 'Size', price: item.variantPriceAdj || 0 }] : [],
            modifiers: item.modifierNames?.map((name, idx) => ({ name, group: `Option-${idx}` })) || [],
            quantity: Number(item.quantity),
            unit_price: Number(item.price - (item.variantPriceAdj || 0) - (item.modifierPriceAdj || 0)),
            variant_price_adjustment: item.variantPriceAdj || 0,
            modifier_price_adjustment: item.modifierPriceAdj || 0,
            subtotal: Number(item.price * item.quantity),
            discount_type: item.discount_type ?? null,
            discount_value: item.discount_value ?? null,
            discount_amount: 0,
            total_amount: Number(item.price * item.quantity),
            station: item.station,
            kitchen_notes: item.notes,
          };
        }),
        subtotal: isAppend ? sendSubtotal : cart.subtotal,
        discount_amount: isAppend ? 0 : discountAmount,
        discount_reason: [
          itemDiscountTotal > 0 ? 'ITEM line discounts' : null,
          ...offerEval.applied.map((a) => `OFFER ${a.name}`),
          membershipDiscount > 0 ? `MEMBER ${membershipDiscount}%` : null,
          promoApplied ? `PROMO ${promoApplied.code}` : null,
          cart.manual_discount_type && cart.manual_discount_value
            ? cart.manual_discount_type === 'percent'
              ? `MANUAL ${cart.manual_discount_value}%`
              : `MANUAL Rp ${Math.floor(cart.manual_discount_value)}`
            : null,
        ]
          .filter(Boolean)
          .join('; ') || undefined,
        manual_discount_type: cart.manual_discount_type,
        manual_discount_value: cart.manual_discount_value,
        membership_discount_pct: selectedCustomer?.discount || 0,
        promo_discount: isAppend ? 0 : promoApplied?.discount ?? 0,
        promo_code: isAppend ? undefined : promoApplied?.code,
        offer_discount: isAppend ? 0 : offerDiscount,
        tax_amount: isAppend ? 0 : taxAmount,
        service_charge_amount: isAppend ? 0 : serviceChargeAmount,
        other_charges_amount: isAppend ? 0 : otherChargesAmount,
        charges_breakdown: isAppend ? [] : billCharges.breakdown,
        total_amount: isAppend ? sendSubtotal : total,
        notes: cart.notes,
      });

      if (res.success && res.data) {
        const continuedCheckoutId =
          (res.data as { checkout_id?: string }).checkout_id || null;
        if (continuedCheckoutId) {
          lastOpenCheckoutIdRef.current = continuedCheckoutId;
          writeLastOpenCheckoutId(continuedCheckoutId);
        }
        const continuedNumber =
          (res.data as { checkout_number?: string }).checkout_number ||
          res.data.order_number;
        toast.success(
          isAppend
            ? `Item ditambahkan ke ${continuedNumber}`
            : res.data.queue_number
              ? `Open bill tersimpan — Antrian ${res.data.queue_number}`
              : `Open bill tersimpan — ${continuedNumber}`
        );
        if (isAppend) {
          setPersistedCartItemIds((prev) => [
            ...prev,
            ...appendItems.map((item) => item.id),
          ]);
        } else {
          cart.clearCart();
          setPersistedCartItemIds([]);
          maybeReturnToRestaurant();
        }
      } else {
        toast.error(res.error || 'Failed to save open bill');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to save open bill');
    } finally {
      setSavingBill(false);
    }
  }, [cart, selectedCustomer, discountAmount, taxAmount, total, requireActiveShift, shift, maybeReturnToRestaurant, effectiveTableId, serviceChargeAmount, otherChargesAmount, billCharges, guestCount, itemDiscountTotal, membershipDiscount, promoApplied, offerEval, paymentCheckoutId, persistedCartItemIds]);

  /* Print helpers */
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const handlePrint = useCallback(async (label: 'KITCHEN' | 'BAR' | 'CUSTOMER') => {
    if (!resultPayload || printingReceipt) return;
    setPrintingReceipt(true);
    try {
      await printThermalReceipt(resultPayload, label);
    } finally {
      setPrintingReceipt(false);
    }
  }, [resultPayload, printingReceipt]);

  /* ─── Render ───────────────────────────────────────────────────── */
  const shellHeight = isTabletMode
    ? 'h-[calc(100dvh-7rem)] min-h-[520px]'
    : 'h-[calc(100dvh-14rem)] min-h-[480px]';

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
      <div className={`flex shrink-0 flex-wrap items-center justify-between ${isTabletMode ? 'gap-2' : 'gap-3'}`}>
        <div className="min-w-0">
          <h1 className={`font-semibold text-gray-900 ${isTabletMode ? 'text-base' : 'text-xl'}`}>POS Cashier</h1>
          {isTabletMode ? (
            <p className="truncate text-xs text-muted-foreground">
              {selectedTableDisplay
                ? `Meja ${selectedTableDisplay}`
                : cart.orderType === 'takeaway'
                  ? 'Take Away'
                  : 'Without Table'}
              {selectedTableDisplay || cart.orderType === 'dine_in'
                ? ` · ${normalizeGuestCount(guestCount)} tamu`
                : null}
            </p>
          ) : (
          <p className="text-sm text-gray-500">
            {cart.orderType === 'dine_in' ||
            cart.orderType === 'takeaway' ||
            selectedTableDisplay ? (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                {selectedTableDisplay ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-primary">
                    <TableIcon className="h-3.5 w-3.5" />
                    Table {selectedTableDisplay}
                  </span>
                ) : cart.orderType === 'takeaway' ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-amber-700">
                    <ShoppingBag className="h-3.5 w-3.5" />
                    Take Away
                  </span>
                ) : cart.orderType === 'dine_in' ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-gray-700">
                    <TableIcon className="h-3.5 w-3.5" />
                    Without Table
                  </span>
                ) : null}
                {selectedTableDisplay || cart.orderType === 'dine_in' ? (
                  <>
                    <span className="text-gray-300">·</span>
                    <span>Dine-in</span>
                    {/* Jumlah tamu (EPIC-038). Placeholder "1" bukan nilai
                        default yang tersimpan diam-diam — field kosong memang
                        berarti 1 orang, dan itu ditegakkan di server. */}
                    <span className="text-gray-300">·</span>
                    {/* Tombol → dialog, bukan input kecil di header: angkanya
                        jadi terbaca jelas dan tidak mudah terlewat kasir. */}
                    <button
                      type="button"
                      onClick={() => {
                        setGuestDraft(guestCount);
                        setShowGuestModal(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2 py-0.5 font-medium text-gray-700 hover:border-primary hover:text-primary"
                    >
                      <Users className="h-3.5 w-3.5" />
                      {normalizeGuestCount(guestCount)} tamu
                    </button>
                    {/* Peringatan, BUKAN blokir — keputusan owner. Kasir tetap
                        bisa lanjut; memblokir hanya memancing angka palsu. */}
                    {guestCapacityWarning && (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {guestCapacityWarning}
                      </span>
                    )}
                  </>
                ) : null}
                {fromRestaurant ? (
                  <>
                    <span className="text-gray-300">·</span>
                    <span>From restaurant</span>
                  </>
                ) : null}
              </span>
            ) : (
              'Process orders with the dashboard sidebar available'
            )}
          </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StallSwitchButton />
          {fromRestaurant && (
            <Button
              type="button"
              variant="outline"
              className="border-gray-200/80 text-gray-700 hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
              onClick={handleBackToRestaurant}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Restaurant
            </Button>
          )}
          {showSecondaryDisplays ? (
            <div className="hidden [@media(hover:hover)_and_(pointer:fine)]:contents">
              {/* EPIC-024: buka layar customer sebagai window baru — drag ke
                  monitor kedua lalu F11 (BroadcastChannel sesama browser) */}
              <Button
                type="button"
                variant="outline"
                title="Buka layar customer di window baru — drag ke monitor kedua, lalu F11"
                className="border-gray-200/80 text-gray-700 hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                onClick={() =>
                  window.open(
                    '/pos/customer-display',
                    'pos-customer-display',
                    'popup=yes,width=1024,height=640'
                  )
                }
              >
                <MonitorIcon className="mr-2 h-4 w-4" />
                Layar Customer
              </Button>
              <Button
                type="button"
                variant="outline"
                title="Buka TV antrian customer — drag ke TV/monitor tamu, lalu F11"
                className="border-gray-200/80 text-gray-700 hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                onClick={() =>
                  window.open(
                    "/pos/queue",
                    "pos-queue-board",
                    "popup=yes,width=1440,height=900"
                  )
                }
              >
                <MonitorIcon className="mr-2 h-4 w-4" />
                TV Antrian
              </Button>
            </div>
          ) : null}
          <PosTabletChromeControls
            immersive={isTabletMode}
            ordersHref={buildPosOrdersUrl({ from: "cashier", tablet: isTabletMode })}
            onToggleImmersive={(next) => {
              if (next) router.push(cashierTabletRoute(searchParams));
              else router.replace(cashierDesktopRoute(searchParams));
            }}
          />
        </div>
      </div>

      <div className={cashierSplitRowClass({ isTabletMode, shellHeight })}>
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="flex items-center gap-3 rounded-xl border border-gray-200/70 bg-white p-6 shadow-xs">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="font-medium text-gray-900">Loading products...</span>
          </div>
        </div>
      )}
      {error && (
        <div className="fixed right-4 top-4 z-50 rounded-xl border border-red-200/80 bg-red-50 p-4">
          <div className="flex items-center gap-2 text-red-700">
            <X className="h-5 w-5" />
            <span className="font-medium">{error}</span>
          </div>
        </div>
      )}
      {/* LEFT PANEL */}
      <div className={`relative ${cashierLeftPanelClass(isTabletMode)}`}>
        {stallBlockedReason && !loading && (
          <CashierStallGate reason={stallBlockedReason} />
        )}
        {/* Offline Status Bar */}
        {!isOnline && (
          <div className="flex items-center justify-between rounded-lg border border-amber-200/80 bg-amber-50/80 px-4 py-2 text-sm text-amber-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <span className="font-medium">Offline mode — transactions saved locally</span>
            </div>
            <span className="text-xs opacity-75">{pendingCount} pending</span>
          </div>
        )}

        {!POS_SHIFT_MANAGEMENT_ENABLED ? null : !loadingShift && !hasShift ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
              <span className="font-medium">No active shift — open a shift to start transactions</span>
              {/* role not available in this client component without new session fetching; default copy */}
              <HelpHint helpId="pos.shift" role="default" />
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => setShowShiftModal(true)}
              className="bg-amber-600 hover:bg-amber-700"
            >
              Open Shift
            </Button>
          </div>
        ) : null}

        {POS_SHIFT_MANAGEMENT_ENABLED && loadingShift && (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200/70 bg-gray-50 px-4 py-2 text-sm text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking shift status...
          </div>
        )}

        <div className={`rounded-xl border border-gray-200/70 bg-white shadow-xs ${isTabletMode ? 'p-2.5' : 'p-4'}`}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                cart.setOrderType('dine_in');
                cart.setTable(null);
              }}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all ${
                cart.orderType === 'dine_in'
                  ? 'border-primary bg-primary text-white shadow-sm'
                  : 'border-primary/30 bg-primary/10 text-primary hover:border-primary/50 hover:bg-primary/15'
              }`}
            >
              <Utensils className="h-4 w-4" /> Dine-in
            </button>
            <button
              type="button"
              onClick={() => setShowTableModal(true)}
              className={
                selectedTableDisplay
                  ? 'flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition-all hover:border-primary/60 hover:bg-primary/15'
                  : cart.orderType === 'takeaway'
                    ? 'flex items-center gap-2 rounded-lg border border-amber-400 bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-amber-600'
                    : 'flex items-center gap-2 rounded-lg border border-gray-200/80 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-700 transition-all hover:border-primary/30 hover:bg-primary/5 hover:text-primary'
              }
              title="Service / table mode"
            >
              {cart.orderType === 'takeaway' ? (
                <ShoppingBag className="h-4 w-4" />
              ) : (
                <TableIcon className="h-4 w-4" />
              )}
              {selectedTableDisplay
                ? `Table ${selectedTableDisplay}`
                : cart.orderType === 'takeaway'
                  ? 'Take Away'
                  : 'Without Table'}
            </button>
            <button
              onClick={() => setShowCustomerModal(true)}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all ${isTabletMode ? 'min-w-0' : 'min-w-[150px]'} ${
                selectedCustomer
                  ? 'border-violet-500 bg-violet-500 text-white shadow-sm hover:bg-violet-600'
                  : 'border-violet-200/80 bg-violet-50 text-violet-700 hover:border-violet-400 hover:bg-violet-100'
              }`}
            >
              <User className="h-4 w-4" />
              <span>
                {selectedCustomer?.name ? selectedCustomer.name.split(' ')[0] : 'Find Customer'}
              </span>
            </button>
            <div className={`relative flex-1 ${isTabletMode ? 'min-w-32' : 'min-w-[220px]'}`}>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                type="text"
                placeholder="Search products..."
                value={searchTerm}
                onChange={e => {
                  setSearchTerm(e.target.value);
                  setShowProductSuggestions(true);
                  setActiveProductSuggestion(0);
                }}
                onFocus={() => setShowProductSuggestions(true)}
                onBlur={() => {
                  window.setTimeout(() => setShowProductSuggestions(false), 120);
                }}
                onKeyDown={(e) => {
                  if (!showProductSuggestions || productSuggestions.length === 0) return;

                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveProductSuggestion((current) => Math.min(current + 1, productSuggestions.length - 1));
                    return;
                  }

                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveProductSuggestion((current) => Math.max(current - 1, 0));
                    return;
                  }

                  if (e.key === 'Enter') {
                    e.preventDefault();
                    selectProductFromSearch(productSuggestions[activeProductSuggestion] || productSuggestions[0]);
                    return;
                  }

                  if (e.key === 'Escape') {
                    setShowProductSuggestions(false);
                  }
                }}
                className="h-10 pl-10 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
              />
              {showProductSuggestions && searchTerm.trim() && (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-80 overflow-y-auto rounded-xl border border-gray-200/70 bg-white p-1 shadow-lg">
                  {productSuggestions.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-gray-500">No products found</div>
                  ) : (
                    productSuggestions.map((product, index) => {
                      const hasOptions = Boolean(product.variants?.length || product.modifiers?.length);

                      return (
                        <button
                          key={product.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => selectProductFromSearch(product)}
                          onMouseEnter={() => setActiveProductSuggestion(index)}
                          className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                            index === activeProductSuggestion ? 'bg-primary/10' : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-gray-900">{product.name}</div>
                            <div className="text-xs text-gray-500">
                              {product.category?.name || 'Uncategorized'} · {formatCurrency(product.base_price)}
                            </div>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${
                            hasOptions ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                          }`}>
                            {hasOptions ? 'Options' : 'Add'}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Selected Customer */}
        {selectedCustomer && (
          <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-gradient-to-r from-primary/5 to-amber-50 p-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              {selectedCustomer.name?.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">{selectedCustomer.name}</div>
              <div className="text-xs text-gray-600 flex items-center gap-2">
                <span className="capitalize">{selectedCustomer.membership_tier}</span>
                <span className="text-gray-300">•</span>
                <span className="font-medium text-green-600">{selectedCustomer.discount}% off</span>
                <HelpHint helpId="pos.discount" role="default" />
                {arkEnabled && (
                  <>
                    <span className="text-gray-300">•</span>
                    <span className="text-amber-600 font-medium">{formatArk(selectedCustomer.ark_coin_balance)}</span>
                  </>
                )}
              </div>
            </div>
            <button onClick={() => cart.setCustomer(null)} className="p-1 text-gray-400 hover:text-red-600 transition-colors"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Favorites */}
        {favorites.length > 0 && (
          <div className="rounded-xl border border-amber-100/80 bg-gradient-to-r from-amber-50 to-orange-50 p-3">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-semibold text-amber-700">
                {selectedCustomer?.name?.split(' ')[0]}&apos;s favorites
              </span>
              <span className="text-xs text-amber-600">({favorites.length} items)</span>
            </div>
            <div className={isTabletMode ? 'grid grid-cols-2 gap-2 @min-[22rem]:grid-cols-3 @min-[36rem]:grid-cols-4' : 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4'}>
              {favorites.map(product => (
                <button key={product.id} onClick={() => openCustomization(product)} className="flex items-center gap-2 rounded-lg border border-amber-200/80 bg-white p-2 text-left transition-all hover:border-amber-400 hover:bg-amber-50">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                    <PosProductThumbnail
                      src={product.image_url}
                      alt={product.name}
                      iconClassName="h-4 w-4"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-900 truncate">{product.name}</div>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-xs text-primary font-semibold">{formatCurrency(product.base_price)}</span>
                      {arkEnabled && <span className="text-[10px] text-amber-600 font-medium">{formatArk(product.base_price)}</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {showStallFilters && (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {stallFilters.map((stall) => (
              <button
                key={stall.id}
                type="button"
                onClick={() => setSelectedStallFilter(stall.id)}
                className={`rounded-lg border border-gray-200/70 px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all ${
                  selectedStallFilter === stall.id
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {stall.label}
              </button>
            ))}
          </div>
        )}

        {/* Categories */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                selectedCategory === cat ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {(activeOffersQuery.data?.length ?? 0) > 0 && (
          <PosOfferBanners
            offers={activeOffersQuery.data ?? []}
            className="pb-1"
            onApplyOffer={applyOfferToCart}
          />
        )}

        {/* Product Grid */}
        <div className={cashierProductScrollClass()}>
          <div className={cashierProductGridClass()}>
            {filteredProducts.map(product => {
              const xp = product.xp ?? ((Math.abs(product.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 100) + 1);
              // Produk privilege member (EPIC-011 Fase C): terkunci bila
              // member belum dipilih / lifetime XP belum memenuhi min_xp.
              const minXp = Number((product as { min_xp?: number | string | null }).min_xp) || 0;
              const customerXp = Number((selectedCustomer as { total_xp?: number | string } | null)?.total_xp) || 0;
              const isLocked = xpEnabled && minXp > 0 && (!selectedCustomer || customerXp < minXp);
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => {
                    if (isLocked) {
                      toast.error(
                        selectedCustomer
                          ? `Produk khusus member ≥ ${minXp} XP (XP member: ${customerXp})`
                          : `Produk khusus member ≥ ${minXp} XP — pilih member dulu`
                      );
                      return;
                    }
                    openCustomization(product);
                  }}
                  className={`group relative flex flex-col overflow-hidden rounded-lg border text-left transition-all ${
                    isLocked
                      ? 'border-gray-200/70 bg-white opacity-60'
                      : 'border-gray-200/70 bg-white hover:border-primary/50 hover:shadow-sm'
                  }`}
                >
                  {xpEnabled && minXp > 0 && (
                    <span
                      className={`absolute right-1 top-1 z-10 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                        isLocked ? 'bg-gray-800/80 text-white' : 'bg-purple-600 text-white'
                      }`}
                    >
                      {isLocked ? '🔒 ' : '★ '}{minXp} XP
                    </span>
                  )}
                  <div className={`${isTabletMode ? 'aspect-[4/3]' : 'aspect-[5/4]'} w-full overflow-hidden bg-gray-100`}>
                    <PosProductThumbnail src={product.image_url} alt={product.name} />
                  </div>
                  <div className={`flex flex-col ${isTabletMode ? 'gap-0.5 p-2 @min-[40rem]:gap-1 @min-[40rem]:p-2.5' : 'gap-0.5 p-1.5'}`}>
                    <div className={`line-clamp-2 font-medium leading-snug text-gray-900 ${isTabletMode ? 'text-[11px] @min-[40rem]:text-xs' : 'text-[11px] leading-tight'}`}>
                      {product.name}
                    </div>
                    {allStalls && product.stall_name ? (
                      <div className="truncate text-[9px] font-semibold uppercase tracking-wide text-sky-700">
                        {product.stall_name}
                      </div>
                    ) : null}
                    <div className={`font-bold text-primary ${isTabletMode ? 'text-xs @min-[40rem]:text-sm' : 'text-[11px]'}`}>{formatCurrency(product.base_price)}</div>
                    {(arkEnabled || xpEnabled) && (
                    <div className="flex items-center justify-between gap-1">
                      {arkEnabled ? (
                        <span className={`font-medium text-amber-600 ${isTabletMode ? 'text-[11px]' : 'text-[9px]'}`}>{formatArk(product.base_price)}</span>
                      ) : <span />}
                      {xpEnabled && (
                      <span className={`inline-flex items-center gap-0.5 font-semibold text-purple-600 ${isTabletMode ? 'text-[11px]' : 'text-[9px]'}`}>
                        <Sparkles className={isTabletMode ? 'h-3 w-3' : 'h-2.5 w-2.5'} />
                        +{xp}
                      </span>
                      )}
                    </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* RIGHT PANEL — Cart */}
      <CartPanel
        showArk={arkEnabled}
        className={cashierCartPanelClass(isTabletMode)}
        cart={cart.items}
        orderType={cart.orderType}
        selectedTable={selectedTableDisplay}
        subtotal={cart.subtotal}
        discountAmount={discountAmount}
        membershipDiscountAmount={membershipDiscountAmount}
        promoApplied={promoApplied}
        promoDiscount={promoDiscount}
        promoInput={promoInput}
        promoBusy={promoBusy}
        promoError={promoError}
        promoDisabled={!isOnline || shouldDisableMixedPromo(cartStallIds)}
        onPromoInputChange={(value) => {
          setPromoInput(value.toUpperCase());
          setPromoError(null);
        }}
        onApplyPromo={applyPromo}
        onClearPromo={() => {
          setPromoApplied(null);
          setPromoError(null);
        }}
        orderNotes={cart.notes}
        onOrderNotesChange={cart.setNotes}
        showStallBadges={allStalls}
        itemDiscountTotal={itemDiscountTotal}
        offerDiscount={offerDiscount}
        offerApplied={offerEval.applied}
        manualDiscountAmount={manualDiscountAmount}
        manualDiscountType={cart.manual_discount_type}
        manualDiscountValue={cart.manual_discount_value}
        manualDiscountBasis={manualDiscountBasis}
        onSetItemDiscount={cart.setItemDiscount}
        onSetManualDiscount={cart.setManualDiscount}
        selectedCustomer={selectedCustomer}
        includeTax={cart.includeTax}
        includeService={cart.includeService}
        tax={taxAmount}
        serviceCharge={serviceChargeAmount}
        taxToggleLabel={taxLabel}
        serviceToggleLabel={serviceLabel}
        otherChargeLines={otherChargeLines}
        arkToUseCapped={arkToUseCapped}
        paymentMethod={paymentMethod}
        totalAfterArk={totalAfterArk}
        total={total}
        formatCurrency={formatCurrency}
        formatArk={formatArk}
        setIncludeTax={cart.setIncludeTax}
        setIncludeService={cart.setIncludeService}
        setShowPaymentModal={openPaymentModal}
        onOpenBill={handleOpenBill}
        continuingCheckoutNumber={paymentCheckoutId ? payingOrderNumber : null}
        lockedItemIds={persistedCartItemIds}
        isSavingBill={savingBill}
        canTransact={canTransact}
        onOpenShift={POS_SHIFT_MANAGEMENT_ENABLED ? () => setShowShiftModal(true) : undefined}
        updateQuantity={cart.updateQty}
        removeFromCart={cart.removeItem}
        onClearCart={() => {
          if (cart.items.length === 0) return;
          cart.clearItems();
          setPromoApplied(null);
          setPromoError(null);
          setPromoInput('');
          toast.success('Keranjang dikosongkan');
        }}
      />

      {/* ── Customer Modal ── */}
      <CustomerSearchModal
        open={showCustomerModal}
        customers={customers}
        search={customerSearch}
        selectedCustomerId={cart.selectedCustomerId}
        onSearchChange={setCustomerSearch}
        onCreateCustomer={handleCreateCustomer}
        initialNfcUid={pendingNfcUid}
        onSelect={(c) => {
          cart.setCustomer(c?.id ?? null);
          setShowCustomerModal(false);
          setCustomerSearch('');
          setPendingNfcUid(null);
          if (c) toast.success(`Member ${c.name || c.phone} dipilih`);
        }}
        onClose={() => {
          setShowCustomerModal(false);
          setPendingNfcUid(null);
        }}
      />

      {/* ── Table Modal ── */}
      {/* Jumlah tamu (EPIC-038) — tombol cepat untuk kasus umum, kotak isian
          untuk rombongan. Peringatan kapasitas memberi tahu, tidak memblokir. */}
      <Dialog open={showGuestModal} onOpenChange={setShowGuestModal}>
        <DialogPanel size="sm">
          <DialogPanelHeader>
            <DialogPanelTitle>Jumlah Tamu</DialogPanelTitle>
            <DialogPanelDescription>
              {selectedTableDisplay
                ? `Meja ${selectedTableDisplay}${selectedTableCapacity ? ` · kapasitas ${selectedTableCapacity} kursi` : ''}`
                : 'Berapa orang untuk pesanan ini?'}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 4, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setGuestDraft(String(n))}
                  className={`min-w-11 rounded-lg border px-3 py-2 text-sm font-semibold ${
                    normalizeGuestCount(guestDraft) === n
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-gray-300 text-gray-700 hover:border-primary hover:text-primary'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>

            <Input
              type="number"
              min={1}
              inputMode="numeric"
              autoFocus
              value={guestDraft}
              onChange={(e) => setGuestDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setGuestCount(guestDraft);
                  setShowGuestModal(false);
                }
              }}
              placeholder="Jumlah lain"
              aria-label="Jumlah tamu"
              className="mt-3"
            />

            {(() => {
              const peringatan = capacityWarning(
                normalizeGuestCount(guestDraft),
                selectedTableCapacity
              );
              return peringatan ? (
                <p className="mt-2 text-xs text-amber-700">{peringatan}</p>
              ) : null;
            })()}

            <p className="mt-2 text-xs text-gray-500">
              Dikosongkan berarti 1 orang.
            </p>

            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowGuestModal(false)}
              >
                Batal
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setGuestCount(guestDraft);
                  setShowGuestModal(false);
                }}
              >
                Simpan
              </Button>
            </div>
          </DialogPanelBody>
        </DialogPanel>
      </Dialog>

      <Dialog open={showTableModal} onOpenChange={setShowTableModal}>
        <DialogPanel size="lg" className="max-h-[80vh]">
          <DialogPanelHeader>
            <DialogPanelTitle>Service / Table</DialogPanelTitle>
            <DialogPanelDescription>
              Choose Without Table, Take Away, or a dine-in table
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="flex min-h-0 flex-col">
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  cart.setTable(null);
                  cart.setOrderType('dine_in');
                  setShowTableModal(false);
                }}
                className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold transition-all ${
                  cart.orderType === 'dine_in' && !effectiveTableId
                    ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/30'
                    : 'border-gray-200/70 bg-white text-gray-700 hover:border-primary/40 hover:bg-primary/5'
                }`}
              >
                <TableIcon className="h-4 w-4" />
                Without Table
              </button>
              <button
                type="button"
                onClick={() => {
                  cart.setTable(null);
                  cart.setOrderType('takeaway');
                  setShowTableModal(false);
                }}
                className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold transition-all ${
                  cart.orderType === 'takeaway' && !effectiveTableId
                    ? 'border-amber-400 bg-amber-50 text-amber-800 ring-1 ring-amber-300'
                    : 'border-gray-200/70 bg-white text-gray-700 hover:border-amber-300 hover:bg-amber-50'
                }`}
              >
                <ShoppingBag className="h-4 w-4" />
                Take Away
              </button>
            </div>
            {loadingTables ? (
              <div className="flex items-center gap-2 rounded-lg border border-gray-200/70 bg-gray-50/80 p-4 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading tables...
              </div>
            ) : tableError ? (
              <div className="rounded-lg border border-red-200/80 bg-red-50 p-4 text-sm font-medium text-red-600">
                {tableError}
              </div>
            ) : tables.length === 0 ? (
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/80 p-4 text-sm text-gray-500">
                No active tables available.
              </div>
            ) : (
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
                {tablesByFloor.map((group) => (
                  <section key={group.floorKey || '__unassigned'} className="space-y-2">
                    <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between gap-2 border-b border-gray-200/70 bg-white/95 px-1 py-2 backdrop-blur-sm">
                      <h3 className="text-sm font-semibold text-gray-900">
                        {group.label}
                      </h3>
                      <span className="text-xs text-gray-500">
                        {group.tables.length} table
                        {group.tables.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                      {group.tables.map((table) => {
                        const isSelected = effectiveTableId === table.id;
                        const isOccupied = table.status === 'occupied' && !isSelected;
                        const activeOrder = table.active_order?.order_number;

                        return (
                          <button
                            key={table.id}
                            type="button"
                            disabled={isOccupied}
                            onClick={() => {
                              cart.setOrderType('dine_in');
                              cart.setTable(isSelected ? null : table.id);
                              setShowTableModal(false);
                            }}
                            className={`min-h-[84px] rounded-lg border px-3 py-3 text-left transition-all ${
                              isSelected
                                ? 'border-primary bg-primary text-white shadow-sm'
                                : isOccupied
                                  ? 'cursor-not-allowed border-gray-200/70 bg-gray-100 text-gray-400'
                                  : 'border-gray-200/70 bg-white text-gray-800 hover:border-primary/50 hover:bg-primary/10'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-bold tracking-normal">
                                {getTableDisplayName(table)}
                              </span>
                              <TableIcon className="h-4 w-4 shrink-0" />
                            </div>
                            <div
                              className={`mt-2 text-[11px] font-medium ${
                                isSelected
                                  ? 'text-primary-foreground/70'
                                  : isOccupied
                                    ? 'text-gray-400'
                                    : 'text-gray-500'
                              }`}
                            >
                              {table.area || '—'}
                            </div>
                            <div
                              className={`mt-1 text-xs font-semibold ${
                                isSelected
                                  ? 'text-primary-foreground/70'
                                  : isOccupied
                                    ? 'text-gray-400'
                                    : 'text-gray-500'
                              }`}
                            >
                              {isOccupied
                                ? activeOrder || 'Occupied'
                                : `${table.capacity} seats`}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </DialogPanelBody>
        </DialogPanel>
      </Dialog>

      {/* ── Customization Modal ── */}
      <CustomizationModal
        showArk={arkEnabled}
        open={!!custom}
        product={customizingProduct}
        value={custom}
        onChange={setCustom}
        onConfirm={handleConfirmCustomization}
        onCancel={() => { setCustom(null); setCustomizingProduct(null); }}
        formatCurrency={formatCurrency}
        formatArk={formatArk}
      />

      {/* ── Payment Modal ── */}
      <PaymentModal
        open={showPayment}
        total={total}
        totalAfterArk={totalAfterArk}
        selectedCustomer={selectedCustomer}
        onClose={() => setShowPayment(false)}
        submitting={processingPayment || submitting}
        isMixedCart={isMixedCart}
        isCheckoutBill={Boolean(paymentCheckoutId)}
        payingOrderId={paymentOrderId}
        onPrepareMixedQrisCheckout={
          isMixedCart
            ? async () => {
                const res = await checkout({
                  cart: cart.items,
                  orderType: cart.orderType,
                  selectedTable: effectiveTableId,
                  selectedCustomer,
                  paymentMethod: 'qris',
                  cashReceived: '',
                  includeTax: cart.includeTax,
                  notes: cart.notes,
                  arkToUse: 0,
                  shiftId: shift?.id || null,
                  paymentMethodCode: 'qris',
                  paymentMethodName: 'QRIS',
                  promo: promoApplied,
                  billCharges,
                  manualDiscountType: cart.manual_discount_type,
                  manualDiscountValue: cart.manual_discount_value,
                  offerDiscount,
                  offerLabels: offerEval.applied.map((a) => a.name),
                  paymentStatus: 'unpaid',
                });
                if (!res.success || !res.checkoutId) {
                  throw new Error(res.error || 'Gagal menyiapkan checkout QRIS');
                }
                return {
                  checkout_id: res.checkoutId,
                  checkout_number: res.checkoutNumber,
                  queue_number: res.queueNumber ?? null,
                };
              }
            : undefined
        }
        onPrepareOrderQris={async () => {
          // Bug #5 fix (insiden 2026-08-25): jual instan single-stall via
          // QRIS — order dibuat 'unpaid' DULU (item + stok BOM/merchandise
          // diklaim di sini, lewat endpoint open-bill yang sama dgn table
          // order), baru QR diikat ke order itu. Kalau settle gagal
          // setelah customer bayar, order tetap ADA — bukan orphan.
          const res = await openBill({
            order_type: cart.orderType as 'dine_in' | 'takeaway' | 'delivery' | 'self_order',
            customer_id: selectedCustomer?.id,
            table_id: effectiveTableId || undefined,
            guest_count: normalizeGuestCount(guestCount),
            reuse_unpaid_checkout: false,
            items: cart.items.map((item) => ({
              product_id: item.productId,
              sku_id: item.skuId,
              product_name: item.name,
              product_sku: item.skuCode || item.productId,
              variants: item.variantName
                ? [{ name: item.variantName, group: 'Size', price: item.variantPriceAdj || 0 }]
                : [],
              modifiers:
                item.modifierNames?.map((name, idx) => ({ name, group: `Option-${idx}` })) || [],
              quantity: item.quantity,
              unit_price: Number(
                item.price - (item.variantPriceAdj || 0) - (item.modifierPriceAdj || 0)
              ),
              variant_price_adjustment: item.variantPriceAdj || 0,
              modifier_price_adjustment: item.modifierPriceAdj || 0,
              subtotal: item.price * item.quantity,
              discount_type: item.discount_type ?? null,
              discount_value: item.discount_value ?? null,
              total_amount: item.price * item.quantity,
              station: item.station,
              kitchen_notes: item.notes,
            })),
            subtotal: cart.subtotal,
            discount_amount: discountAmount,
            discount_reason: [
              itemDiscountTotal > 0 ? 'ITEM line discounts' : null,
              ...offerEval.applied.map((a) => `OFFER ${a.name}`),
              membershipDiscount > 0 ? `MEMBER ${membershipDiscount}%` : null,
              promoApplied ? `PROMO ${promoApplied.code}` : null,
              cart.manual_discount_type && cart.manual_discount_value
                ? cart.manual_discount_type === 'percent'
                  ? `MANUAL ${cart.manual_discount_value}%`
                  : `MANUAL Rp ${Math.floor(cart.manual_discount_value)}`
                : null,
            ]
              .filter(Boolean)
              .join('; ') || undefined,
            manual_discount_type: cart.manual_discount_type,
            manual_discount_value: cart.manual_discount_value,
            tax_amount: taxAmount,
            service_charge_amount: serviceChargeAmount,
            other_charges_amount: otherChargesAmount,
            charges_breakdown: billCharges.breakdown,
            total_amount: total,
            notes: cart.notes,
            membership_discount_pct: membershipDiscount,
            promo_discount: promoApplied?.discount ?? 0,
            promo_code: promoApplied?.code,
            offer_discount: offerDiscount,
            shift_id: shift?.id || undefined,
          });
          if (!res.success || !res.data?.id) {
            throw new Error(res.error || 'Gagal menyiapkan order QRIS');
          }
          return {
            order_id: res.data.id,
            order_number: res.data.order_number,
            queue_number: res.data.queue_number ?? null,
          };
        }}
        onAbandonOrderQris={async (orderId) => {
          // Bug #5 fix (insiden 2026-08-25): kasir batal QRIS sebelum bayar
          // — 'cancelled' mengembalikan stok BOM/merchandise otomatis
          // (lihat blok `if (status === 'cancelled')` di PATCH order/[id]).
          await updateOrderStatus(orderId, 'cancelled', {
            cancelled_reason: 'QRIS dibatalkan sebelum dibayar',
          }).catch((err) => {
            console.error(`[pos] abandon prepared QRIS order ${orderId} failed:`, err);
          });
        }}
        onConfirm={async ({
          method,
          cashReceived,
          arkToUse,
          nfcTabUid,
          giftCardCode,
          checkoutId,
          checkoutNumber,
          queueNumber,
          orderId,
          orderNumber,
          xenditQrId,
          xenditExternalId,
          paymentMethodCode,
          paymentMethodName,
          supervisorPin,
        }) => {
          setPaymentMethod(method);
          setCashReceived(cashReceived);
          setCurrentArkToUse(arkToUse);
          await handleCreateOrder({
            method,
            cashReceived,
            arkToUse,
            nfcTabUid,
            giftCardCode,
            checkoutId,
            checkoutNumber,
            queueNumber,
            orderId,
            orderNumber,
            xenditQrId,
            xenditExternalId,
            paymentMethodCode,
            paymentMethodName,
            supervisorPin,
          });
        }}
        formatCurrency={formatCurrency}
        formatArk={formatArk}
        onTapNFC={() => setShowNFC(true)}
        onCfdPayment={setCfdPayment}
        onCheckGiftCard={async (code) => {
          const res = await fetch('/api/pos/gift-card-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, total }),
          });
          const body = await res.json();
          if (!res.ok) {
            return { ok: false, reason: body.error || 'Gagal memeriksa gift card' };
          }
          const data = body.data || {};
          return {
            ok: Boolean(data.ok),
            reason: data.reason,
            balance: data.balance,
            covers: data.covers,
            expiresAt: data.expires_at,
          };
        }}
        onCheckNfcTab={async (uid) => {
          const res = await fetch('/api/ticketing/tab/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nfc_uid: uid, amount: total }),
          });
          const body = await res.json();
          if (!res.ok) {
            return { ok: false, reason: body.error || 'Gagal memeriksa gelang' };
          }
          const data = body.data || {};
          return {
            ok: Boolean(data.ok),
            reason: data.reason,
            contactName: data.contactName,
            paymentMode: data.paymentMode,
            available: data.available,
          };
        }}
      />

      {/* ── EPIC-039 Fase B — pilih varian merchandise ber-SKU ── */}
      {merchSkuProduct && (
        <MerchSkuPickerDialog
          product={merchSkuProduct}
          onSelect={handleSelectMerchSku}
          onClose={() => setMerchSkuProduct(null)}
          formatCurrency={formatCurrency}
        />
      )}

      {/* ── EPIC-034 Fase B — jual gift card (nominal diketik kasir) ── */}
      {giftCardProduct && (
        <GiftCardSaleDialog
          open
          productName={giftCardProduct.name}
          onClose={() => setGiftCardProduct(null)}
          onConfirm={handleConfirmGiftCardSale}
          formatCurrency={formatCurrency}
        />
      )}

      {/* ── NFC Modal ── */}
      <NFCModal
        open={showNFC}
        input={nfcInput}
        searching={nfcSearching}
        error={nfcError}
        onInputChange={setNfcInput}
        onSubmit={() => processNFCCard(nfcInput)}
        onCancel={() => { setShowNFC(false); setNfcInput(''); setNfcError(''); }}
      />

      <AlertDialog
        open={Boolean(createMemberPromptUid)}
        onOpenChange={(open) => {
          if (!open) setCreateMemberPromptUid(null);
        }}
      >
        <AlertDialogContent size="default">
          <AlertDialogHeader>
            <AlertDialogTitle>Card ID has no member</AlertDialogTitle>
            <AlertDialogDescription>
              This card ID ({createMemberPromptUid}) is not linked to a member yet.
              Link it to an existing customer or create a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary hover:bg-primary/90"
              onClick={() => {
                if (!createMemberPromptUid) return;
                setPendingNfcUid(createMemberPromptUid);
                setCreateMemberPromptUid(null);
                setShowCustomerModal(true);
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(topupPrompt)}
        onOpenChange={(open) => {
          if (!open) setTopupPrompt(null);
        }}
      >
        <AlertDialogContent size="default">
          <AlertDialogHeader>
            <AlertDialogTitle>Insufficient ARK balance</AlertDialogTitle>
            <AlertDialogDescription>
              {topupPrompt
                ? `Your remaining balance is ${formatArk(topupPrompt.balance)}. Balance is insufficient for this payment. Would you like to top up?`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary hover:bg-primary/90"
              onClick={() => {
                if (!topupPrompt) return;
                const href = buildTopupCardPath(topupPrompt.uid);
                setTopupPrompt(null);
                setShowPayment(false);
                router.push(href);
              }}
            >
              Yes, top up
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Result Modal / Print Struk ── */}
      <Dialog open={!!resultPayload} onOpenChange={(open) => { if (!open) closeResultModal(); }}>
        <DialogPanel size="sm" showCloseButton={false}>
          {resultPayload ? (
            <>
              <DialogPanelHeader>
                <DialogPanelTitle>Print Struk</DialogPanelTitle>
                <DialogPanelDescription>
                  {lastResultType === "offlined"
                    ? "Order tersimpan offline. Cetak struk bila perlu."
                    : "Pembayaran berhasil. Cetak struk untuk pelanggan."}
                </DialogPanelDescription>
              </DialogPanelHeader>
              <DialogPanelBody className="space-y-5">
                {lastResultType === "offlined" ? (
                  <>
                    <div className="space-y-2 text-center">
                      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-50">
                        <AlertCircle className="h-8 w-8 text-amber-600" />
                      </div>
                      <h2 className="text-xl font-bold text-foreground">
                        Saved offline
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Order will sync when connection is restored.
                      </p>
                    </div>
                    <div className="space-y-2.5 rounded-xl border border-amber-200/70 bg-amber-50/60 px-4 py-3.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">Order</span>
                        <span className="font-semibold tabular-nums text-foreground">
                          {resultPayload.orderNumber}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">Total</span>
                        <span className="font-semibold tabular-nums text-foreground">
                          {formatCurrency(resultPayload.total)}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-2 text-center">
                      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50">
                        <CheckCircle className="h-8 w-8 text-emerald-600" />
                      </div>
                      <h2 className="text-xl font-bold text-foreground">
                        Payment successful
                      </h2>
                      {resultPayload.queueNumber ? (
                        <p className="text-4xl font-black tabular-nums text-foreground">
                          {resultPayload.queueNumber}
                        </p>
                      ) : null}
                      <p className="text-sm text-muted-foreground">
                        {resultPayload.queueNumber
                          ? `Nomor Antrian · Order ${resultPayload.orderNumber || ""}`
                          : `Order #${
                              resultPayload.orderNumber?.slice(-8).toUpperCase() ||
                              resultPayload.orderId?.slice(-8).toUpperCase()
                            }`}
                      </p>
                    </div>

                    <div className="space-y-2.5 rounded-xl border border-gray-200/70 bg-muted/30 px-4 py-3.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">Amount paid</span>
                        <span className="font-semibold tabular-nums text-foreground">
                          {formatCurrency(resultPayload.total)}
                        </span>
                      </div>
                      {resultPayload.change > 0 ? (
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-muted-foreground">Change</span>
                          <span className="font-semibold tabular-nums text-emerald-600">
                            {formatCurrency(resultPayload.change)}
                          </span>
                        </div>
                      ) : null}
                      {resultPayload.paymentMethod ? (
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-muted-foreground">Method</span>
                          <span className="font-medium capitalize text-foreground">
                            {resultPayload.paymentMethod.replace("_", " ")}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["KITCHEN", "Kitchen"],
                      ["BAR", "Bar"],
                    ] as const
                  ).map(([label, text]) => (
                    <Button
                      key={label}
                      type="button"
                      variant="outline"
                      onClick={() => void handlePrint(label)}
                      disabled={printingReceipt}
                      className="h-auto flex-col gap-1 border-gray-200/80 px-2 py-2.5 text-xs font-semibold text-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                    >
                      <Printer className="h-4 w-4" />
                      {text}
                    </Button>
                  ))}
                </div>
                <Button
                  type="button"
                  onClick={() => void handlePrint("CUSTOMER")}
                  disabled={printingReceipt}
                  className="h-11 w-full gap-2 bg-primary hover:bg-primary/90"
                >
                  {printingReceipt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                  Print Struk
                </Button>

                {/* Member ber-nomor: field terisi, klik Kirim WA. Tetap bisa
                    diganti / diketik manual jika nomor kosong atau beda. */}
                {waSentTo ? (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/60 px-4 py-2.5 text-sm text-emerald-700">
                    <CheckCircle className="h-4 w-4" />
                    Struk terkirim ke {waSentTo}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex gap-2">
                      <Input
                        type="tel"
                        inputMode="tel"
                        value={waPhoneInput}
                        onChange={(e) => { setWaPhoneInput(e.target.value); setWaError(null); }}
                        placeholder="Nomor WA pelanggan (08…)"
                        className="h-11"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void sendReceiptWa(waPhoneInput)}
                        disabled={waSending || !waPhoneInput.trim()}
                        className="h-11 shrink-0 gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                      >
                        {waSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                        Kirim WA
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {waPrefillFromMember
                        ? "Nomor pelanggan — bisa diganti sebelum kirim"
                        : "Isi nomor WA pelanggan, atau biarkan kosong jika tidak dikirim"}
                    </p>
                  </div>
                )}
                {waError && <p className="text-center text-xs text-red-600">{waError}</p>}
              </DialogPanelBody>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeResultModal}
                  className="w-full border-gray-200/80 sm:w-auto"
                >
                  Transaksi baru
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogPanel>
      </Dialog>

      {/* ── Offline Queue Modal ── */}
      <Dialog open={showOfflineQueue} onOpenChange={setShowOfflineQueue}>
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Offline Queue</DialogPanelTitle>
            <DialogPanelDescription>{pendingCount} orders waiting to sync</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowOfflineQueue(false)}>
              Close
            </Button>
            <Button
              type="button"
              disabled={!isOnline || pendingCount === 0}
              onClick={async () => {
                const { synced, failed } = await syncQueue();
                toast.success(`Sync complete: ${synced} succeeded, ${failed} failed`);
              }}
              className="bg-primary hover:bg-primary/90"
            >
              Sync Now
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      {/* ── Shift Modal ── */}
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

      {/* ── Split Bill Modal ── */}
      <SplitBillModal
        open={showSplitModal}
        total={total}
        subtotal={cart.subtotal}
        taxAmount={taxAmount}
        discountAmount={discountAmount}
        cartItems={cart.items}
        onClose={() => setShowSplitModal(false)}
        onConfirm={handleConfirmSplit}
        formatCurrency={formatCurrency}
      />

      {/* ── Split Payment Screen (overlay) ── */}
      {showSplitPayment && splitOrder && (
        <div className="fixed inset-0 bg-white z-50 flex flex-col p-4 lg:p-6">
          <SplitPaymentScreen
            orderId={splitOrder.id}
            orderNumber={splitOrder.order_number}
            orderType={splitOrder.order_type}
            table={splitOrder.table_id ? getTableDisplayName(tableById.get(splitOrder.table_id)) : null}
            items={splitOrder.items || []}
            notes={splitOrder.notes}
            total={total}
            taxAmount={taxAmount}
            discountAmount={discountAmount}
            customerName={selectedCustomer?.name}
            onBack={() => setShowSplitPayment(false)}
            onComplete={handleSplitComplete}
            formatCurrency={formatCurrency}
            formatArk={formatArk}
          />
        </div>
      )}
      </div>
    </div>
    </PageTransition>
    </TooltipProvider>
  );
}

export function CashierPage({ variant = 'embedded' }: { variant?: CashierPageVariant }) {
  return (
    <Suspense fallback={
      <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading cashier...
      </div>
    }>
      <CashierPageNewContent variant={variant} />
    </Suspense>
  );
}
