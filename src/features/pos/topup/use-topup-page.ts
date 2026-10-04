'use client';

import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { findCustomerByCard, POS_NFC_CARD_EVENT, usePosNfcOptional } from '@/features/pos/nfc';
import { useLoyaltySettings } from '@/features/pos/loyalty-settings';
import type { TopupPackage } from '@/features/wallet/api';
import { saveCustomer, type CustomerWithDiscount } from '@/lib/pos-api';
import { formatArkAmount } from '@/lib/pos/loyalty-settings';
import { buildTopupQrImageUrl, fetchTopupStatus, listTopupCustomers, reconcileTopup } from './api';
import { useCancelTopup, useProcessTopup } from './mutations';
import { useTopupCustomers, useTopupHistory } from './queries';
import {
  creditOf,
  estimateTopupXp,
  initialTopupFlow,
  projectedBalanceOf,
  topupFlowReducer,
} from './topup-flow';
import type { TopupCustomer, TopupHistoryItem, TopupResult } from './types';

const DEFAULT_PRESETS = [50000, 100000, 200000, 500000, 1000000];
const POLL_MS = 2500;

export type NewCustomerPayload = {
  name: string;
  phone: string;
  email?: string;
  enroll_member: boolean;
  nfc_uid?: string;
  is_kol?: boolean;
};

/** Modal pilih/buat customer: dibuka dari pencarian atau dari kartu NFC yang belum terdaftar. */
function useCustomerModal(onClosed: () => void) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pendingNfcUid, setPendingNfcUid] = useState<string | null>(null);
  const reset = () => {
    setOpen(false);
    setPendingNfcUid(null);
    setSearch('');
  };
  return {
    open,
    search,
    pendingNfcUid,
    setSearch,
    openForSearch(prefill: string) {
      setPendingNfcUid(null);
      setSearch(prefill);
      setOpen(true);
    },
    openForCard(uid: string) {
      setSearch('');
      setPendingNfcUid(uid);
      setOpen(true);
    },
    reset,
    close() {
      reset();
      onClosed();
    },
  };
}

/**
 * Seluruh state & aksi halaman top-up ARK. Komponen halaman hanya merender
 * langkah sesuai `state.step` dan memanggil aksi di sini.
 */
