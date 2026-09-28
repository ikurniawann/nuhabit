'use client';
import { computeCustomizationPrice } from '@/lib/pos/customization-price';
import { useLoyaltyFeatures } from '@/lib/crm/use-loyalty-features';

/**
 * POS Classic — kasir gaya klasik (ala Quinos) untuk layar sentuh.
 *
 * Tata letak: tiket order di kiri, ubin kategori + produk berukuran besar di
 * kanan, keypad angka + tombol aksi besar di bawah. Semua logika keranjang,
 * stok stall, tagihan, dan pembayaran memakai hook/komponen yang SAMA dengan
 * POS utama — halaman ini hanya kulit baru, engine tidak disentuh.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  CheckCircle2,
  CloudOff,
  Home,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Store,
  Trash2,
  User,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Product } from '@/lib/pos-api';
import { formatAmount } from '@/lib/purchasing/utils';
import { formatArkAmount } from '@/lib/pos/loyalty-settings';
import {
  DEFAULT_BILLING_CHARGES,
  calculateBillCharges,
  resolveEnabledOptionalCodes,
} from '@/lib/pos/billing-settings';
import { canSellMixedStall, resolveAddCatalogItem } from '@/lib/pos/central-cashier';
import { usePosCart, type PosCartItem } from '@/hooks/use-pos-cart';
import { usePosProducts } from '@/hooks/use-pos-products';
import { usePosCheckout } from '@/hooks/use-pos-checkout';
import { usePosCustomers } from '@/hooks/use-pos-customers';
import { usePosShift } from '@/hooks/use-pos-shift';
import { usePosOnline } from '@/hooks/use-pos-online';
import { usePosOfflineQueue } from '@/hooks/use-pos-offline';
import {
  buildOfflineOrderPayload,
  canPayOffline,
  isOfflineReceiptNumber,
  offlineReceiptNumber,
} from '@/lib/pos/offline-sync';
import { useLoyaltySettings } from '@/features/pos/loyalty-settings';
import { useResolvedBillingProfile } from '@/features/pos/billing-settings';
import {
  useCanUseCentralCashier,
  useConfirmAndSwitchStall,
} from '@/components/pos/confirm-stall-switch-dialog';
import { PaymentModal } from '@/components/pos/PaymentModal';
import { CustomizationModal, type SelectedCustomization } from '@/components/pos/CustomizationModal';
import { printThermalReceipt, type ReceiptPayload } from '@/components/pos/PrintReceipt';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

import { CLASSIC_KEYPAD, CLASSIC_ORDER_TYPES, CLASSIC_PALETTE } from '../constants';
import { PosOfflineRegistrar } from './pos-offline-registrar';

const CASHIER_ID = '00000000-0000-0000-0000-000000000001';
const LAST_RECEIPT_KEY = 'pos:lastReceipt';
const ALL_CATEGORY = 'All';

type OrderType = ReturnType<typeof usePosCart>['orderType'];
type StallOption = { id: string; name: string; code?: string };
type StallInfo = { active: StallOption | null; stalls: StallOption[]; canSwitch: boolean };
const AUTO_STALL_KEY = 'pos-classic:auto-stall';

const fmtRp = (v: number) => `Rp ${formatAmount(v)}`;

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  credit_card: 'Kartu',
  ark_coin: 'ARK Coin',
};

function formatClock(d: Date): string {
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ClassicCashierPage() {
  const router = useRouter();
  const cart = usePosCart();
  // Saklar fitur CRM → Pengaturan: sembunyikan ARK Coin / XP bila dimatikan.
  const { arkCoin: arkEnabled, xp: xpEnabled } = useLoyaltyFeatures();
  const { products, categories, loading: loadingProducts, error: productsError, stallBlockedReason, activeMode } =
    usePosProducts();
  const { customers, refetch: refetchCustomers } = usePosCustomers();
  const { checkout, submitting } = usePosCheckout();
  const shiftState = usePosShift(CASHIER_ID);
  const { isOnline } = usePosOnline();
  const offlineQueue = usePosOfflineQueue();
  const canUseCentralCashier = useCanUseCentralCashier();
  const { data: loyaltySettings } = useLoyaltySettings();
  const billingQuery = useResolvedBillingProfile({});

  const [clock, setClock] = useState('--:--:--');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORY);
  const [buffer, setBuffer] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customizing, setCustomizing] = useState<SelectedCustomization | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showStall, setShowStall] = useState(false);
  const [stallInfo, setStallInfo] = useState<StallInfo | null>(null);
  const {
    confirmAndSwitchStall,
    switching: stallSwitching,
    dialog: stallSwitchDialog,
  } = useConfirmAndSwitchStall();
  const [discardQueueId, setDiscardQueueId] = useState<number | null>(null);
  const [lastReceipt, setLastReceipt] = useState<ReceiptPayload | null>(null);

  /* Jam dinding — hanya diperbarui dari interval, bukan saat render. */
  useEffect(() => {
    const id = window.setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => window.clearInterval(id);
  }, []);

  /* Stall aktif: server menolak transaksi bila user ber-akses semua stall
   * belum memilih satu stall (cookie). Sidebar (tempat switcher biasa)
   * disembunyikan di sini, jadi Classic punya pemilihnya sendiri. */
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/stall-options')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.data) return;
        setStallInfo({
          active: json.data.active ?? null,
          stalls: Array.isArray(json.data.stalls) ? json.data.stalls : [],
          canSwitch: json.data.can_switch !== false,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /* Hanya ada satu stall → pilih otomatis sekali, tanpa bertanya. */
  useEffect(() => {
    if (!stallInfo || stallInfo.active || !stallInfo.canSwitch || stallInfo.stalls.length !== 1) return;
    if (!navigator.onLine) return;
    const only = stallInfo.stalls[0];
    try {
      if (window.sessionStorage.getItem(AUTO_STALL_KEY) === only.id) return;
      window.sessionStorage.setItem(AUTO_STALL_KEY, only.id);
    } catch {
      /* tanpa sessionStorage tetap coba sekali */
    }
    void confirmAndSwitchStall(only.id);
  }, [stallInfo, confirmAndSwitchStall]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }, []);

  const formatArk = useCallback(
    (value: number) => formatArkAmount(value, loyaltySettings?.ark_rate || 1000),
    [loyaltySettings?.ark_rate]
  );

  /* ---------- Katalog ---------- */
  const categoryColor = useMemo(() => {
    const map = new Map<string, (typeof CLASSIC_PALETTE)[number]>();
    categories
      .filter((c) => c !== ALL_CATEGORY)
      .forEach((c, i) => map.set(c, CLASSIC_PALETTE[i % CLASSIC_PALETTE.length]));
    return map;
  }, [categories]);

  const colorOf = useCallback(
    (name: string) => categoryColor.get(name) ?? CLASSIC_PALETTE[0],
    [categoryColor]
  );

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!p.is_active) return false;
      const cat = p.category?.name || 'Uncategorized';
      if (category !== ALL_CATEGORY && cat !== category) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q);
    });
  }, [products, category, search]);

  /* ---------- Keranjang ---------- */
  const selectedItem = useMemo(
    () => cart.items.find((i) => i.id === selectedId) ?? null,
    [cart.items, selectedId]
  );
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === cart.selectedCustomerId) ?? null,
    [customers, cart.selectedCustomerId]
  );
  const bufferValue = Number(buffer) || 0;

  const canSellMixed = canSellMixedStall({
    hasCentralMenu: canUseCentralCashier,
    canCentralCheckout: canUseCentralCashier,
    activeMode: activeMode ?? 'unset',
  });

  const canTransact = shiftState.isActive && !shiftState.loading;
  const requireActiveShift = useCallback(() => {
    if (canTransact) return true;
    toast.error('Shift belum dibuka — buka shift dulu di POS utama');
    return false;
  }, [canTransact]);

  const tryAddCatalogItem = useCallback(
    (product: Product, item: Omit<PosCartItem, 'warehouse_id' | 'warehouse_name'>) => {
      const check = resolveAddCatalogItem({
        canSellMixed,
        existingStallIds: cart.items
          .map((row) => row.warehouse_id)
          .filter((id): id is string => Boolean(id)),
        incomingWarehouseId: product.warehouse_id,
        centralAllMode: canUseCentralCashier && activeMode === 'all',
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
      setSelectedId(item.id);
      return true;
    },
    [activeMode, canSellMixed, canUseCentralCashier, cart]
  );

  const handleProductTap = useCallback(
    (product: Product) => {
      if (!requireActiveShift()) return;
      if (!product.is_available) {
        toast.error(`${product.name} sedang tidak tersedia`);
        return;
      }
      if (product.product_kind === 'gift_card') {
        toast.message('Penjualan gift card tersedia di POS utama');
        return;
      }
      if (
        product.product_kind === 'merchandise' &&
        (product.skus ?? []).some((sku) => sku.is_active !== false)
      ) {
        toast.message('Merchandise ber-varian SKU tersedia di POS utama');
        return;
      }
      const qty = bufferValue > 0 ? bufferValue : 1;
      setBuffer('');

      if ((product.variants?.length ?? 0) > 0 || (product.modifiers?.length ?? 0) > 0) {
        const defaultModifiers: Record<string, string[]> = {};
        product.modifiers?.forEach((g) => {
          if (g.modifier_group.modifiers.length > 0) {
            defaultModifiers[g.modifier_group.name] = [g.modifier_group.modifiers[0].id];
          }
        });
        setCustomizing({
          product,
          selectedVariant: product.variants?.[0]?.id ?? null,
          selectedModifiers: defaultModifiers,
          quantity: qty,
          notes: '',
        });
        return;
      }

      tryAddCatalogItem(product, {
        id: product.id,
        productId: product.id,
        name: product.name,
        price: product.base_price,
        quantity: qty,
        imageUrl: product.image_url,
        station: product.station,
        stallName: product.stall_name ?? undefined,
      });
    },
    [bufferValue, requireActiveShift, tryAddCatalogItem]
  );

  /* Komposisi item ber-varian/modifier — identik dengan POS utama supaya
   * struk & KDS membaca format yang sama. */
  const handleConfirmCustomization = useCallback(() => {
    if (!customizing) return;
    const product = customizing.product;
    const { variantName, variantAdj, modifierNames, modifierAdj, unitPrice: finalPrice } =
      computeCustomizationPrice(product, customizing);
    const compositeId = `${product.id}::${variantName ?? ''}::${modifierNames.join(',')}`;
    const ok = tryAddCatalogItem(product, {
      id: compositeId,
      productId: product.id,
      name: product.name,
      price: finalPrice,
      quantity: customizing.quantity,
      variantName,
      modifierNames,
      variantPriceAdj: variantAdj,
      modifierPriceAdj: modifierAdj,
      notes: customizing.notes,
      imageUrl: product.image_url,
      station: product.station,
      stallName: product.stall_name ?? product.warehouse_name ?? undefined,
    });
    if (ok) setCustomizing(null);
  }, [customizing, tryAddCatalogItem]);

  const changeQty = useCallback(
    (item: PosCartItem, delta: number) => {
      if (item.quantity + delta <= 0) {
        cart.removeItem(item.id);
        setSelectedId(null);
        return;
      }
      cart.updateQty(item.id, delta);
    },
    [cart]
  );

  const pressKey = useCallback((key: string) => {
    if (key === 'C') {
      setBuffer('');
      return;
    }
    setBuffer((prev) => (prev + key).replace(/^0+(?=\d)/, '').slice(0, 9));
  }, []);

  const applyQty = useCallback(() => {
    if (!selectedItem) {
      toast.message('Pilih item di tiket dulu, lalu ketik jumlah');
      return;
    }
    if (bufferValue <= 0) {
      toast.message('Ketik jumlah di keypad dulu');
      return;
    }
    cart.updateQty(selectedItem.id, bufferValue - selectedItem.quantity);
    setBuffer('');
  }, [bufferValue, cart, selectedItem]);

  const applyDiscount = useCallback(
    (type: 'percent' | 'fixed') => {
      if (bufferValue <= 0) {
        cart.setManualDiscount(null, null);
        setBuffer('');
        toast.message('Diskon transaksi dihapus');
        return;
      }
      const value = type === 'percent' ? Math.min(100, bufferValue) : bufferValue;
      cart.setManualDiscount(type, value);
      setBuffer('');
      toast.success(type === 'percent' ? `Diskon ${value}% diterapkan` : `Diskon ${fmtRp(value)} diterapkan`);
    },
    [bufferValue, cart]
  );

  const removeSelected = useCallback(() => {
    if (!selectedItem) {
      toast.message('Pilih item di tiket dulu');
      return;
    }
    cart.removeItem(selectedItem.id);
    setSelectedId(null);
  }, [cart, selectedItem]);

  const clearAll = useCallback(() => {
    cart.clearCart();
    setSelectedId(null);
    setBuffer('');
    setConfirmClear(false);
  }, [cart]);

  /* ---------- Tagihan ---------- */
  const billingCharges = useMemo(
    () => (billingQuery.data?.charges?.length ? billingQuery.data.charges : DEFAULT_BILLING_CHARGES),
    [billingQuery.data?.charges]
  );
  const membershipDiscount = selectedCustomer?.discount ?? 0;
  /* Tumpukan diskon: item → member → manual transaksi (tanpa promo/offer di
   * versi Classic). Hasilnya dibekukan supaya callback pembayaran stabil. */
  const buildDiscountStack = cart.buildDiscountStack;
  const discountStack = useMemo(
    () => buildDiscountStack(membershipDiscount, 0, 0),
    [buildDiscountStack, membershipDiscount]
  );
  const billCharges = useMemo(
    () =>
      calculateBillCharges({
        subtotalAfterDiscount: discountStack.after_discount,
        charges: billingCharges,
        enabledOptionalCodes: resolveEnabledOptionalCodes(billingCharges, cart.includeTax, cart.includeService),
      }),
    [billingCharges, cart.includeService, cart.includeTax, discountStack.after_discount]
  );
  const discountAmount = discountStack.discount_amount;
  const total = billCharges.total;

  /* ---------- Pembayaran ---------- */
  const openPayment = useCallback(() => {
    if (cart.items.length === 0) {
      toast.message('Tiket masih kosong');
      return;
    }
    if (!requireActiveShift()) return;
    setShowPayment(true);
  }, [cart.items.length, requireActiveShift]);

  const handleConfirmPayment = useCallback(
    async (payload: Parameters<NonNullable<React.ComponentProps<typeof PaymentModal>['onConfirm']>>[0]) => {
      if (submitting) return;

      /* Offline: simpan ke antrian IndexedDB, struk sementara OFFLINE-…;
       * dikirim otomatis saat koneksi pulih (usePosOfflineQueue). */
      if (!isOnline) {
        if (!canPayOffline(payload.method)) {
          toast.error('Metode ini butuh koneksi — saat offline pakai tunai, QRIS, atau kartu');
          return;
        }
        const orderPayload = buildOfflineOrderPayload({
          items: cart.items,
          orderType: cart.orderType,
          cashierId: CASHIER_ID,
          customerId: selectedCustomer?.id ?? null,
          method: payload.method,
          cashReceived: payload.cashReceived,
          discountStack,
          billCharges,
          includeTax: cart.includeTax,
          membershipDiscountPct: membershipDiscount,
          manualDiscountType: cart.manual_discount_type,
          manualDiscountValue: cart.manual_discount_value,
          notes: cart.notes,
          shiftId: shiftState.shift?.id ?? null,
          paymentMethodCode: payload.paymentMethodCode,
          paymentMethodName: payload.paymentMethodName,
        });
        await offlineQueue.enqueue(orderPayload, 'order');
        const offlineNumber = offlineReceiptNumber(Date.now());
        const cash = Number.parseFloat(payload.cashReceived);
        const receipt: ReceiptPayload = {
          orderId: offlineNumber,
          orderNumber: offlineNumber,
          orderType: cart.orderType,
          table: null,
          items: [...cart.items],
          notes: cart.notes,
          subtotal: discountStack.items_subtotal,
          total,
          change: payload.method === 'cash' && Number.isFinite(cash) ? Math.max(0, cash - total) : 0,
          paymentMethod: payload.paymentMethodName ?? PAYMENT_LABEL[payload.method] ?? payload.method,
          customerName: selectedCustomer?.name,
          discountAmount,
          taxAmount: billCharges.tax_amount,
          chargesBreakdown: billCharges.breakdown,
          arkPaid: 0,
        };
        try {
          window.sessionStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(receipt));
        } catch {
          /* struk tetap tampil di layar */
        }
        toast.success('Tersimpan offline — dikirim otomatis saat koneksi pulih');
        setShowPayment(false);
        setLastReceipt(receipt);
        cart.clearCart();
        setSelectedId(null);
        setBuffer('');
        return;
      }

      const res = await checkout({
        cart: cart.items,
        orderType: cart.orderType,
        selectedTable: null,
        selectedCustomer: selectedCustomer
          ? { id: selectedCustomer.id, discount: selectedCustomer.discount, is_kol: selectedCustomer.is_kol }
          : null,
        paymentMethod: payload.method,
        cashReceived: payload.cashReceived,
        includeTax: cart.includeTax,
        notes: cart.notes,
        arkToUse: payload.arkToUse,
        shiftId: shiftState.shift?.id ?? null,
        billCharges,
        manualDiscountType: cart.manual_discount_type,
        manualDiscountValue: cart.manual_discount_value,
        paymentMethodCode: payload.paymentMethodCode,
        paymentMethodName: payload.paymentMethodName,
        supervisorPin: payload.supervisorPin,
      });
      if (!res.success) {
        toast.error(res.error || 'Pembayaran gagal');
        return;
      }
      const receipt: ReceiptPayload = {
        orderId: res.orderId,
        orderNumber: res.orderNumber,
        checkoutNumber: res.checkoutNumber,
        queueNumber: res.queueNumber ?? null,
        orderType: cart.orderType,
        table: null,
        items: [...cart.items],
        notes: cart.notes,
        subtotal: discountStack.items_subtotal,
        total: res.total,
        change: res.change,
        paymentMethod: payload.paymentMethodName ?? PAYMENT_LABEL[payload.method] ?? payload.method,
        customerName: selectedCustomer?.name,
        discountAmount,
        taxAmount: billCharges.tax_amount,
        chargesBreakdown: billCharges.breakdown,
        arkPaid: payload.arkToUse,
        arkBalanceAfter: res.arkBalanceAfter ?? null,
        xpEarned: xpEnabled ? res.xpEarned : undefined,
        xpTotalAfter: xpEnabled ? (res.xpTotalAfter ?? null) : null,
      };
      try {
        window.sessionStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(receipt));
      } catch {
        /* sessionStorage bisa terkunci (mode privat) — struk tetap tampil di layar */
      }
      toast.success(res.queueNumber ? `Lunas — Antrian ${res.queueNumber}` : 'Pembayaran berhasil');
      if (selectedCustomer) void refetchCustomers();
      setShowPayment(false);
      setLastReceipt(receipt);
      cart.clearCart();
      setSelectedId(null);
      setBuffer('');
    },
    [
      billCharges,
      cart,
      checkout,
      discountAmount,
      discountStack,
      isOnline,
      membershipDiscount,
      offlineQueue,
      refetchCustomers,
      selectedCustomer,
      shiftState.shift?.id,
      submitting,
      total,
      xpEnabled,
    ]
  );

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    const list = q
      ? customers.filter(
          (c) => (c.name || '').toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q)
        )
      : customers;
    return list.slice(0, 40);
  }, [customers, customerSearch]);

  const blockedMessage =
    stallBlockedReason ||
    (stallInfo && !stallInfo.active && stallInfo.stalls.length > 1
      ? 'Pilih stall aktif dulu (tombol Stall di kanan atas) — server menolak transaksi sebelum stall dipilih.'
      : null) ||
    (shiftState.enabled && !shiftState.isActive && !shiftState.loading
      ? 'Shift belum dibuka — buka shift dulu di POS utama, lalu kembali ke sini.'
      : null);

  const keypadDisplay = buffer ? formatAmount(bufferValue) : '0';

  return (
    <div className="fixed inset-0 z-30 flex flex-col overflow-hidden bg-slate-900 text-slate-100 select-none">
      <PosOfflineRegistrar />
      {/* ===== Header ===== */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-700 bg-slate-950 px-4">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-black tracking-wide text-amber-400">POS Classic</span>
          <span className="text-xs uppercase tracking-widest text-slate-400">BCD Coffee</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => (stallInfo?.canSwitch ? setShowStall(true) : undefined)}
            disabled={!stallInfo || stallSwitching}
            className={cn(
              'flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold',
              stallInfo && !stallInfo.active
                ? 'bg-rose-600 text-white hover:bg-rose-500'
                : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            )}
            title="Stall aktif"
          >
            <Store className="h-4 w-4" />
            {stallSwitching ? 'Mengganti…' : stallInfo?.active ? stallInfo.active.name : stallInfo ? 'Pilih stall' : 'Stall…'}
          </button>
          <span
            className={cn(
              'flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold',
              isOnline ? 'bg-emerald-900/60 text-emerald-300' : 'bg-rose-900/60 text-rose-300'
            )}
          >
            {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {isOnline ? 'Online' : 'Offline'}
          </span>
          {offlineQueue.queueItems.length > 0 || offlineQueue.isSyncing ? (
            <button
              type="button"
              onClick={() => setShowQueue(true)}
              className={cn(
                'flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-bold',
                offlineQueue.failedCount > 0 ? 'bg-rose-600 text-white' : 'bg-amber-500 text-slate-900'
              )}
            >
              {offlineQueue.isSyncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CloudOff className="h-4 w-4" />
              )}
              {offlineQueue.isSyncing ? 'Mengirim…' : `${offlineQueue.pendingCount} menunggu sinkron`}
              {offlineQueue.failedCount > 0 ? ` · ${offlineQueue.failedCount} gagal` : ''}
            </button>
          ) : null}
          <span className="rounded-md bg-slate-800 px-3 py-1 font-mono text-lg tabular-nums text-slate-100">
            {clock}
          </span>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
            title={isFullscreen ? 'Keluar layar penuh' : 'Layar penuh'}
          >
            {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="flex h-10 items-center gap-2 rounded-lg bg-slate-800 px-3 text-sm font-semibold text-slate-200 hover:bg-slate-700"
          >
            <Home className="h-4 w-4" /> Beranda
          </button>
        </div>
      </header>

      {blockedMessage ? (
        <div className="shrink-0 bg-rose-600 px-4 py-2 text-center text-sm font-semibold text-white">
          {blockedMessage}
        </div>
      ) : null}
      {!isOnline ? (
        <div className="shrink-0 bg-amber-500 px-4 py-1.5 text-center text-sm font-semibold text-slate-900">
          Mode offline — transaksi disimpan di perangkat ini dan dikirim otomatis saat koneksi pulih.
          Tunai / QRIS / kartu saja; ARK, gift card, dan NFC butuh koneksi.
        </div>
      ) : null}

      {/* ===== Body ===== */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,34%)_1fr]">
        {/* ----- Tiket order ----- */}
        <section className="flex min-h-0 flex-col border-r border-slate-700 bg-white text-slate-900">
          <div className="grid grid-cols-3 gap-1 p-2">
            {CLASSIC_ORDER_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => cart.setOrderType(t.value as OrderType)}
                className={cn(
                  'h-12 rounded-lg text-sm font-bold uppercase tracking-wide transition',
                  cart.orderType === t.value
                    ? 'bg-slate-900 text-white shadow'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowCustomer(true)}
            className="mx-2 flex h-12 items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-3 text-left hover:bg-slate-50"
          >
            <User className="h-5 w-5 text-slate-500" />
            <span className="truncate text-sm font-semibold">
              {selectedCustomer ? selectedCustomer.name || selectedCustomer.phone : 'Pelanggan Umum'}
            </span>
            {selectedCustomer && membershipDiscount > 0 ? (
              <span className="ml-auto rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                -{membershipDiscount}%
              </span>
            ) : null}
          </button>

          <div className="mt-2 grid grid-cols-[3.5rem_1fr_7rem] border-y border-slate-200 bg-slate-100 px-2 py-1 text-xs font-bold uppercase tracking-wide text-slate-500">
            <span>Qty</span>
            <span>Item</span>
            <span className="text-right">Total</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {cart.items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-slate-400">
                <span className="text-4xl">🧾</span>
                <span className="text-sm font-medium">Tiket kosong — sentuh produk untuk menambah</span>
              </div>
            ) : (
              cart.items.map((item) => {
                const active = item.id === selectedId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(active ? null : item.id)}
                    className={cn(
                      'grid min-h-16 w-full grid-cols-[3.5rem_1fr_7rem] items-center border-b border-slate-100 px-2 py-2 text-left transition',
                      active ? 'bg-amber-100 ring-2 ring-inset ring-amber-500' : 'hover:bg-slate-50'
                    )}
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-base font-black text-white">
                      {item.quantity}
                    </span>
                    <span className="min-w-0 pr-2">
                      <span className="block truncate text-sm font-bold">{item.name}</span>
                      {item.variantName || (item.modifierNames?.length ?? 0) > 0 ? (
                        <span className="block truncate text-xs text-slate-500">
                          {[item.variantName, ...(item.modifierNames ?? [])].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                      <span className="block text-xs text-slate-500">@ {fmtRp(item.price)}</span>
                    </span>
                    <span className="text-right text-sm font-black tabular-nums">
                      {formatAmount(item.price * item.quantity)}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {selectedItem ? (
            <div className="grid grid-cols-3 gap-1 border-t border-slate-200 bg-amber-50 p-2">
              <button
                type="button"
                onClick={() => changeQty(selectedItem, -1)}
                className="flex h-12 items-center justify-center rounded-lg bg-white text-slate-900 shadow hover:bg-slate-100"
              >
                <Minus className="h-6 w-6" />
              </button>
              <div className="flex h-12 items-center justify-center rounded-lg bg-white text-xl font-black shadow">
                {selectedItem.quantity}
              </div>
              <button
                type="button"
                onClick={() => changeQty(selectedItem, 1)}
                className="flex h-12 items-center justify-center rounded-lg bg-white text-slate-900 shadow hover:bg-slate-100"
              >
                <Plus className="h-6 w-6" />
              </button>
            </div>
          ) : null}

          <div className="border-t-2 border-slate-900 bg-slate-50 px-3 py-2 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span className="tabular-nums">{fmtRp(discountStack.items_subtotal)}</span>
            </div>
            {discountAmount > 0 ? (
              <div className="flex justify-between text-rose-600">
                <span>Diskon</span>
                <span className="tabular-nums">- {fmtRp(discountAmount)}</span>
              </div>
            ) : null}
            {billCharges.breakdown
              .filter((line) => line.amount !== 0)
              .map((line) => (
                <div key={line.code} className="flex justify-between text-slate-600">
                  <span>{line.name}</span>
                  <span className="tabular-nums">{fmtRp(line.amount)}</span>
                </div>
              ))}
            <div className="mt-1 flex items-end justify-between border-t border-slate-300 pt-1">
              <span className="text-base font-bold uppercase tracking-wide">Total</span>
              <span className="text-3xl font-black tabular-nums text-slate-900">{fmtRp(total)}</span>
            </div>
          </div>
        </section>

        {/* ----- Katalog + kontrol ----- */}
        <section className="flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center gap-2 p-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari produk / SKU…"
                className="h-12 w-full rounded-lg border border-slate-700 bg-slate-800 pl-10 pr-10 text-base text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 gap-2 overflow-x-auto px-2 pb-2">
            <button
              type="button"
              onClick={() => setCategory(ALL_CATEGORY)}
              className={cn(
                'h-16 min-w-32 shrink-0 rounded-xl px-4 text-base font-black uppercase tracking-wide transition active:scale-95',
                category === ALL_CATEGORY
                  ? 'bg-white text-slate-900 shadow-lg'
                  : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
              )}
            >
              Semua
            </button>
            {categories
              .filter((c) => c !== ALL_CATEGORY)
              .map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    'h-16 min-w-32 shrink-0 rounded-xl px-4 text-base font-black uppercase tracking-wide text-white transition active:scale-95',
                    colorOf(c).tile,
                    category === c ? 'ring-4 ring-white/90 shadow-lg' : 'opacity-80 hover:opacity-100'
                  )}
                >
                  {c}
                </button>
              ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {loadingProducts ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-800" />
                ))}
              </div>
            ) : productsError ? (
              <div className="rounded-xl bg-rose-900/50 p-4 text-sm text-rose-200">{productsError}</div>
            ) : visibleProducts.length === 0 ? (
              <div className="flex h-full items-center justify-center text-slate-500">Tidak ada produk</div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {visibleProducts.map((p) => {
                  const color = colorOf(p.category?.name || 'Uncategorized');
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleProductTap(p)}
                      className={cn(
                        'flex h-28 flex-col justify-between rounded-2xl p-3 text-left text-white shadow-md transition active:scale-95',
                        color.tile,
                        !p.is_available && 'opacity-40 grayscale'
                      )}
                    >
                      <span className="line-clamp-2 text-base font-bold leading-tight">{p.name}</span>
                      <span className="flex items-end justify-between">
                        <span className="text-sm font-semibold text-white/90">{fmtRp(p.base_price)}</span>
                        {(p.variants?.length ?? 0) > 0 || (p.modifiers?.length ?? 0) > 0 ? (
                          <span className="rounded bg-black/25 px-1.5 py-0.5 text-[10px] font-bold uppercase">
                            Opsi
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ----- Deck kontrol ----- */}
          <div className="grid shrink-0 grid-cols-[auto_1fr] gap-2 border-t border-slate-700 bg-slate-950 p-2">
            <div className="flex gap-2">
              <div className="flex flex-col gap-1">
                <div className="flex h-12 items-center justify-end rounded-lg bg-black px-3 font-mono text-2xl font-bold tabular-nums text-lime-300">
                  {keypadDisplay}
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {CLASSIC_KEYPAD.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => pressKey(k)}
                      className={cn(
                        'h-14 w-16 rounded-lg text-xl font-black transition active:scale-95',
                        k === 'C'
                          ? 'bg-rose-700 text-white hover:bg-rose-600'
                          : 'bg-slate-700 text-slate-100 hover:bg-slate-600'
                      )}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={applyQty}
                  className="h-[4.25rem] w-24 rounded-lg bg-sky-700 text-sm font-black uppercase leading-tight text-white hover:bg-sky-600 active:scale-95"
                >
                  Qty
                </button>
                <button
                  type="button"
                  onClick={removeSelected}
                  className="h-[4.25rem] w-24 rounded-lg bg-orange-700 text-sm font-black uppercase leading-tight text-white hover:bg-orange-600 active:scale-95"
                >
                  Hapus Item
                </button>
                <button
                  type="button"
                  onClick={() => applyDiscount('percent')}
                  className="h-[4.25rem] w-24 rounded-lg bg-violet-700 text-sm font-black uppercase leading-tight text-white hover:bg-violet-600 active:scale-95"
                >
                  Diskon %
                </button>
                <button
                  type="button"
                  onClick={() => applyDiscount('fixed')}
                  className="h-[4.25rem] w-24 rounded-lg bg-violet-800 text-sm font-black uppercase leading-tight text-white hover:bg-violet-700 active:scale-95"
                >
                  Diskon Rp
                </button>
                <button
                  type="button"
                  onClick={() => (cart.items.length ? setConfirmClear(true) : undefined)}
                  className="col-span-2 h-[4.25rem] rounded-lg bg-rose-800 text-sm font-black uppercase text-white hover:bg-rose-700 active:scale-95"
                >
                  Batalkan Tiket
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={openPayment}
              disabled={cart.items.length === 0}
              className="flex flex-col items-center justify-center rounded-xl bg-emerald-600 text-white shadow-lg transition hover:bg-emerald-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              <span className="text-2xl font-black uppercase tracking-widest">Bayar</span>
              <span className="text-3xl font-black tabular-nums">{fmtRp(total)}</span>
              <span className="text-xs font-semibold uppercase tracking-wide opacity-80">
                {cart.itemCount} item
              </span>
            </button>
          </div>
        </section>
      </div>

      {/* ===== Modal ===== */}
      <CustomizationModal
        showArk={arkEnabled}
        open={customizing !== null}
        product={customizing?.product ?? null}
        value={customizing}
        onChange={setCustomizing}
        onConfirm={handleConfirmCustomization}
        onCancel={() => setCustomizing(null)}
        formatCurrency={fmtRp}
        formatArk={formatArk}
      />

      <PaymentModal
        open={showPayment}
        total={total}
        totalAfterArk={total}
        selectedCustomer={
          selectedCustomer
            ? { id: selectedCustomer.id, name: selectedCustomer.name, ark_coin_balance: selectedCustomer.ark_coin_balance }
            : null
        }
        onClose={() => setShowPayment(false)}
        onConfirm={handleConfirmPayment}
        submitting={submitting}
        formatCurrency={fmtRp}
        formatArk={formatArk}
        onTapNFC={() => toast.message('Tap kartu member belum tersedia di POS Classic — pilih lewat tombol Pelanggan')}
      />

      <Dialog open={showCustomer} onOpenChange={setShowCustomer}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pilih Pelanggan</DialogTitle>
          </DialogHeader>
          <input
            autoFocus
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            placeholder="Cari nama / nomor HP…"
            className="h-12 w-full rounded-lg border px-3 text-base"
          />
          <div className="max-h-80 space-y-1 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                cart.setCustomer(null);
                setShowCustomer(false);
              }}
              className="flex h-12 w-full items-center rounded-lg bg-slate-100 px-3 text-left font-semibold hover:bg-slate-200"
            >
              Pelanggan Umum (tanpa member)
            </button>
            {filteredCustomers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  cart.setCustomer(c.id);
                  setShowCustomer(false);
                }}
                className={cn(
                  'flex h-12 w-full items-center justify-between rounded-lg px-3 text-left hover:bg-amber-50',
                  c.id === cart.selectedCustomerId && 'bg-amber-100'
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{c.name || c.phone}</span>
                  <span className="block text-xs text-slate-500">
                    {c.phone} · {c.membership_tier}
                  </span>
                </span>
                {c.discount > 0 ? (
                  <span className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">-{c.discount}%</span>
                ) : null}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showStall} onOpenChange={setShowStall}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pilih Stall Aktif</DialogTitle>
          </DialogHeader>
          {!isOnline ? (
            <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
              Ganti stall butuh koneksi — pilihan tersimpan di server.
            </p>
          ) : null}
          <div className="space-y-2">
            {(stallInfo?.stalls ?? []).map((stall) => (
              <button
                key={stall.id}
                type="button"
                disabled={!isOnline || stallSwitching}
                onClick={() => {
                  setShowStall(false);
                  void confirmAndSwitchStall(stall.id);
                }}
                className={cn(
                  'flex h-14 w-full items-center justify-between rounded-lg px-4 text-left text-base font-semibold hover:bg-amber-50 disabled:opacity-50',
                  stallInfo?.active?.id === stall.id ? 'bg-amber-100 ring-2 ring-amber-500' : 'bg-slate-100'
                )}
              >
                <span>{stall.name}</span>
                {stall.code ? <span className="text-xs text-slate-500">{stall.code}</span> : null}
              </button>
            ))}
            {stallInfo && stallInfo.stalls.length === 0 ? (
              <p className="text-sm text-slate-500">Tidak ada stall yang bisa dipilih untuk akun ini.</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      {stallSwitchDialog}

      <Dialog open={showQueue} onOpenChange={setShowQueue}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Antrian Transaksi Offline</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500">
            {offlineQueue.pendingCount} menunggu dikirim
            {offlineQueue.failedCount > 0 ? `, ${offlineQueue.failedCount} ditolak server` : ''}.
            Pengiriman berjalan otomatis saat online; tombol di bawah untuk memaksa sekarang.
          </p>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {offlineQueue.queueItems.length === 0 ? (
              <div className="rounded-lg bg-slate-100 p-4 text-center text-sm text-slate-500">
                Antrian kosong — semua transaksi sudah masuk server.
              </div>
            ) : (
              offlineQueue.queueItems.map((item) => {
                const payload = item.orderPayload ?? {};
                const itemCount = Array.isArray(payload.items)
                  ? payload.items.reduce((n: number, it: { quantity?: number }) => n + (Number(it.quantity) || 0), 0)
                  : 0;
                return (
                  <div
                    key={item.queueId}
                    className={cn(
                      'rounded-lg border p-3 text-sm',
                      item.status === 'failed' ? 'border-rose-300 bg-rose-50' : 'border-slate-200'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">
                        {new Date(item.createdAt).toLocaleString('id-ID', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {' · '}
                        {itemCount} item · {fmtRp(Number(payload.total_amount) || 0)}
                      </span>
                      <span
                        className={cn(
                          'rounded px-2 py-0.5 text-xs font-bold uppercase',
                          item.status === 'failed'
                            ? 'bg-rose-600 text-white'
                            : item.status === 'syncing'
                              ? 'bg-sky-600 text-white'
                              : 'bg-amber-500 text-slate-900'
                        )}
                      >
                        {item.status === 'failed' ? 'Ditolak' : item.status === 'syncing' ? 'Mengirim' : 'Menunggu'}
                      </span>
                    </div>
                    {item.errorMessage ? (
                      <div className="mt-1 text-xs text-rose-700">{item.errorMessage}</div>
                    ) : null}
                    {item.status === 'failed' && item.queueId != null ? (
                      <button
                        type="button"
                        onClick={() => setDiscardQueueId(item.queueId ?? null)}
                        className="mt-2 flex h-9 items-center gap-1 rounded-md bg-white px-3 text-xs font-bold text-rose-700 ring-1 ring-rose-300 hover:bg-rose-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Buang transaksi ini
                      </button>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!isOnline || offlineQueue.isSyncing || offlineQueue.pendingCount === 0}
              onClick={async () => {
                const { synced, failed } = await offlineQueue.syncQueue();
                toast.message(`Sinkron selesai: ${synced} terkirim, ${failed} ditolak`);
              }}
              className="flex h-12 items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-500 disabled:bg-slate-300 disabled:text-slate-500"
            >
              <RefreshCw className={cn('h-4 w-4', offlineQueue.isSyncing && 'animate-spin')} /> Sinkron Sekarang
            </button>
            <button
              type="button"
              disabled={!isOnline || offlineQueue.isSyncing || offlineQueue.failedCount === 0}
              onClick={async () => {
                const { synced, failed } = await offlineQueue.retryFailed();
                toast.message(`Coba lagi: ${synced} terkirim, ${failed} masih ditolak`);
              }}
              className="h-12 rounded-lg bg-amber-500 text-sm font-bold text-slate-900 hover:bg-amber-400 disabled:bg-slate-300 disabled:text-slate-500"
            >
              Coba Lagi yang Ditolak
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discardQueueId !== null} onOpenChange={(open) => (!open ? setDiscardQueueId(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Buang transaksi offline ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Transaksi TIDAK akan pernah masuk ke server — penjualan dan pemakaian stoknya hilang dari
              laporan. Lakukan hanya bila transaksi memang batal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-12 px-6 text-base">Kembali</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (discardQueueId !== null) await offlineQueue.discardItem(discardQueueId);
                setDiscardQueueId(null);
              }}
              className="h-12 bg-rose-600 px-6 text-base hover:bg-rose-500"
            >
              Ya, Buang
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan tiket ini?</AlertDialogTitle>
            <AlertDialogDescription>
              {cart.itemCount} item akan dihapus dari tiket. Transaksi belum tersimpan, jadi tidak ada void yang tercatat.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-12 px-6 text-base">Kembali</AlertDialogCancel>
            <AlertDialogAction onClick={clearAll} className="h-12 bg-rose-600 px-6 text-base hover:bg-rose-500">
              Ya, Batalkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {lastReceipt ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/90 p-6">
          <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center text-slate-900 shadow-2xl">
            <CheckCircle2 className="mx-auto h-20 w-20 text-emerald-500" />
            <h2 className="mt-3 text-2xl font-black">Pembayaran Berhasil</h2>
            <p className="mt-1 text-sm text-slate-500">
              {lastReceipt.orderNumber}
              {lastReceipt.queueNumber ? ` · Antrian ${lastReceipt.queueNumber}` : ''}
            </p>
            {isOfflineReceiptNumber(lastReceipt.orderNumber) ? (
              <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900">
                Tersimpan offline. Nomor order resmi terbit saat transaksi terkirim ke server.
              </p>
            ) : null}
            <div className="mt-5 grid grid-cols-2 gap-3 text-left">
              <div className="rounded-xl bg-slate-100 p-3">
                <div className="text-xs uppercase text-slate-500">Total</div>
                <div className="text-xl font-black tabular-nums">{fmtRp(lastReceipt.total)}</div>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3">
                <div className="text-xs uppercase text-emerald-700">Kembalian</div>
                <div className="text-xl font-black tabular-nums text-emerald-700">
                  {fmtRp(Math.max(0, lastReceipt.change))}
                </div>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void printThermalReceipt(lastReceipt, 'CUSTOMER')}
                className="flex h-16 items-center justify-center gap-2 rounded-xl bg-slate-900 text-lg font-bold text-white hover:bg-slate-800"
              >
                <Printer className="h-5 w-5" /> Cetak Struk
              </button>
              <button
                type="button"
                onClick={() => setLastReceipt(null)}
                className="h-16 rounded-xl bg-emerald-600 text-lg font-bold text-white hover:bg-emerald-500"
              >
                Transaksi Baru
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
