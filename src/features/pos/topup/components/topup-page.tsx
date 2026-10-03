'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Check,
  Coins,
  Gift,
  History,
  Loader2,
  MessageCircle,
  Printer,
  QrCode,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CustomerSearchModal } from '@/components/pos/CustomerSearchModal';
import {
  findCustomerByCard,
  POS_NFC_CARD_EVENT,
  usePosNfcOptional,
} from '@/features/pos/nfc';
import { saveCustomer } from '@/lib/pos-api';
import type { CustomerWithDiscount } from '@/hooks/use-pos-customers';
import { cn } from '@/lib/utils';
import type {
  PaymentMethod,
  TopupCustomer,
  TopupHistoryItem,
  TopupResult,
  TopupStatus,
} from '../types';
import { useTopupCustomers, useTopupHistory } from '../queries';
import { TopupMemberFinder } from './topup-member-finder';
import { QrisCard } from '@/components/pos/QrisCard';
import { useCancelTopup, useProcessTopup } from '../mutations';
import { buildTopupQrImageUrl, fetchTopupStatus, listTopupCustomers } from '../api';
import { printTopupReceipt } from '../print-topup-receipt';
import { useLoyaltySettings } from '@/features/pos/loyalty-settings';
import { formatArkAmount } from '@/lib/pos/loyalty-settings';
import { isCreditEntry } from '@/lib/wallet/ledger';
import { TopupPackagePicker } from '@/features/wallet/components/topup-package-picker';
import type { TopupPackage } from '@/features/wallet/api';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value || 0);

function parseAmountInput(raw: string) {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return 0;
  return Number.parseInt(digits, 10) || 0;
}

