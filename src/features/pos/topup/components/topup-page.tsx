'use client';

import { AlertCircle, ArrowLeft, Loader2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { CustomerSearchModal } from '@/components/pos/CustomerSearchModal';
import { useTopupPage } from '../use-topup-page';
import { TopupAmountStep } from './topup-amount-step';
import { TopupHistoryCard } from './topup-history-card';
import { TopupMemberFinder } from './topup-member-finder';
import { TopupPaymentStep } from './topup-payment-step';
import { TopupQrisStep } from './topup-qris-step';
import { TopupSuccessStep } from './topup-success-step';
import { WalletCard } from './wallet-card';

export function TopupPage() {
  const page = useTopupPage();
  const { state, dispatch, arkRate, creditRp, modal } = page;
  const { step, customer, result, topupRp } = state;
  const errorMessage = state.error || page.customersErrorMessage;

  return (
    <div className="flex h-[calc(100vh-8rem)] w-full flex-col">
      <div className="mb-4 flex items-center gap-3">
        {step !== 'idle' && (
          <button
            type="button"
            aria-label="Kembali"
            onClick={() => dispatch({ type: 'back' })}
            className="rounded-lg border border-gray-200/70 p-1.5 text-muted-foreground hover:bg-muted/50"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-brand-text" />
          <h1 className="text-lg font-bold text-foreground">Top-up ARK</h1>
        </div>
        <span className="ml-auto text-xs text-muted-foreground">1 ARK = 1.000</span>
      </div>

      {errorMessage && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-200/80 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {errorMessage}
        </div>
      )}

      {page.resolvingCard && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading member card…
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-4">
        {step === 'idle' && (
          <TopupMemberFinder
            resolvingCard={page.resolvingCard}
            arkRate={arkRate}
            onSelect={page.selectCustomer}
            onCreateNew={modal.openForSearch}
          />
        )}

        {(step === 'enter_amount' || step === 'payment') && customer && (
          <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
            <div className="space-y-4 lg:col-span-5">
              <WalletCard
                customer={customer}
                arkRate={arkRate}
                highlightBalance
                projectedBalance={topupRp > 0 ? page.projectedBalance : undefined}
              />
              <TopupHistoryCard
                items={page.history.data ?? []}
                loading={page.history.isLoading}
                errorMessage={page.history.error instanceof Error ? page.history.error.message : ''}
                arkRate={arkRate}
                actionTopupId={page.actionTopupId}
                onShowQr={(item) => void page.showHistoryQr(item)}
                onCheckPayment={(item) => void page.checkPayment(item)}
                onCancel={(item) => void page.cancelTopup(item.id)}
              />
            </div>

            <div className="space-y-4 lg:col-span-7">
              {step === 'enter_amount' ? (
                <TopupAmountStep
                  arkRate={arkRate}
                  presetValues={page.presetValues}
                  minTopup={page.minTopup}
                  topupRp={topupRp}
                  customRp={state.customRp}
                  creditRp={creditRp}
                  projectedBalance={page.projectedBalance}
                  packageId={state.topupPackage?.id ?? null}
                  estimatedXp={page.estimatedXp}
                  onSelectPackage={page.selectPackage}
                  onSelectPreset={(value) => dispatch({ type: 'presetSelected', value })}
                  onCustomChange={(raw) => dispatch({ type: 'customAmountTyped', raw })}
                  onContinue={() => dispatch({ type: 'continueToPayment', minTopup: page.minTopup })}
                />
              ) : (
                <TopupPaymentStep
                  arkRate={arkRate}
                  topupRp={topupRp}
                  creditRp={creditRp}
                  payment={state.payment}
                  focPin={page.focPin}
                  submitting={page.submitting}
                  onPaymentChange={(payment) => dispatch({ type: 'paymentChosen', payment })}
                  onFocPinChange={page.setFocPin}
                  onSubmit={() => void page.pay()}
                />
              )}
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="flex h-full flex-col items-start justify-center py-16">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-brand-text" />
            <div className="text-base font-semibold text-foreground">Processing top-up…</div>
          </div>
        )}

        {step === 'awaiting_qris' && result?.qr_code_url && (
          <TopupQrisStep
            customer={customer}
            arkRate={arkRate}
            topupRp={topupRp}
            creditRp={creditRp}
            qrString={result.qr_string}
            qrImageUrl={result.qr_code_url}
            cancelling={{
              any: page.cancelling,
              thisTopup: page.cancelling && state.pendingTopupId === page.actionTopupId,
            }}
            onCancel={() =>
              state.pendingTopupId ? void page.cancelTopup(state.pendingTopupId) : dispatch({ type: 'back' })
            }
            onBack={() => dispatch({ type: 'back' })}
          />
        )}

        {step === 'success' && customer && result && (
          <TopupSuccessStep
            customer={customer}
            result={result}
            arkRate={arkRate}
            topupRp={topupRp}
            creditRp={creditRp}
            payment={state.payment}
            onNewTopup={() => dispatch({ type: 'newTopup' })}
          />
        )}
      </div>

      <CustomerSearchModal
        open={modal.open}
        customers={page.modalCustomers}
        search={modal.search}
        selectedCustomerId={customer?.id ?? null}
        onSearchChange={modal.setSearch}
        onCreateCustomer={page.createCustomer}
        initialNfcUid={modal.pendingNfcUid}
        allowGuest={false}
        onSelect={(c) => {
          if (!c) {
            modal.close();
            return;
          }
          toast.success(`Member ${c.name || c.phone} selected`);
          page.selectCustomer({
            id: c.id,
            name: c.name,
            phone: c.phone,
            email: c.email,
            membership_tier: c.membership_tier,
            ark_coin_balance: Number(c.ark_coin_balance || 0),
            nfc_uid: c.nfc_uid,
          });
        }}
        onClose={modal.close}
      />
    </div>
  );
}
