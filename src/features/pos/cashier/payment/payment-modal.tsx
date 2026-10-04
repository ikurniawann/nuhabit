"use client";

import { useEffect, useEffectEvent, useMemo, useReducer } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { usePaymentMethods } from "@/features/pos/payment-methods";
import type { CfdPayment } from "@/lib/pos/cfd";
import { isFocPaymentMethod } from "@/lib/pos/payment-methods";

import { ArkPanel } from "./ark-panel";
import { CashPanel } from "./cash-panel";
import { FocPinPanel } from "./foc-pin-panel";
import { GiftCardPanel } from "./gift-card-panel";
import { MethodGrid } from "./method-grid";
import { NfcTabPanel } from "./nfc-tab-panel";
import {
  arkToUseFor,
  buildConfirmPayload,
  buildPaymentOptions,
  cashSummary,
  initialPaymentState,
  isPaymentValid,
  paymentReducer,
  qrOf,
  resolveSelection,
  type GiftCardCheckResult,
  type NfcTabCheckResult,
  type PaymentCustomer,
  type PaymentOption,
} from "./payment-state";
import { QrisOverlay, QrisStatusPanel } from "./qris-panel";
import { useQrisPayment, type QrisCallbacks } from "./use-qris-payment";

interface Props extends QrisCallbacks {
  open: boolean;
  total: number;
  totalAfterArk: number;
  selectedCustomer: PaymentCustomer | null;
  onClose: () => void;
  submitting?: boolean;
  formatCurrency: (v: number) => string;
  formatArk: (v: number) => string;
  onTapNFC: () => void;
  /**
   * Pratinjau tab ticketing utk metode NFC Tab (opsional — tanpa prop ini
   * opsi NFC Tab disembunyikan, mis. dipakai di luar kasir venue ticketing).
   */
  onCheckNfcTab?: (uid: string) => Promise<NfcTabCheckResult>;
  /**
   * EPIC-034 Fase C — pratinjau saldo gift card (opsional; tanpa prop ini
   * opsi Gift Card disembunyikan, pola yang sama dgn NFC Tab).
   */
  onCheckGiftCard?: (code: string) => Promise<GiftCardCheckResult>;
  /**
   * EPIC-024 — sinkron state pembayaran ke customer display (opsional).
   * Bila diberikan: perubahan metode/tunai/QR dipancarkan; metode QRIS
   * membuat QR dinamis Xendit ber-nominal terkunci.
   */
  onCfdPayment?: (payment: CfdPayment | null) => void;
  /** Cart has items from 2+ stalls — QRIS must bind to checkout_id. */
  isMixedCart?: boolean;
  /** Paying an existing table/central checkout — ARK/NFC/gift are not wired. */
  isCheckoutBill?: boolean;
  /**
   * Bayar open bill: id order tersimpan. QRIS diikat ke order ini supaya
   * nominal QR dipaksa server = total bill TERSIMPAN (insiden 2026-08-23:
   * keranjang layar bisa berubah setelah open bill tanpa tersimpan).
   */
  payingOrderId?: string | null;
}

