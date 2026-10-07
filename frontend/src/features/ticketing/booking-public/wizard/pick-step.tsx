"use client";

// Layar PILIH (satu halaman ala tiket.com): hero venue → highlight → tanggal
// → slot jam (venue ber-timed-entry) → kartu paket dengan stepper qty.

import type { Dispatch } from "react";
import { CalendarDays, ChevronDown, MapPin, QrCode, ShieldCheck, Zap } from "lucide-react";
import { formatDateLong } from "@/lib/format";
import {
  WIZARD_MAX_DAYS_AHEAD,
  type CatalogProduct,
} from "@/lib/ticketing/booking-wizard-cart";
import { BookingCalendar, type UnavailableMap } from "../booking-calendar";
import type { TimeSlot } from "../types";
import { PackageCard } from "./package-card";
import type { WizardAction, WizardState } from "./wizard-reducer";

const HIGHLIGHTS = [
  { icon: Zap, label: "Konfirmasi instan" },
  { icon: QrCode, label: "E-tiket via WhatsApp" },
  { icon: ShieldCheck, label: "Tanpa cetak" },
];

interface PickStepProps {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  venueName: string;
  products: CatalogProduct[];
  loading: boolean;
  unavailable: UnavailableMap;
  slots: TimeSlot[];
  slotRequirementUnmet: boolean;
  minDate: string;
  maxDate: string;
  totalQty: number;
}

export function PickStep({
  state,
  dispatch,
  venueName,
  products,
  loading,
  unavailable,
  slots,
  slotRequirementUnmet,
  minDate,
  maxDate,
  totalQty,
}: PickStepProps) {
  const heroUrl = products.find((p) => p.thumbnail_url)?.thumbnail_url ?? null;
  const dateStatus = unavailable[state.visitDate];

  return (
    <>
      <section className="px-5 pt-4">
        <div className="relative overflow-hidden rounded-3xl">
          <div className="aspect-[16/9] w-full bg-gradient-to-br from-rose-400 via-rose-500 to-rose-600">
            {heroUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={heroUrl} alt={venueName} className="h-full w-full object-cover" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
          </div>
          <div className="absolute inset-x-0 bottom-0 p-4">
            <h1 className="text-xl font-bold leading-tight text-white drop-shadow-sm">
              {venueName || "Pesan Tiket"}
            </h1>
            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-white/90">
              <MapPin className="h-3.5 w-3.5" /> Tiket masuk resmi · e-ticket
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {HIGHLIGHTS.map(({ icon: Icon, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"
            >
              <Icon className="h-3.5 w-3.5 text-rose-500" /> {label}
            </span>
          ))}
        </div>
      </section>

      <section className="mt-6 px-5">
        <h2 className="text-base font-semibold text-gray-900">Tanggal kunjungan</h2>
        <button
          type="button"
          onClick={() => dispatch({ type: "toggleCalendar" })}
          className="mt-2 flex w-full items-center justify-between gap-3 rounded-2xl border border-gray-200 px-4 py-3.5 text-left transition-colors hover:border-gray-400"
        >
          <span className="flex items-center gap-3">
            <CalendarDays className="h-5 w-5 text-rose-500" />
            <span className="text-[15px] font-medium text-gray-900">
              {formatDateLong(state.visitDate)}
            </span>
          </span>
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${
              state.calendarOpen ? "rotate-180" : ""
            }`}
          />
        </button>
        {state.calendarOpen && (
          <div className="mt-3 rounded-3xl border border-gray-200 p-5 shadow-[0_6px_16px_rgba(0,0,0,0.08)]">
            <BookingCalendar
              value={state.visitDate}
              minDate={minDate}
              maxDate={maxDate}
              unavailable={unavailable}
              onChange={(date) => dispatch({ type: "pickDate", date })}
            />
          </div>
        )}
        {dateStatus && (
          <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {dateStatus === "closed"
              ? "Tanggal ini tidak menerima kunjungan — pilih tanggal lain."
              : "Tanggal ini sudah penuh — pilih tanggal lain."}
          </p>
        )}
        <p className="mt-2 px-1 text-xs text-gray-400">
          Harga bisa berbeda per tanggal · bisa dipesan sampai {WIZARD_MAX_DAYS_AHEAD} hari ke depan.
        </p>
      </section>

      {slots.length > 0 && !dateStatus && (
        <section className="mt-6 px-5">
          <h2 className="text-base font-semibold text-gray-900">Jam kunjungan</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {slots.map((slot) => {
              const soldOut = slot.status === "sold_out";
              const active = slot.slot_id === state.selectedSlotId;
              return (
                <button
                  key={slot.slot_id}
                  type="button"
                  disabled={soldOut}
                  onClick={() => dispatch({ type: "selectSlot", slotId: slot.slot_id })}
                  aria-pressed={active}
                  className={`rounded-2xl border px-4 py-2.5 text-left text-sm transition-colors ${
                    active
                      ? "border-gray-900 bg-gray-900 text-white"
                      : soldOut
                        ? "cursor-default border-gray-200 text-gray-300 line-through"
                        : "border-gray-200 text-gray-800 hover:border-gray-400"
                  }`}
                >
                  <span className="font-medium">{slot.label}</span>
                  <span className={`ml-2 tabular-nums ${active ? "text-gray-300" : "text-gray-500"}`}>
                    {slot.start_time}–{slot.end_time}
                  </span>
                  {soldOut ? <span className="ml-2 text-xs">Penuh</span> : null}
                </button>
              );
            })}
          </div>
          {slotRequirementUnmet && (
            <p className="mt-2 px-1 text-xs text-gray-400">Pilih jam kunjungan untuk lanjut.</p>
          )}
        </section>
      )}

      <section className="mt-6 px-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-gray-900">Pilih tiket</h2>
          <span className="text-xs text-gray-400">1 jenis / transaksi</span>
        </div>

        {loading ? (
          <div className="mt-4 space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-3xl bg-gray-100" />
            ))}
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            {products.map((product) => (
              <PackageCard
                key={product.ticket_product_id}
                product={product}
                isSelected={product.ticket_product_id === state.selectedProductId}
                qty={state.qty}
                totalQty={totalQty}
                onChangeQty={(p, variant, delta) =>
                  dispatch({ type: "changeQty", product: p, variant, delta })
                }
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