export function useTopupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cardParam = searchParams.get('card');
  const cardHandledRef = useRef<string | null>(null);

  const [state, dispatch] = useReducer(topupFlowReducer, initialTopupFlow);
  const { customer, pendingTopupId, step } = state;
  const [focPin, setFocPin] = useState('');
  const [actionTopupId, setActionTopupId] = useState<string | null>(null);

  const clearCardParam = useCallback(() => {
    if (!searchParams.get('card')) return;
    router.replace('/dashboard/pos/topup');
  }, [router, searchParams]);

  const modal = useCustomerModal(() => {
    cardHandledRef.current = null;
    clearCardParam();
  });

  const { data: customers = [], error: customersError, refetch } = useTopupCustomers({ search: modal.search });
  const history = useTopupHistory(customer?.id);
  const topupMutation = useProcessTopup();
  const cancelMutation = useCancelTopup(customer?.id);
  const { data: loyaltySettings } = useLoyaltySettings();
  const setPaymentNfcActive = usePosNfcOptional()?.setPaymentNfcActive;

  const arkRate = loyaltySettings?.ark_rate || 1000;
  const minTopup = loyaltySettings?.topup_min_amount ?? 10000;
  const presetValues = loyaltySettings?.topup_presets?.length ? loyaltySettings.topup_presets : DEFAULT_PRESETS;
  const creditRp = creditOf(state);
  const projectedBalance = projectedBalanceOf(state);
  const formatArk = (value: number) => formatArkAmount(value, arkRate);
  const estimatedXp =
    loyaltySettings?.topup_xp_enabled && state.topupRp >= minTopup
      ? estimateTopupXp(state.topupRp, loyaltySettings)
      : null;

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

  function selectCustomer(item: TopupCustomer) {
    modal.reset();
    cardHandledRef.current = null;
    clearCardParam();
    dispatch({ type: 'customerSelected', customer: item });
  }

  async function createCustomer(payload: NewCustomerPayload): Promise<CustomerWithDiscount> {
    const response = await saveCustomer({ ...payload, membership_tier: 'regular' });
    await refetch();
    return { ...response.data, discount: 0 } as CustomerWithDiscount;
  }

  useEffect(() => {
    setPaymentNfcActive?.(true);
    return () => setPaymentNfcActive?.(false);
  }, [setPaymentNfcActive]);

  // Kartu dari query ?card= atau event bridge NFC → cari member pemilik kartu.
  const cardScan = useMutation({
    mutationFn: async (card: string) => ({ card, found: findCustomerByCard(await listTopupCustomers({}), card) }),
    onSuccess: ({ card, found }) => {
      cardHandledRef.current = card;
      if (!found) {
        modal.openForCard(card.toUpperCase());
        toast.message('Kartu belum terdaftar. Pilih customer existing atau buat baru.');
        return;
      }
      toast.success(`Member ${found.name || found.phone} dipilih`);
      selectCustomer(found);
    },
    onError: (err, card) => {
      cardHandledRef.current = card;
      clearCardParam();
      const message = err instanceof Error ? err.message : 'Gagal membaca kartu';
      toast.error(message);
      dispatch({ type: 'errorShown', message });
    },
  });
  const scanCard = useEffectEvent((rawCard: string) => {
    const card = rawCard.trim();
    if (!card || cardHandledRef.current === card) return;
    dispatch({ type: 'errorShown', message: '' });
    cardScan.mutate(card);
  });

  useEffect(() => {
    if (cardParam?.trim()) scanCard(cardParam);
  }, [cardParam]);

  useEffect(() => {
    function onBridgeCard(event: Event) {
      const card = (event as CustomEvent<{ card?: string }>).detail?.card;
      if (!card) return;
      cardHandledRef.current = null;
      scanCard(card);
    }
    window.addEventListener(POS_NFC_CARD_EVENT, onBridgeCard);
    return () => window.removeEventListener(POS_NFC_CARD_EVENT, onBridgeCard);
  }, []);

  function finishSuccess(data: TopupResult) {
    if (!customer) return;
    const balanceAfter = Number(data.balance_after || projectedBalance);
    dispatch({ type: 'succeeded', result: data });
    void history.refetch();
    toast.success(
      data.xp_awarded
        ? `Top-up successful. ${formatArk(creditRp)} added (+${data.xp_awarded} XP). New balance: ${formatArk(balanceAfter)}.`
        : `Top-up successful. ${formatArk(creditRp)} added. New balance: ${formatArk(balanceAfter)}.`
    );
  }

  // Polling status QRIS selama menunggu pembayaran.
  const onPolledStatus = useEffectEvent((data: TopupResult) => {
    if (data.status === 'completed') {
      finishSuccess(data);
    } else if (data.status === 'cancelled' && pendingTopupId) {
      dispatch({ type: 'topupCancelled', topupId: pendingTopupId });
      void history.refetch();
      toast.message('Top-up was cancelled');
    }
  });
  useEffect(() => {
    if (step !== 'awaiting_qris' || !pendingTopupId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await fetchTopupStatus(pendingTopupId);
        if (!cancelled) onPolledStatus(data);
      } catch {
        // tetap polling; error sementara diabaikan
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [step, pendingTopupId]);

  async function withTopupAction(topupId: string, fn: () => Promise<void>) {
    setActionTopupId(topupId);
    try {
      await fn();
    } finally {
      setActionTopupId(null);
    }
  }

  async function cancelTopup(topupId: string) {
    if (!topupId || cancelMutation.isPending) return;
    await withTopupAction(topupId, async () => {
      try {
        await cancelMutation.mutateAsync(topupId);
        toast.success('Top-up cancelled');
        dispatch({ type: 'topupCancelled', topupId });
        await history.refetch();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to cancel top-up');
      }
    });
  }

  async function checkPayment(item: TopupHistoryItem) {
    dispatch({ type: 'errorShown', message: '' });
    await withTopupAction(item.id, async () => {
      try {
        const reconciled = await reconcileTopup(item.id);
        if (reconciled.completed) {
          toast.success(reconciled.message || 'Pembayaran ditemukan — saldo dikredit');
          if (reconciled.result && pendingTopupId === item.id) {
            finishSuccess(reconciled.result);
          } else if (reconciled.result) {
            dispatch({ type: 'balanceUpdated', balance: Number(reconciled.result.balance_after) });
          }
        } else {
          toast.message(reconciled.message || 'Belum ada pembayaran tercatat di Xendit');
        }
        await history.refetch();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal mengecek pembayaran');
      }
    });
  }

  async function showHistoryQr(item: TopupHistoryItem) {
    if (String(item.status || '').toLowerCase() !== 'pending') {
      toast.error('Only pending QRIS top-ups can be shown again');
      return;
    }
    if (String(item.payment_method || '').toLowerCase() !== 'qris') {
      toast.error('This top-up has no QRIS code');
      return;
    }
    dispatch({ type: 'errorShown', message: '' });
    await withTopupAction(item.id, async () => {
      try {
        const metadataQr = item.metadata?.qr_string ? String(item.metadata.qr_string) : '';
        let qrUrl = metadataQr ? buildTopupQrImageUrl(metadataQr) : null;
        let qrString = metadataQr || null;
        let balanceBefore = Number(item.balance_before) || 0;
        let balanceAfter = Number(item.balance_after) || Number(customer?.ark_coin_balance) || 0;
        let arkCoins = Number(item.ark_coins) || 0;

        if (!qrUrl) {
          const status = await fetchTopupStatus(item.id);
          const value = String(status.status || '').toLowerCase();
          if (value === 'cancelled') {
            toast.error('This top-up was already cancelled');
            await history.refetch();
            return;
          }
          if (value === 'completed') {
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
        dispatch({
          type: 'qrisResumed',
          topupId: item.id,
          amount: Number(item.amount) || 0,
          result: {
            status: 'pending',
            topup_id: item.id,
            transaction: { id: item.id, payment_method: 'qris', status: 'pending', created_at: item.created_at || undefined },
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            ark_coins: arkCoins,
            qr_code_url: qrUrl,
            qr_string: qrString,
            expires_at: item.metadata?.expires_at ? String(item.metadata.expires_at) : null,
          },
        });
        toast.message('QRIS ready — show it to the customer');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to open QRIS');
      }
    });
  }

  async function pay() {
    if (!customer || state.topupRp < minTopup) return;
    const payment = state.payment;
    if (payment === 'foc' && !focPin.trim()) {
      dispatch({ type: 'errorShown', message: 'Topup FOC membutuhkan PIN supervisor' });
      toast.error('Masukkan PIN supervisor untuk topup FOC');
      return;
    }
    dispatch({ type: 'submitStarted' });
    try {
      const data = await topupMutation.mutateAsync({
        customer_id: customer.id,
        amount: state.topupRp,
        payment_method: payment,
        supervisor_pin: payment === 'foc' ? focPin.trim() : undefined,
        package_id: state.topupPackage?.id,
      });
      setFocPin('');
      if (payment === 'qris' && (data.status === 'pending' || data.qr_code_url)) {
        dispatch({ type: 'qrisIssued', result: data });
        toast.message('Show the QRIS code to the customer to complete payment');
        return;
      }
      finishSuccess(data);
    } catch (err) {
      // Termasuk 429: kasir terkunci setelah PIN supervisor salah berulang.
      const message = err instanceof Error ? err.message : 'Top-up failed';
      dispatch({ type: 'submitFailed', message });
      toast.error(message);
    }
  }

  return {
    state,
    dispatch,
    focPin,
    setFocPin,
    actionTopupId,
    arkRate,
    minTopup,
    presetValues,
    creditRp,
    projectedBalance,
    estimatedXp,
    resolvingCard: cardScan.isPending,
    customersErrorMessage: customersError instanceof Error ? customersError.message : '',
    history,
    submitting: topupMutation.isPending,
    cancelling: cancelMutation.isPending,
    modal,
    modalCustomers,
    selectCustomer,
    createCustomer,
    selectPackage: (pkg: TopupPackage) => dispatch({ type: 'packageSelected', pkg }),
    cancelTopup,
    checkPayment,
    showHistoryQr,
    pay,
  };
}