export function PaymentModal({
  open,
  total,
  totalAfterArk,
  selectedCustomer,
  onClose,
  onConfirm,
  submitting = false,
  formatCurrency,
  formatArk,
  onTapNFC,
  onCheckNfcTab,
  onCheckGiftCard,
  onCfdPayment,
  isMixedCart = false,
  isCheckoutBill = false,
  payingOrderId = null,
  onPrepareMixedQrisCheckout,
  onPrepareOrderQris,
  onAbandonOrderQris,
}: Props) {
  const methodsQuery = usePaymentMethods(true);
  const [state, dispatch] = useReducer(
    paymentReducer,
    { open, total, totalAfterArk, submitting },
    initialPaymentState
  );
  // Reset karena props berubah (tutup modal, total berubah, submit selesai)
  // diproses saat render, bukan lewat setState di effect.
  if (
    open !== state.open ||
    total !== state.total ||
    totalAfterArk !== state.totalAfterArk ||
    submitting !== state.submitting
  ) {
    dispatch({ type: "props-changed", open, total, totalAfterArk, submitting });
  }

  const options = useMemo(
    () =>
      buildPaymentOptions(methodsQuery.data, {
        nfcTab: Boolean(onCheckNfcTab),
        giftCard: Boolean(onCheckGiftCard),
      }),
    [methodsQuery.data, onCheckGiftCard, onCheckNfcTab]
  );
  const tenders = { isMixedCart, isCheckoutBill };
  const { code, method } = resolveSelection(state, options, tenders);
  const selectedOption = options.find((option) => option.code === code);
  const focSelected = isFocPaymentMethod(code, selectedOption?.title);
  const arkToUse = arkToUseFor(method, selectedCustomer, total);
  const { cashAmount, change } = cashSummary(method, state.cashInput, totalAfterArk);
  const qr = qrOf(state.qris);
  const settleError = state.qris.status === "settle_error" ? state.qris.message : null;
  const qrisSettling = state.qris.status === "paid" || submitting;

  const { preparing: qrisPreparing, retrySettle } = useQrisPayment({
    state,
    dispatch,
    active: open && method === "qris",
    submitting,
    totalAfterArk,
    isMixedCart,
    payingOrderId,
    onConfirm,
    onPrepareMixedQrisCheckout,
    onPrepareOrderQris,
    onAbandonOrderQris,
  });

  // Pancarkan state pembayaran ke customer display (satu arah, read-only).
  // Effect event: callback induk yang tidak stabil tidak memicu publish ulang.
  const qrString = qr?.qr_string ?? null;
  const publishCfd = useEffectEvent((payment: CfdPayment | null) => onCfdPayment?.(payment));
  useEffect(() => {
    if (!open) {
      publishCfd(null);
      return;
    }
    publishCfd({
      method,
      amount: totalAfterArk,
      cash_received: method === "cash" && cashAmount > 0 ? cashAmount : undefined,
      change: method === "cash" && cashAmount > 0 && change >= 0 ? change : undefined,
      qr_string: method === "qris" ? qrString : undefined,
      qr_loading: method === "qris" ? qrisPreparing : undefined,
    });
  }, [open, method, cashAmount, change, totalAfterArk, qrString, qrisPreparing]);

  const isValid = isPaymentValid({
    method,
    focSelected,
    customer: selectedCustomer,
    supervisorPin: state.supervisorPin,
    cashAmount,
    total,
    totalAfterArk,
    nfcResult: state.nfcResult,
    giftResult: state.giftResult,
  });

  const handleClose = () => {
    if (!submitting) onClose();
  };

  const pickMethod = (option: PaymentOption) => {
    dispatch({ type: "method-picked", code: option.code, method: option.cashierKey });
    const pickedFoc = isFocPaymentMethod(option.code, option.title);
    if ((option.cashierKey === "ark_coin" || pickedFoc) && !selectedCustomer) {
      onTapNFC();
    }
  };

  const checkTabUid = async () => {
    const uid = state.nfcInput.trim();
    if (!uid || !onCheckNfcTab || state.nfcChecking) return;
    dispatch({ type: "nfc-check-started" });
    try {
      const result = await onCheckNfcTab(uid);
      dispatch({ type: "nfc-check-finished", result: { ...result, uid } });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Gagal memeriksa gelang";
      dispatch({ type: "nfc-check-finished", result: { ok: false, reason, uid } });
    }
  };

  const checkGiftCode = async () => {
    const giftCode = state.giftInput.trim().toUpperCase();
    if (!giftCode || !onCheckGiftCard || state.giftChecking) return;
    dispatch({ type: "gift-check-started" });
    try {
      const result = await onCheckGiftCard(giftCode);
      dispatch({ type: "gift-check-finished", result: { ...result, code: giftCode } });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Gagal memeriksa gift card";
      dispatch({ type: "gift-check-finished", result: { ok: false, reason, code: giftCode } });
    }
  };

  const confirm = () => {
    void onConfirm(
      buildConfirmPayload({
        method,
        code,
        optionTitle: selectedOption?.title,
        focSelected,
        cashAmount,
        arkToUse,
        supervisorPin: state.supervisorPin,
        nfcResult: state.nfcResult,
        giftResult: state.giftResult,
      })
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && handleClose()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>Payment Method</DialogPanelTitle>
          <DialogPanelDescription>Choose how to pay this bill.</DialogPanelDescription>
        </DialogPanelHeader>

        <DialogPanelBody className="space-y-5">
          <MethodGrid
            options={options}
            selectedCode={code}
            tenders={tenders}
            disabled={submitting}
            arkBalanceLabel={formatArk(selectedCustomer?.ark_coin_balance || 0)}
            onPick={pickMethod}
          />

          {focSelected && (
            <FocPinPanel
              customer={selectedCustomer}
              pin={state.supervisorPin}
              disabled={submitting}
              onPinChange={(value) => dispatch({ type: "supervisor-pin-changed", value })}
            />
          )}

          {method === "cash" && !focSelected && (
            <CashPanel
              cashInput={state.cashInput}
              change={change}
              totalAfterArk={totalAfterArk}
              disabled={submitting}
              formatCurrency={formatCurrency}
              onCashChange={(value) => dispatch({ type: "cash-input-changed", value })}
            />
          )}

          {method === "qris" && (
            <QrisStatusPanel
              preparing={qrisPreparing}
              qr={qr}
              error={state.qris.status === "unavailable" ? state.qris.error : null}
            />
          )}

          {method === "nfc_tab" && (
            <NfcTabPanel
              input={state.nfcInput}
              checking={state.nfcChecking}
              result={state.nfcResult}
              total={total}
              disabled={submitting}
              formatCurrency={formatCurrency}
              onInputChange={(value) => dispatch({ type: "nfc-input-changed", value })}
              onSubmit={() => void checkTabUid()}
            />
          )}

          {method === "gift_card" && (
            <GiftCardPanel
              input={state.giftInput}
              checking={state.giftChecking}
              result={state.giftResult}
              total={total}
              disabled={submitting}
              formatCurrency={formatCurrency}
              onInputChange={(value) => dispatch({ type: "gift-input-changed", value })}
              onCheck={() => void checkGiftCode()}
            />
          )}

          {method === "ark_coin" && (
            <ArkPanel
              customer={selectedCustomer}
              total={total}
              disabled={submitting}
              formatArk={formatArk}
              onTapNFC={onTapNFC}
            />
          )}

          <div className="flex items-center justify-between rounded-xl border border-gray-200/70 bg-white px-4 py-3">
            <span className="text-sm font-medium text-muted-foreground">Total</span>
            <span className="text-lg font-bold text-brand-text">{formatCurrency(total)}</span>
          </div>
        </DialogPanelBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="border-gray-200/80"
            onClick={handleClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          {method === "qris" ? (
            settleError ? (
              <Button
                type="button"
                className="bg-primary hover:bg-primary/90"
                onClick={retrySettle}
              >
                Coba lagi
              </Button>
            ) : (
              <Button type="button" className="bg-primary hover:bg-primary/90" disabled>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {qrisSettling ? "Processing…" : "Menunggu pembayaran…"}
              </Button>
            )
          ) : (
            <Button
              type="button"
              className="bg-primary hover:bg-primary/90"
              disabled={!isValid || submitting}
              onClick={confirm}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing…
                </>
              ) : (
                "Confirm payment"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogPanel>

      {method === "qris" && qr?.qr_string ? (
        <QrisOverlay
          qr={qr}
          settling={qrisSettling}
          settleError={settleError}
          formatCurrency={formatCurrency}
          onRetry={retrySettle}
          onPickOtherMethod={() =>
            dispatch({ type: "method-picked", code: "cash", method: "cash" })
          }
        />
      ) : null}
    </Dialog>
  );
}