export function TopupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cardParam = searchParams.get('card');
  const cardHandledRef = useRef<string | null>(null);

  const [step, setStep] = useState<TopupStatus>('idle');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customer, setCustomer] = useState<TopupCustomer | null>(null);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [topupRp, setTopupRp] = useState(0);
  const [customRp, setCustomRp] = useState('');
  // Paket top-up terpilih (harga = topupRp, saldo diterima = credit_idr).
  const [topupPackage, setTopupPackage] = useState<TopupPackage | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>('qris');
  // PIN supervisor utk metode FOC (topup gratis — marketing).
  const [focPin, setFocPin] = useState('');
  const [showReceipt, setShowReceipt] = useState(false);
  const [waSending, setWaSending] = useState(false);
  const [waSentTo, setWaSentTo] = useState<string | null>(null);

  /* Kirim bukti top-up via WA (fitur WA struk). Top-up selalu ber-member,
   * jadi nomor default = nomor member; endpoint tetap memuat data dari DB. */
  async function sendTopupWa() {
    const topupId = result?.topup_id || result?.transaction?.id || null;
    if (!topupId) {
      toast.error("ID transaksi tidak ditemukan — tidak bisa kirim WA");
      return;
    }
    try {
      setWaSending(true);
      const res = await fetch(`/api/pos/topup/${topupId}/send-wa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Gagal mengirim WA");
      setWaSentTo(json.data?.phone ?? "WA member");
      toast.success(`Bukti top-up terkirim ke ${json.data?.phone ?? "WA member"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengirim WA");
    } finally {
      setWaSending(false);
    }
  }
  const [result, setResult] = useState<TopupResult | null>(null);
  const [error, setError] = useState('');
  const [resolvingCard, setResolvingCard] = useState(false);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [pendingNfcUid, setPendingNfcUid] = useState<string | null>(null);
  const [pendingTopupId, setPendingTopupId] = useState<string | null>(null);
  const [actionTopupId, setActionTopupId] = useState<string | null>(null);

  const { data: customers = [], error: customersError, refetch } =
    useTopupCustomers({ search: customerSearch });
  const {
    data: topupHistory = [],
    isLoading: loadingHistory,
    error: historyError,
    refetch: refetchHistory,
  } = useTopupHistory(customer?.id);
  const topupMutation = useProcessTopup();
  const cancelMutation = useCancelTopup(customer?.id);
  const { data: loyaltySettings } = useLoyaltySettings();
  const posNfc = usePosNfcOptional();
  const setPaymentNfcActive = posNfc?.setPaymentNfcActive;

  const arkRate = loyaltySettings?.ark_rate || 1000;
  const presetValues = loyaltySettings?.topup_presets?.length
    ? loyaltySettings.topup_presets
    : [50000, 100000, 200000, 500000, 1000000];
  const minTopup = loyaltySettings?.topup_min_amount ?? 10000;
  const formatArk = (value: number) => formatArkAmount(value, arkRate);

  const creditRp = topupPackage?.credit_idr ?? topupRp;
  const projectedBalance = customer ? Number(customer.ark_coin_balance || 0) + creditRp : 0;
  const customersErrorMessage = customersError instanceof Error ? customersError.message : '';

  const modalCustomers: CustomerWithDiscount[] = useMemo(
    () =>
      customers.map((item) => ({
        id: item.id,
        phone: item.phone,
        name: item.name || undefined,
        email: item.email || undefined,
        membership_tier: item.membership_tier || 'regular',
        ark_coin_balance: Number(item.ark_coin_balance || 0),
        total_xp: 0,
        total_spent: 0,
        visit_count: 0,
        discount: 0,
        nfc_uid: item.nfc_uid,
      })),
    [customers]
  );

  const clearCardParam = useCallback(() => {
    if (!searchParams.get('card')) return;
    router.replace('/dashboard/pos/topup');
  }, [router, searchParams]);

  const closeCustomerModal = useCallback(() => {
    setShowCustomerModal(false);
    setPendingNfcUid(null);
    setCustomerSearch('');
    cardHandledRef.current = null;
    clearCardParam();
  }, [clearCardParam]);

  function selectCustomer(item: TopupCustomer) {
    setCustomer(item);
    setShowCustomerModal(false);
    setPendingNfcUid(null);
    setCustomerSearch('');
    cardHandledRef.current = null;
    clearCardParam();
    setStep('enter_amount');
    setTopupRp(0);
    setCustomRp('');
    setResult(null);
    setError('');
    setPendingTopupId(null);
  }

  async function handleCreateCustomer(payload: {
    name: string;
    phone: string;
    email?: string;
    enroll_member: boolean;
    nfc_uid?: string;
    is_kol?: boolean;
  }) {
    const response = await saveCustomer({
      name: payload.name,
      phone: payload.phone,
      email: payload.email,
      membership_tier: 'regular',
      enroll_member: payload.enroll_member,
      nfc_uid: payload.nfc_uid,
      is_kol: payload.is_kol,
    });
    await refetch();
    const created = response.data;
    return {
      ...created,
      discount: 0,
    } as CustomerWithDiscount;
  }

  useEffect(() => {
    setPaymentNfcActive?.(true);
    return () => setPaymentNfcActive?.(false);
  }, [setPaymentNfcActive]);

  const resolveScannedCard = useCallback(async (rawCard: string) => {
    const card = rawCard.trim();
    if (!card || cardHandledRef.current === card) return;

    setResolvingCard(true);
    setError('');
    try {
      const list = await listTopupCustomers({});
      const found = findCustomerByCard(list, card);
      cardHandledRef.current = card;
      if (!found) {
        setCustomerSearch('');
        setPendingNfcUid(card.toUpperCase());
        setShowCustomerModal(true);
        toast.message('Kartu belum terdaftar. Pilih customer existing atau buat baru.');
        return;
      }
      toast.success(`Member ${found.name || found.phone} dipilih`);
      selectCustomer(found);
    } catch (err) {
      cardHandledRef.current = card;
      clearCardParam();
      const message = err instanceof Error ? err.message : 'Gagal membaca kartu';
      toast.error(message);
      setError(message);
    } finally {
      setResolvingCard(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearCardParam]);

  useEffect(() => {
    const card = cardParam?.trim();
    if (!card) return;
    void resolveScannedCard(card);
  }, [cardParam, resolveScannedCard]);

  useEffect(() => {
    function onBridgeCard(event: Event) {
      const card = (event as CustomEvent<{ card?: string }>).detail?.card;
      if (!card) return;
      cardHandledRef.current = null;
      void resolveScannedCard(card);
    }

    window.addEventListener(POS_NFC_CARD_EVENT, onBridgeCard);
    return () => window.removeEventListener(POS_NFC_CARD_EVENT, onBridgeCard);
  }, [resolveScannedCard]);

  function selectPackage(pkg: TopupPackage) {
    setTopupPackage(pkg);
    setTopupRp(pkg.price_idr);
    setCustomRp(formatCurrency(pkg.price_idr));
  }

  function selectPreset(value: number) {
    setTopupPackage(null);
    setTopupRp(value);
    setCustomRp(formatCurrency(value));
  }

  function handleCustom(value: string) {
    const amount = parseAmountInput(value);
    setTopupPackage(null);
    setTopupRp(amount);
    setCustomRp(amount > 0 ? formatCurrency(amount) : '');
  }

  function goBack() {
    setError('');
    if (step === 'enter_amount') {
      setStep('idle');
      setCustomer(null);
    } else if (step === 'payment') {
      setStep('enter_amount');
    } else if (step === 'awaiting_qris') {
      setStep('enter_amount');
    }
  }

  async function handleCancelTopup(topupId: string, options?: { goToAmount?: boolean }) {
    if (!topupId || cancelMutation.isPending) return;
    setActionTopupId(topupId);
    try {
      await cancelMutation.mutateAsync(topupId);
      toast.success('Top-up cancelled');
      if (pendingTopupId === topupId) {
        setPendingTopupId(null);
        setResult(null);
        setPayment('qris');
        if (options?.goToAmount !== false) {
          setStep('enter_amount');
        }
      }
      await refetchHistory();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel top-up';
      toast.error(message);
    } finally {
      setActionTopupId(null);
    }
  }

  /** Insiden 2026-09-04: bank sudah terpotong tapi saldo belum masuk →
   * cek langsung ke Xendit dan kredit bila pembayaran tercatat berhasil. */
  async function handleCheckPayment(item: TopupHistoryItem) {
    setActionTopupId(item.id);
    setError('');
    try {
      const res = await fetch(`/api/pos/topup/${item.id}/reconcile`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Gagal mengecek pembayaran');
      if (json.data?.status === 'completed') {
        toast.success(json.message || 'Pembayaran ditemukan — saldo dikredit');
        if (json.data.balance_after !== undefined && pendingTopupId === item.id) {
          finishSuccess(json.data as TopupResult);
        } else if (customer && json.data.balance_after !== undefined) {
          setCustomer({ ...customer, ark_coin_balance: Number(json.data.balance_after) });
        }
      } else {
        toast.message(json.message || 'Belum ada pembayaran tercatat di Xendit');
      }
      await refetchHistory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengecek pembayaran');
    } finally {
      setActionTopupId(null);
    }
  }

  async function handleShowHistoryQr(item: TopupHistoryItem) {
    if (String(item.status || '').toLowerCase() !== 'pending') {
      toast.error('Only pending QRIS top-ups can be shown again');
      return;
    }
    if (String(item.payment_method || '').toLowerCase() !== 'qris') {
      toast.error('This top-up has no QRIS code');
      return;
    }

    setActionTopupId(item.id);
    setError('');
    try {
      const metadataQr = item.metadata?.qr_string ? String(item.metadata.qr_string) : '';
      let qrUrl = metadataQr ? buildTopupQrImageUrl(metadataQr) : null;
      let qrString = metadataQr || null;
      let balanceBefore = Number(item.balance_before) || 0;
      let balanceAfter = Number(item.balance_after) || Number(customer?.ark_coin_balance) || 0;
      let arkCoins = Number(item.ark_coins) || 0;

      if (!qrUrl) {
        const status = await fetchTopupStatus(item.id);
        if (String(status.status || '').toLowerCase() === 'cancelled') {
          toast.error('This top-up was already cancelled');
          await refetchHistory();
          return;
        }
        if (String(status.status || '').toLowerCase() === 'completed') {
          toast.success('Payment already completed');
          finishSuccess(status);
          return;
        }
        qrUrl = status.qr_code_url || null;
        qrString = status.qr_string || null;
        balanceBefore = Number(status.balance_before) || balanceBefore;
        balanceAfter = Number(status.balance_after) || balanceAfter;
        arkCoins = Number(status.ark_coins) || arkCoins;
      }

      if (!qrUrl) {
        toast.error('QR code is no longer available');
        return;
      }

      const amount = Number(item.amount) || 0;
      setTopupPackage(null);
      setTopupRp(amount);
      setCustomRp(amount > 0 ? formatCurrency(amount) : '');
      setPayment('qris');
      setPendingTopupId(item.id);
      setResult({
        status: 'pending',
        topup_id: item.id,
        transaction: {
          id: item.id,
          payment_method: 'qris',
          status: 'pending',
          created_at: item.created_at || undefined,
        },
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        ark_coins: arkCoins,
        qr_code_url: qrUrl,
        qr_string: qrString,
        expires_at: item.metadata?.expires_at ? String(item.metadata.expires_at) : null,
      });
      setStep('awaiting_qris');
      toast.message('QRIS ready — show it to the customer');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open QRIS';
      toast.error(message);
    } finally {
      setActionTopupId(null);
    }
  }

  function finishSuccess(data: TopupResult) {
    setWaSentTo(null);
    if (!customer) return;
    const balanceAfter = Number(data.balance_after || projectedBalance);
    setResult(data);
    setCustomer({ ...customer, ark_coin_balance: balanceAfter });
    setPendingTopupId(null);
    setStep('success');
    void refetchHistory();
    toast.success(
      data.xp_awarded
        ? `Top-up successful. ${formatArk(creditRp)} added (+${data.xp_awarded} XP). New balance: ${formatArk(balanceAfter)}.`
        : `Top-up successful. ${formatArk(creditRp)} added. New balance: ${formatArk(balanceAfter)}.`
    );
  }

  async function pay() {
    if (!customer || topupRp < minTopup) return;
    if (payment === 'foc' && !focPin.trim()) {
      setError('Topup FOC membutuhkan PIN supervisor');
      toast.error('Masukkan PIN supervisor untuk topup FOC');
      return;
    }
    setStep('processing');
    setError('');

    try {
      const data = await topupMutation.mutateAsync({
        customer_id: customer.id,
        amount: topupRp,
        payment_method: payment,
        supervisor_pin: payment === 'foc' ? focPin.trim() : undefined,
        package_id: topupPackage?.id,
      });
      setFocPin('');

      if (payment === 'qris' && (data.status === 'pending' || data.qr_code_url)) {
        setResult(data);
        setPendingTopupId(data.topup_id || data.transaction?.id || null);
        setStep('awaiting_qris');
        toast.message('Show the QRIS code to the customer to complete payment');
        return;
      }

      finishSuccess(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Top-up failed';
      setError(message);
      setStep('payment');
      toast.error(message);
    }
  }

  useEffect(() => {
    if (step !== 'awaiting_qris' || !pendingTopupId) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const data = await fetchTopupStatus(pendingTopupId);
        if (cancelled) return;
        if (data.status === 'completed') {
          finishSuccess(data);
        } else if (data.status === 'cancelled') {
          setPendingTopupId(null);
          setResult(null);
          setStep('enter_amount');
          void refetchHistory();
          toast.message('Top-up was cancelled');
        }
      } catch {
        // keep polling; toast only on fatal cancel
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pendingTopupId]);

  function newTopup() {
    setTopupPackage(null);
    setTopupRp(0);
    setCustomRp('');
    setResult(null);
    setPendingTopupId(null);
    setStep('enter_amount');
  }

  async function handlePrintReceipt() {
    if (!customer || !result || printingReceipt) return;
    try {
      setPrintingReceipt(true);
      await printTopupReceipt({
        customerName: customer.name || customer.phone || 'Member',
        phone: customer.phone,
        amount: topupRp,
        arkAmountLabel: formatArk(creditRp),
        amountLabel: formatCurrency(topupRp),
        paymentMethod: payment,
        balanceBeforeLabel: formatArk(result.balance_before),
        balanceAfterLabel: formatArk(result.balance_after),
        cardId: customer.nfc_uid,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to print receipt');
    } finally {
      window.setTimeout(() => setPrintingReceipt(false), 400);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] w-full flex-col">
      <div className="mb-4 flex items-center gap-3">
        {step !== 'idle' && (
          <button
            type="button"
            onClick={goBack}
            className="rounded-lg border border-gray-200/70 p-1.5 text-muted-foreground hover:bg-muted/50"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">Top-up ARK</h1>
        </div>
        <span className="ml-auto text-xs text-muted-foreground">1 ARK = 1.000</span>
      </div>

      {(error || customersErrorMessage) && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-200/80 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error || customersErrorMessage}
        </div>
      )}

      {resolvingCard && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading member card…
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-4">
        {step === 'idle' && (
          <TopupMemberFinder
            resolvingCard={resolvingCard}
            arkRate={arkRate}
            onSelect={selectCustomer}
            onCreateNew={(prefill) => {
              setPendingNfcUid(null);
              setCustomerSearch(prefill);
              setShowCustomerModal(true);
            }}
          />
        )}

        {(step === 'enter_amount' || step === 'payment') && customer && (
          <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
            <div className="space-y-4 lg:col-span-5">
              <WalletCard
                customer={customer}
                arkRate={arkRate}
                highlightBalance
                projectedBalance={topupRp > 0 ? projectedBalance : undefined}
              />
              <TopupHistoryCard
                items={topupHistory}
                loading={loadingHistory}
                errorMessage={historyError instanceof Error ? historyError.message : ''}
                arkRate={arkRate}
                actionTopupId={actionTopupId}
                onShowQr={(item) => void handleShowHistoryQr(item)}
                onCheckPayment={(item) => void handleCheckPayment(item)}
                onCancel={(item) => void handleCancelTopup(item.id)}
              />
            </div>

            <div className="space-y-4 lg:col-span-7">
              {step === 'enter_amount' && (
                <>
                  <TopupPackagePicker selectedId={topupPackage?.id ?? null} onSelect={selectPackage} />
                  <section className="rounded-2xl border border-gray-200/70 bg-card p-4">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Top-up amount
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                      {presetValues.map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => selectPreset(value)}
                          className={cn(
                            'rounded-xl border px-3 py-3 text-sm font-semibold transition-colors',
                            topupRp === value
                              ? 'border-primary/40 bg-primary/10 text-primary ring-1 ring-primary/30'
                              : 'border-gray-200/70 bg-white text-foreground hover:border-primary/30 hover:bg-primary/5'
                          )}
                        >
                          <div>{formatCurrency(value)}</div>
                          <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                            {formatArk(value)}
                          </div>
                        </button>
                      ))}
                    </div>

                    <div className="mt-4 space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Custom amount</label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={customRp}
                        onChange={(event) => handleCustom(event.target.value)}
                        placeholder={`Minimum ${formatCurrency(minTopup)}`}
                        className="border-gray-200/80"
                      />
                    </div>
                  </section>

                  {topupRp > 0 && (
                    <div className="rounded-2xl border border-amber-200/70 bg-amber-50/80 px-4 py-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">You will receive</span>
                        <span className="font-semibold text-amber-700">{formatArk(creditRp)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Balance after top-up</span>
                        <span className="font-bold text-foreground">{formatArk(projectedBalance)}</span>
                      </div>
                      {loyaltySettings?.topup_xp_enabled && topupRp >= minTopup && (
                        <div className="mt-1 flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Estimated XP</span>
                          <span className="font-semibold text-violet-700">
                            +
                            {loyaltySettings.topup_xp_mode === "fixed"
                              ? Math.floor(loyaltySettings.topup_xp_value)
                              : Math.floor(topupRp / Math.max(1, loyaltySettings.topup_xp_amount_step)) *
                                loyaltySettings.topup_xp_value}{" "}
                            XP
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <Button
                    type="button"
                    onClick={() => topupRp >= minTopup && setStep('payment')}
                    disabled={topupRp < minTopup}
                    className="h-11 w-full bg-primary text-sm font-semibold hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground sm:w-auto sm:min-w-56"
                  >
                    Continue to payment
                  </Button>
                </>
              )}

              {step === 'payment' && (
                <>
                  <div className="rounded-2xl border border-gray-200/70 bg-card p-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Top-up amount
                    </div>
                    <div className="mt-1 text-3xl font-bold text-foreground">{formatCurrency(topupRp)}</div>
                    <div className="mt-0.5 text-sm font-medium text-amber-600">{formatArk(creditRp)}</div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      {
                        id: 'qris' as const,
                        icon: QrCode,
                        label: 'QRIS',
                        desc: 'Scan QRIS — ARK credited after payment',
                      },
                      {
                        id: 'cash' as const,
                        icon: Banknote,
                        label: 'Cash',
                        desc: 'Cash at cashier — ARK credited instantly',
                      },
                      {
                        id: 'foc' as const,
                        icon: Gift,
                        label: 'FOC (Gratis)',
                        desc: 'Marketing — butuh PIN supervisor, tanpa XP',
                      },
                    ].map((method) => (
                      <button
                        key={method.id}
                        type="button"
                        onClick={() => setPayment(method.id)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                          payment === method.id
                            ? 'border-primary/40 bg-primary/10 ring-1 ring-primary/30'
                            : 'border-gray-200/70 bg-white hover:border-primary/30 hover:bg-primary/5'
                        )}
                      >
                        <method.icon className="h-5 w-5 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-foreground">{method.label}</div>
                          <div className="text-xs text-muted-foreground">{method.desc}</div>
                        </div>
                        {payment === method.id ? <Check className="h-4 w-4 text-primary" /> : null}
                      </button>
                    ))}
                  </div>

                  {payment === 'foc' ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <label htmlFor="foc-pin" className="text-sm font-semibold text-amber-900">
                        PIN Supervisor
                      </label>
                      <p className="mb-2 text-xs text-amber-800">
                        Topup FOC memberi saldo ARK <strong>gratis</strong> untuk kebutuhan marketing:
                        tidak ada uang masuk, tidak menghasilkan XP, dan otomatis dikabarkan ke owner.
                      </p>
                      <Input
                        id="foc-pin"
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        value={focPin}
                        onChange={(e) => setFocPin(e.target.value)}
                        placeholder="Masukkan PIN supervisor"
                        className="h-11 max-w-xs bg-white"
                      />
                    </div>
                  ) : null}

                  <Button
                    type="button"
                    onClick={pay}
                    disabled={topupMutation.isPending || (payment === 'foc' && !focPin.trim())}
                    className="h-11 w-full bg-primary text-sm font-semibold hover:bg-primary/90 sm:w-auto sm:min-w-56"
                  >
                    {topupMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing…
                      </>
                    ) : payment === 'cash' ? (
                      `Confirm cash ${formatCurrency(topupRp)}`
                    ) : payment === 'foc' ? (
                      `Confirm FOC ${formatCurrency(topupRp)} (gratis)`
                    ) : (
                      `Show QRIS ${formatCurrency(topupRp)}`
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="flex h-full flex-col items-start justify-center py-16">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
            <div className="text-base font-semibold text-foreground">Processing top-up…</div>
          </div>
        )}

        {step === 'awaiting_qris' && result?.qr_code_url && (
          <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
            <div className="space-y-4 lg:col-span-5">
              {customer ? <WalletCard customer={customer} arkRate={arkRate} /> : null}
              <div className="rounded-2xl border border-gray-200/70 bg-card p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Waiting for payment
                </div>
                <div className="mt-1 text-3xl font-bold text-foreground">{formatCurrency(topupRp)}</div>
                <div className="mt-0.5 text-sm font-medium text-amber-600">{formatArk(creditRp)}</div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Ask the customer to scan this QRIS. ARK is credited after payment is confirmed.
                </p>
              </div>
            </div>
            <div className="flex flex-col items-center gap-4 lg:col-span-7">
              <QrisCard
                qrString={result.qr_string}
                qrImageUrl={result.qr_code_url}
              />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Waiting for payment confirmation…
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-gray-200/80"
                  disabled={cancelMutation.isPending}
                  onClick={() => {
                    if (pendingTopupId) {
                      void handleCancelTopup(pendingTopupId);
                    } else {
                      goBack();
                    }
                  }}
                >
                  {cancelMutation.isPending && pendingTopupId === actionTopupId ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Cancelling…
                    </>
                  ) : (
                    'Cancel'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-gray-200/80"
                  disabled={cancelMutation.isPending}
                  onClick={goBack}
                >
                  Back
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 'success' && customer && result && (
          <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
            <div className="space-y-4 lg:col-span-5">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-emerald-100">
                  <Check className="h-6 w-6 text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">Top-up successful</h2>
                  <p className="text-sm text-muted-foreground">{formatArk(creditRp)} added to wallet</p>
                </div>
              </div>
              <WalletCard customer={customer} arkRate={arkRate} highlightBalance />
            </div>

            <div className="space-y-4 lg:col-span-7">
              <div className="w-full rounded-2xl border border-gray-200/70 bg-muted/40 p-4 text-left text-sm">
                <Line label="Amount paid" value={formatCurrency(topupRp)} />
                <Line label="ARK received" value={formatArk(creditRp)} />
                <Line label="Previous balance" value={formatArk(result.balance_before)} />
                <Line label="New balance" value={formatArk(result.balance_after)} strong />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-gray-200/80"
                  onClick={() => setShowReceipt(true)}
                >
                  Receipt
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={waSending || Boolean(waSentTo)}
                  onClick={() => void sendTopupWa()}
                  className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                >
                  {waSending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MessageCircle className="h-4 w-4" />
                  )}
                  {waSentTo ? `Terkirim ke ${waSentTo}` : "Kirim WA"}
                </Button>
                <Button
                  type="button"
                  className="bg-primary hover:bg-primary/90"
                  onClick={newTopup}
                >
                  Top up again
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={showReceipt} onOpenChange={(open) => !open && setShowReceipt(false)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-center text-sm font-semibold">Top-up receipt</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-3 text-sm">
            <div className="border-b border-gray-200/70 pb-3 text-center">
              <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-emerald-100">
                <Check className="h-6 w-6 text-emerald-600" />
              </div>
              <div className="text-xs text-muted-foreground">Success</div>
              <div className="text-xl font-bold text-foreground">{formatArk(creditRp)}</div>
            </div>
            <Line label="Customer" value={customer?.name || customer?.phone || '-'} />
            <Line label="Amount" value={formatCurrency(topupRp)} />
            <Line label="Method" value={paymentMethodLabel(payment)} />
            <Line label="Previous balance" value={formatArk(result?.balance_before || 0)} />
            <Line label="New balance" value={formatArk(result?.balance_after || 0)} strong />
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="border-gray-200/80"
              onClick={() => setShowReceipt(false)}
              disabled={printingReceipt}
            >
              Close
            </Button>
            <Button
              type="button"
              className="bg-primary hover:bg-primary/90"
              onClick={() => void handlePrintReceipt()}
              disabled={!result || !customer || printingReceipt}
            >
              {printingReceipt ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Printing…
                </>
              ) : (
                <>
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CustomerSearchModal
        open={showCustomerModal}
        customers={modalCustomers}
        search={customerSearch}
        selectedCustomerId={customer?.id ?? null}
        onSearchChange={setCustomerSearch}
        onCreateCustomer={handleCreateCustomer}
        initialNfcUid={pendingNfcUid}
        allowGuest={false}
        onSelect={(c) => {
          if (!c) {
            closeCustomerModal();
            return;
          }
          toast.success(`Member ${c.name || c.phone} selected`);
          selectCustomer({
            id: c.id,
            name: c.name,
            phone: c.phone,
            email: c.email,
            membership_tier: c.membership_tier,
            ark_coin_balance: Number(c.ark_coin_balance || 0),
            nfc_uid: c.nfc_uid,
          });
        }}
        onClose={closeCustomerModal}
      />
    </div>
  );
}

function formatTopupDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function paymentMethodLabel(method?: string | null) {
  const value = String(method || '').toLowerCase();
  if (value === 'cash') return 'Cash';
  if (value === 'qris') return 'QRIS';
  if (value === 'foc') return 'FOC (Gratis)';
  if (value === 'credit' || value === 'credit_card') return 'Card';
  if (!value) return '—';
  return value.toUpperCase();
}

function walletTypeLabel(type?: string | null) {
  const value = String(type || 'topup').toLowerCase();
  if (value === 'topup') return 'Top-up';
  if (value === 'topup_bonus') return 'Bonus top-up';
  if (value === 'payment') return 'Pemakaian';
  if (value === 'refund') return 'Refund';
  if (value === 'bonus') return 'Bonus';
  if (value === 'redeem') return 'Redeem';
  if (value === 'expiration') return 'Kedaluwarsa';
  if (value === 'adjustment') return 'Penyesuaian';
  if (value === 'reversal') return 'Pembatalan';
  if (value === 'topup_refund') return 'Refund top-up';
  if (value === 'withdrawal') return 'Penarikan';
  return value;
}

function walletTypeBadgeClass(type?: string | null) {
  const value = String(type || 'topup').toLowerCase();
  if (value === 'payment' || value === 'redeem') {
    return 'bg-red-50 text-red-700 ring-1 ring-red-200/70';
  }
  if (value === 'refund') {
    return 'bg-sky-50 text-sky-700 ring-1 ring-sky-200/70';
  }
  if (value === 'topup_bonus' || value === 'bonus') {
    return 'bg-violet-50 text-violet-700 ring-1 ring-violet-200/70';
  }
  return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70';
}

function statusLabel(status?: string | null) {
  const value = String(status || 'completed').toLowerCase();
  if (value === 'pending') return 'Pending';
  if (value === 'failed') return 'Failed';
  if (value === 'expired') return 'Expired';
  if (value === 'cancelled') return 'Cancelled';
  return 'Completed';
}

function statusBadgeClass(status?: string | null) {
  const value = String(status || 'completed').toLowerCase();
  if (value === 'pending') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/80';
  if (value === 'failed' || value === 'expired' || value === 'cancelled') {
    return 'bg-red-50 text-red-700 ring-1 ring-red-200/80';
  }
  return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80';
}

function canResumeQris(item: TopupHistoryItem) {
  const type = String(item.type || 'topup').toLowerCase();
  return (
    type === 'topup' &&
    String(item.status || '').toLowerCase() === 'pending' &&
    String(item.payment_method || '').toLowerCase() === 'qris'
  );
}

function TopupHistoryCard({
  items,
  loading,
  errorMessage,
  arkRate,
  actionTopupId,
  onShowQr,
  onCheckPayment,
  onCancel,
}: {
  items: TopupHistoryItem[];
  loading: boolean;
  errorMessage: string;
  arkRate: number;
  actionTopupId?: string | null;
  onShowQr: (item: TopupHistoryItem) => void;
  onCheckPayment: (item: TopupHistoryItem) => void;
  onCancel: (item: TopupHistoryItem) => void;
}) {
  return (
    <div className="rounded-2xl border border-gray-200/70 bg-card">
      <div className="flex items-center gap-2 border-b border-gray-200/70 px-4 py-3">
        <History className="h-4 w-4 text-muted-foreground" />
        <div className="text-sm font-semibold text-foreground">Riwayat mutasi</div>
        <span className="ml-auto text-xs text-muted-foreground">
          {loading ? '…' : `${items.length} terakhir`}
        </span>
      </div>

      <div className="px-4 py-2">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat riwayat…
          </div>
        ) : errorMessage ? (
          <div className="py-4 text-sm text-red-600">{errorMessage}</div>
        ) : items.length === 0 ? (
          <div className="py-6 text-sm text-muted-foreground">Belum ada mutasi wallet.</div>
        ) : (
          <div className="divide-y divide-gray-200/70">
            {items.map((item) => {
              const credit = isCreditEntry(String(item.type || 'topup').toLowerCase(), Number(item.amount) || 0);
              const amount = Math.abs(Number(item.amount) || 0);
              const signedLabel = `${credit ? '+' : '−'}${formatCurrency(amount)}`;
              const signedArk = `${credit ? '+' : '−'}${formatArkAmount(amount, arkRate)}`;
              const pendingQris = canResumeQris(item);
              const busy = actionTopupId === item.id;
              const type = String(item.type || 'topup').toLowerCase();
              const showMethod = type === 'topup' || type === 'topup_bonus';

              return (
                <div key={item.id} className="space-y-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            'rounded-md px-2 py-0.5 text-[11px] font-semibold',
                            walletTypeBadgeClass(item.type)
                          )}
                        >
                          {walletTypeLabel(item.type)}
                        </span>
                        {type === 'topup' ? (
                          <span
                            className={cn(
                              'rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize',
                              statusBadgeClass(item.status)
                            )}
                          >
                            {statusLabel(item.status)}
                          </span>
                        ) : null}
                      </div>
                      <div
                        className={cn(
                          'mt-1 text-sm font-semibold',
                          credit ? 'text-emerald-700' : 'text-red-700'
                        )}
                      >
                        {signedLabel}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {signedArk}
                        {showMethod ? ` · ${paymentMethodLabel(item.payment_method)}` : null}
                        {item.order_number ? ` · ${item.order_number}` : null}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {formatTopupDate(item.created_at)}
                        {item.balance_after != null
                          ? ` · saldo ${formatArkAmount(Number(item.balance_after) || 0, arkRate)}`
                          : null}
                      </div>
                    </div>
                  </div>

                  {pendingQris ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 border-gray-200/80 text-xs"
                        disabled={Boolean(actionTopupId)}
                        onClick={() => onShowQr(item)}
                      >
                        {busy ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <QrCode className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Show QR
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 border-emerald-200/80 text-xs text-emerald-700 hover:bg-emerald-50"
                        disabled={Boolean(actionTopupId)}
                        title="Sudah bayar tapi saldo belum masuk? Cek langsung ke Xendit"
                        onClick={() => onCheckPayment(item)}
                      >
                        Cek pembayaran
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 border-red-200/80 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                        disabled={Boolean(actionTopupId)}
                        onClick={() => onCancel(item)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function WalletCard({
  customer,
  arkRate,
  highlightBalance = false,
  projectedBalance,
}: {
  customer: TopupCustomer;
  arkRate: number;
  highlightBalance?: boolean;
  projectedBalance?: number;
}) {
  const balance = Number(customer.ark_coin_balance || 0);
  const formatArk = (value: number) => formatArkAmount(value, arkRate);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary via-primary to-amber-600 p-5 text-primary-foreground shadow-sm">
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-10 left-10 h-28 w-28 rounded-full bg-black/10" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide opacity-90">
            <Coins className="h-3.5 w-3.5" />
            ARK Wallet
          </div>
          <div className="mt-2 truncate text-lg font-bold">{customer.name || 'Unnamed member'}</div>
          <div className="mt-0.5 text-sm opacity-90">{customer.phone}</div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize',
            'bg-white/20 text-white'
          )}
        >
          {customer.membership_tier || 'regular'}
        </span>
      </div>

      {customer.nfc_uid ? (
        <div className="relative mt-3 text-xs font-mono tracking-wide opacity-90">
          Card {customer.nfc_uid}
        </div>
      ) : null}

      <div className="relative mt-6">
        <div className="text-xs uppercase tracking-wide opacity-80">
          {highlightBalance ? 'Remaining balance' : 'Balance'}
        </div>
        <div className="mt-1 text-3xl font-bold tracking-tight">{formatArk(balance)}</div>
        <div className="mt-0.5 text-sm opacity-90">{formatCurrency(balance)}</div>
      </div>

      {typeof projectedBalance === 'number' && projectedBalance !== balance ? (
        <div className="relative mt-4 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="opacity-90">After top-up</span>
            <span className="font-bold">{formatArk(projectedBalance)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="mb-2 flex items-center justify-between last:mb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'font-bold text-amber-600' : 'font-medium text-foreground'}>{value}</span>
    </div>
  );
}
