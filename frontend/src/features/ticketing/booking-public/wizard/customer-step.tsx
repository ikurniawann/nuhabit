"use client";

// Langkah PEMESAN: nama & WA pemesan, opsi hadiah (EPIC-032 D2), dan nama
// anggota rombongan per orang (opsional, kosong = default server).

import type { Dispatch } from "react";
import { ShieldCheck } from "lucide-react";
import { defaultGuestName, type GuestUnit } from "@/lib/ticketing/booking-wizard-cart";
import type { TextField, WizardAction, WizardState } from "./wizard-reducer";

const INPUT_CLASS =
  "mt-1.5 w-full rounded-xl border border-gray-300 px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

interface CustomerStepProps {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  units: GuestUnit[];
  totalQty: number;
  error: string | null;
}

export function CustomerStep({ state, dispatch, units, totalQty, error }: CustomerStepProps) {
  const field = (name: TextField, label: string, type: "text" | "tel", placeholder: string) => (
    <label className="block">
      <span className="text-sm font-medium text-gray-900">{label}</span>
      <input
        type={type}
        inputMode={type === "tel" ? "tel" : undefined}
        value={state[name]}
        onChange={(e) => dispatch({ type: "setText", field: name, value: e.target.value })}
        maxLength={type === "tel" ? 25 : 120}
        placeholder={placeholder}
        className={INPUT_CLASS}
      />
    </label>
  );

  return (
    <section className="mt-2 space-y-6 px-5 pt-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Siapa yang memesan?</h1>
        <p className="mt-1 text-sm text-gray-500">Kode booking & QR tiket dikirim lewat WhatsApp.</p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {field("customerName", "Nama lengkap", "text", "Nama sesuai identitas")}
        {field("customerPhone", "Nomor WhatsApp", "tel", "08xxxxxxxxxx")}
        <p className="flex items-start gap-2 text-xs leading-relaxed text-gray-500">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          Kode booking & QR tiket dikirim ke nomor WhatsApp ini setelah pembayaran berhasil.
        </p>

        <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-gray-200 px-4 py-3.5">
          <input
            type="checkbox"
            checked={state.isGift}
            onChange={(e) => dispatch({ type: "setGift", isGift: e.target.checked })}
            className="h-4 w-4 rounded border-gray-300 text-rose-500 focus:ring-rose-400"
          />
          <span className="text-sm font-medium text-gray-900">Kirim sebagai hadiah 🎁</span>
        </label>
        {state.isGift && (
          <div className="space-y-4 rounded-3xl border border-gray-200 p-5">
            {field("giftName", "Nama penerima", "text", "Nama penerima hadiah")}
            {field("giftPhone", "Nomor WhatsApp penerima", "tel", "08xxxxxxxxxx")}
            <p className="text-xs leading-relaxed text-gray-500">
              E-tiket (QR) dikirim ke WhatsApp penerima setelah pembayaran berhasil. Kamu tetap
              menerima bukti pembayaran.
            </p>
          </div>
        )}
      </div>

      {totalQty > 1 && (
        <div className="rounded-3xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900">
            Nama anggota rombongan <span className="text-xs font-normal text-gray-400">(opsional)</span>
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            Kosongkan bila tidak perlu — otomatis diberi nama{" "}
            <span className="font-medium">{defaultGuestName(state.customerName, 2)}</span>, dst.
            Nama ini tampil saat penukaran gelang di loket.
          </p>
          <div className="mt-4 space-y-3">
            {units.map((unit) => (
              <label
                key={`${unit.variantId}-${unit.unitIndex}`}
                className="block text-xs font-medium text-gray-500"
              >
                Tiket {unit.position} · {unit.label}
                <input
                  type="text"
                  value={state.guestNames[unit.variantId]?.[unit.unitIndex] ?? ""}
                  onChange={(e) =>
                    dispatch({
                      type: "setGuestName",
                      variantId: unit.variantId,
                      unitIndex: unit.unitIndex,
                      value: e.target.value,
                    })
                  }
                  maxLength={120}
                  placeholder={defaultGuestName(state.customerName, unit.position)}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-base font-normal text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
