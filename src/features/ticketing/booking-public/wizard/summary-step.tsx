"use client";

// Langkah RINGKASAN: detail pesanan, rombongan, kode promo (EPIC-032 B2)
// dan total bayar sebelum diarahkan ke invoice.

import type { Dispatch, ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { formatDateLong, formatRupiah } from "@/lib/format";
import {
  defaultGuestName,
  type CartLine,
  type GuestUnit,
} from "@/lib/ticketing/booking-wizard-cart";
import type { TimeSlot } from "../types";
import type { WizardAction, WizardState } from "./wizard-reducer";

interface SummaryStepProps {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  cart: CartLine[];
  units: GuestUnit[];
  selectedSlot: TimeSlot | null;
  totalQty: number;
  totalAmount: number;
  payable: number;
  error: string | null;
  promoChecking: boolean;
  onApplyPromo: () => void;
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-center justify-between">
    <dt className="text-gray-500">{label}</dt>
    <dd className="font-medium text-gray-900">{children}</dd>
  </div>
);

export function SummaryStep({
  state,
  dispatch,
  cart,
  units,
  selectedSlot,
  totalQty,
  totalAmount,
  payable,
  error,
  promoChecking,
  onApplyPromo,
}: SummaryStepProps) {
  const { promo } = state;
  const giftName = state.isGift ? state.giftName.trim() : "";

  return (
    <section className="mt-2 space-y-4 px-5 pt-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Periksa pesananmu</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pastikan semuanya benar sebelum lanjut ke pembayaran.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-3xl border border-gray-200 p-5 shadow-[0_6px_16px_rgba(0,0,0,0.10)]">
        <dl className="space-y-3 text-sm">
          <Row label="Tanggal kunjungan">{formatDateLong(state.visitDate)}</Row>
          {selectedSlot && (
            <Row label="Jam kunjungan">
              <span className="tabular-nums">
                {selectedSlot.label} · {selectedSlot.start_time}–{selectedSlot.end_time}
              </span>
            </Row>
          )}
          {giftName && <Row label="Hadiah untuk">🎁 {giftName}</Row>}
          <Row label="Pemesan">{state.customerName.trim()}</Row>
          <Row label="WhatsApp">{state.customerPhone}</Row>
        </dl>
        <div className="my-4 border-t border-gray-100" />
        <div className="space-y-2.5 text-sm">
          {cart.map((c) => (
            <div key={c.variant.variant_id} className="flex justify-between gap-3">
              <span className="text-gray-700">
                {c.product.name} — {c.variant.variant_name} × {c.qty}
              </span>
              <span className="font-medium tabular-nums text-gray-900">
                {formatRupiah(c.variant.price * c.qty)}
              </span>
            </div>
          ))}
        </div>
        {totalQty > 1 && (
          <>
            <div className="my-4 border-t border-gray-100" />
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
              Anggota rombongan
            </p>
            <ol className="space-y-1.5 text-sm text-gray-700">
              {units.map((unit) => (
                <li key={`${unit.variantId}-${unit.unitIndex}`} className="flex justify-between gap-3">
                  <span className="truncate">
                    {unit.position}.{" "}
                    {state.guestNames[unit.variantId]?.[unit.unitIndex]?.trim() ||
                      defaultGuestName(state.customerName, unit.position)}
                  </span>
                  <span className="shrink-0 text-xs text-gray-400">{unit.label}</span>
                </li>
              ))}
            </ol>
          </>
        )}

        <div className="my-4 border-t border-gray-100" />
        {promo ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-gray-700">
              Kode <b>{promo.code}</b> dipakai
              <button
                type="button"
                onClick={() => dispatch({ type: "clearPromo" })}
                className="ml-2 text-xs font-medium text-rose-500 underline"
              >
                Hapus
              </button>
            </span>
            <span className="font-medium tabular-nums text-emerald-600">
              −{formatRupiah(promo.discount)}
            </span>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              value={state.promoInput}
              onChange={(e) => dispatch({ type: "setPromoInput", value: e.target.value })}
              placeholder="Punya kode promo?"
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
            <button
              type="button"
              onClick={onApplyPromo}
              disabled={promoChecking || state.promoInput.trim().length < 3}
              className="shrink-0 rounded-xl border border-gray-900 px-4 py-2.5 text-sm font-semibold text-gray-900 disabled:opacity-40"
            >
              {promoChecking ? "…" : "Pakai"}
            </button>
          </div>
        )}
        {state.promoError && <p className="mt-2 text-xs text-red-600">{state.promoError}</p>}

        <div className="mt-4 space-y-1.5 border-t border-gray-200 pt-4">
          {promo && (
            <>
              <div className="flex justify-between text-sm text-gray-500">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatRupiah(totalAmount)}</span>
              </div>
              <div className="flex justify-between text-sm text-emerald-600">
                <span>Potongan promo</span>
                <span className="tabular-nums">−{formatRupiah(promo.discount)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between">
            <span className="text-base font-semibold text-gray-900">
              {promo ? "Total Bayar" : "Total"}
            </span>
            <span className="text-base font-semibold tabular-nums text-gray-900">
              {formatRupiah(payable)}
            </span>
          </div>
        </div>
      </div>
      <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-gray-500">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
        Setelah menekan <b>Bayar Sekarang</b> Anda diarahkan ke halaman pembayaran. Selesaikan dalam
        2 jam — lewat dari itu booking otomatis kedaluwarsa.
      </p>
    </section>
  );
}
