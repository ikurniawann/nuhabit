"use client";

// Booking publik tanpa login (struktur ala tiket.com "to-do"): layar SATU
// halaman untuk pemilihan tiket, lalu langkah pemesan → ringkasan → invoice
// Xendit. State wizard = reducer murni (wizard/wizard-reducer.ts); aturan
// keranjang & payload = @/lib/ticketing/booking-wizard-cart; data = hook
// React Query di ./queries. Harga di sini murni tampilan; server menghitung
// ulang saat POST.

import { useMemo, useReducer, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { formatDate, formatRupiah } from "@/lib/format";
import {
  WIZARD_MAX_DAYS_AHEAD,
  buildBookingPayload,
  buildCart,
  cartAmount,
  cartPersons,
  flattenGuestUnits,
  isCustomerValid,
  isSlotRequirementUnmet,
  payableAmount,
} from "@/lib/ticketing/booking-wizard-cart";
import { addDaysIso } from "@/lib/ticketing/calendar";
import { todayIso } from "@/lib/ticketing/ui-dates";
import {
  useBookingAvailability,
  useBookingCatalog,
  useBookingSlots,
  useCreateBooking,
  usePromoCheck,
} from "./queries";
import { CustomerStep } from "./wizard/customer-step";
import { PickStep } from "./wizard/pick-step";
import { SummaryStep } from "./wizard/summary-step";
import { STEP_ORDER, initialWizardState, wizardReducer } from "./wizard/wizard-reducer";

const CTA_CLASS =
  "rounded-xl bg-rose-500 text-[15px] font-semibold text-white transition-colors hover:bg-rose-600";

export function BookingWizard({ slug }: { slug: string }) {
  const [minDate] = useState(() => todayIso());
  const maxDate = addDaysIso(minDate, WIZARD_MAX_DAYS_AHEAD);
  const [state, dispatch] = useReducer(wizardReducer, minDate, initialWizardState);
  const { step, visitDate } = state;

  const catalogQuery = useBookingCatalog(slug, visitDate);
  const unavailable = useBookingAvailability(slug, minDate, maxDate).data ?? {};
  const slots = useBookingSlots(slug, visitDate).data ?? [];
  const promoCheck = usePromoCheck(slug);
  const createBooking = useCreateBooking(slug);

  const products = useMemo(() => catalogQuery.data?.products ?? [], [catalogQuery.data]);
  const catalogLoading = catalogQuery.isPending || catalogQuery.isPlaceholderData;
  const catalogError = catalogQuery.isError
    ? catalogQuery.error.message
    : catalogQuery.isSuccess && products.length === 0
      ? "Tidak ada tiket tersedia untuk tanggal ini"
      : null;

  const cart = useMemo(() => buildCart(products, state.qty), [products, state.qty]);
  const units = useMemo(() => flattenGuestUnits(cart), [cart]);
  const totalQty = cartPersons(cart);
  const totalAmount = cartAmount(cart);
  const payable = payableAmount(totalAmount, state.promo?.discount ?? 0);

  const dateUnavailable = unavailable[visitDate] !== undefined;
  const selectedSlot = slots.find((s) => s.slot_id === state.selectedSlotId) ?? null;
  const slotRequirementUnmet = isSlotRequirementUnmet(slots, state.selectedSlotId);
  const selectedProduct = products.find((p) => p.ticket_product_id === state.selectedProductId);
  // Tetap "memproses" setelah sukses sampai browser pindah ke invoice
  const submitting = createBooking.isPending || createBooking.isSuccess;
  const submitError = createBooking.error?.message ?? null;
  const stepIndex = STEP_ORDER.indexOf(step);

  const applyPromo = () => {
    const code = state.promoInput.trim();
    if (!code || promoCheck.isPending) return;
    dispatch({ type: "clearPromo" });
    promoCheck.mutate(
      { code, subtotal: totalAmount, phone: state.customerPhone.trim() || undefined },
      {
        onSuccess: (result) =>
          dispatch(
            result.ok
              ? {
                  type: "promoApplied",
                  promo: { code: code.toUpperCase(), discount: result.discount, campaign_name: result.campaign_name },
                }
              : { type: "promoRejected", message: result.message ?? "Kode tidak berlaku" }
          ),
        onError: (error) => dispatch({ type: "promoRejected", message: error.message }),
      }
    );
  };

  const submitBooking = () => {
    if (submitting) return;
    createBooking.mutate(
      buildBookingPayload({ ...state, promoCode: state.promo?.code ?? null, cart }),
      {
        // Kode promo ditolak server (422) → lepas supaya bisa lanjut tanpa kode
        onError: (error) => {
          if (error.status === 422) dispatch({ type: "promoRejected", message: error.message });
        },
      }
    );
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-white md:max-w-2xl">
      <header className="sticky top-0 z-20 bg-white/95 px-5 pt-4 backdrop-blur">
        <div className="flex h-9 items-center">
          {step !== "pilih" && (
            <button
              type="button"
              aria-label="Kembali"
              onClick={() => dispatch({ type: "back" })}
              className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full text-gray-800 hover:bg-gray-100"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <span className="ml-auto rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700">
            {formatDate(visitDate)}
            {totalQty > 0 ? ` · ${totalQty} tiket` : ""}
          </span>
        </div>
        <div className="mt-3 flex gap-1">
          {STEP_ORDER.map((s, i) => (
            <div
              key={s}
              className={`h-[3px] flex-1 rounded-full transition-colors ${
                i <= stepIndex ? "bg-gray-900" : "bg-gray-200"
              }`}
            />
          ))}
        </div>
      </header>

      <main className="flex-1 pb-32">
        {step === "pilih" && (
          <>
            {catalogError && !catalogLoading && (
              <div className="mx-5 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {catalogError}
              </div>
            )}
            <PickStep
              state={state}
              dispatch={(action) => {
                // Ganti tanggal juga membuang error submit lama
                if (action.type === "pickDate") createBooking.reset();
                dispatch(action);
              }}
              venueName={catalogQuery.data?.venueName ?? ""}
              products={products}
              loading={catalogLoading}
              unavailable={unavailable}
              slots={slots}
              slotRequirementUnmet={slotRequirementUnmet}
              minDate={minDate}
              maxDate={maxDate}
              totalQty={totalQty}
            />
          </>
        )}
        {step === "pemesan" && (
          <CustomerStep
            state={state}
            dispatch={dispatch}
            units={units}
            totalQty={totalQty}
            error={submitError}
          />
        )}
        {step === "ringkasan" && (
          <SummaryStep
            state={state}
            dispatch={dispatch}
            cart={cart}
            units={units}
            selectedSlot={selectedSlot}
            totalQty={totalQty}
            totalAmount={totalAmount}
            payable={payable}
            error={submitError}
            promoChecking={promoCheck.isPending}
            onApplyPromo={applyPromo}
          />
        )}
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-lg border-t border-gray-200 bg-white px-5 py-3.5 md:max-w-2xl">
        {step === "pilih" && (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              {totalQty > 0 ? (
                <>
                  <p className="truncate text-base font-semibold tabular-nums text-gray-900">
                    {formatRupiah(totalAmount)}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {selectedProduct?.name} · {totalQty} tiket
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-500">Pilih jumlah tiket untuk lanjut</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dispatch({ type: "next" })}
              disabled={totalQty === 0 || dateUnavailable || slotRequirementUnmet}
              className={`shrink-0 px-8 py-3.5 ${CTA_CLASS} disabled:opacity-40 disabled:hover:bg-rose-500`}
            >
              Lanjut
            </button>
          </div>
        )}
        {step === "pemesan" && (
          <button
            type="button"
            onClick={() => dispatch({ type: "next" })}
            disabled={!isCustomerValid(state)}
            className={`w-full py-3.5 ${CTA_CLASS} disabled:opacity-40 disabled:hover:bg-rose-500`}
          >
            Lihat Ringkasan
          </button>
        )}
        {step === "ringkasan" && (
          <button
            type="button"
            onClick={submitBooking}
            disabled={submitting}
            className={`flex w-full items-center justify-center gap-2 py-3.5 ${CTA_CLASS} disabled:opacity-60`}
          >
            {submitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Memproses…
              </>
            ) : (
              <>Bayar Sekarang — {formatRupiah(payable)}</>
            )}
          </button>
        )}
      </footer>
    </div>
  );
}
