"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Loader2 } from "lucide-react";
import {
  CFD_DONE_HOLD_MS,
  idleCfdState,
  subscribeCfdState,
  type CfdState,
} from "@/lib/pos/cfd";

/**
 * EPIC-024 — layar menghadap customer (monitor kedua PC kasir).
 * Read-only: subscribe state dari kasir via BroadcastChannel. Buka
 * window ini, drag ke monitor kedua, F11 fullscreen.
 * Redesign 23 Jul: light mode ala Airbnb (selaras wizard booking) —
 * bg putih, teks gray-900, panel kanan gray-50, aksen rose.
 */

const formatRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/**
 * Persentase pajak dihitung dari angka transaksi (tax ÷ dasar pengenaan),
 * BUKAN angka tetap — supaya label selalu sinkron dengan tarif yang benar-benar
 * dipakai kasir (lihat taxAmount di cashier-page.tsx), termasuk bila tarif
 * itu berubah di kemudian hari.
 */
const taxPercentLabel = (tax: number, subtotal: number, discount: number) => {
  const base = subtotal - discount;
  if (base <= 0) return null;
  return Math.round((tax / base) * 100);
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  credit_card: "Kartu",
  ark_coin: "ARK Coin",
  nfc_tab: "NFC Tab",
  gift_card: "Gift Card",
};

interface CustomerDisplayPageProps {
  venueName?: string | null;
  venueAddress?: string | null;
}

export function CustomerDisplayPage({
  venueName,
  venueAddress,
}: CustomerDisplayPageProps) {
  const [view, setView] = useState<CfdState>(() => idleCfdState());
  const listEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Layar done ditahan CFD_DONE_HOLD_MS — clearCart kasir langsung
    // mem-publish idle, customer tetap harus sempat membaca kembaliannya.
    // Penundaan diputuskan di callback (bukan saat render — hooks purity).
    let doneShownAt = 0;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeCfdState((next) => {
      if (next.status === "done") {
        doneShownAt = Date.now();
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        setView(next);
        return;
      }
      const remaining = CFD_DONE_HOLD_MS - (Date.now() - doneShownAt);
      if (next.status === "idle" && remaining > 0) {
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(() => setView(next), remaining);
        return;
      }
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      setView(next);
    });
    return () => {
      unsubscribe();
      if (holdTimer) clearTimeout(holdTimer);
    };
  }, []);

  // Item terbaru selalu terlihat
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [view.items.length]);

  const taxPercent = taxPercentLabel(view.tax, view.subtotal, view.discount);

  return (
    <div className="flex h-dvh flex-col bg-white text-gray-900">
      {/* ── Header venue: logo + nama + alamat, ala wizard booking ── */}
      <header className="flex items-center gap-4 border-b border-gray-100 px-8 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/icon-192.png"
          alt={venueName ?? "Logo"}
          className="h-12 w-12 shrink-0 rounded-2xl object-contain"
        />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold tracking-tight text-gray-900">
            {venueName || "Selamat Datang"}
          </p>
          {venueAddress ? (
            <p className="truncate text-sm text-gray-500">{venueAddress}</p>
          ) : null}
        </div>
      </header>
      {view.status === "idle" ? (
        <IdleScreen />
      ) : view.status === "done" ? (
        <DoneScreen state={view} />
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Daftar item */}
          <div className="flex min-h-0 flex-1 flex-col p-8">
            {view.member_name ? (
              <p className="mb-3 text-lg font-medium text-rose-500">
                Halo, {view.member_name} 👋
              </p>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto pr-2">
              <table className="w-full text-lg">
                <tbody>
                  {view.items.map((item, index) => (
                    <tr key={index} className="border-b border-gray-100">
                      <td className="py-3 pr-3">
                        <span className="text-gray-900">{item.name}</span>
                        <span className="ml-2 text-sm text-gray-400">
                          × {item.qty}
                        </span>
                      </td>
                      <td className="py-3 text-right font-medium tabular-nums text-gray-900">
                        {formatRp(item.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div ref={listEndRef} />
            </div>
          </div>

          {/* Panel total / pembayaran */}
          <div className="flex w-[42%] flex-col justify-between border-l border-gray-200 bg-gray-50 p-8">
            {view.status === "payment" && view.payment ? (
              <PaymentPanel state={view} />
            ) : (
              <div />
            )}
            <div className="space-y-1.5 text-right">
              <Row label="Subtotal" value={formatRp(view.subtotal)} muted />
              {view.discount > 0 ? (
                <Row
                  label="Diskon member"
                  value={`− ${formatRp(view.discount)}`}
                  accent
                />
              ) : null}
              {view.tax > 0 ? (
                <Row
                  label={taxPercent !== null ? `Pajak (${taxPercent}%)` : "Pajak"}
                  value={formatRp(view.tax)}
                  muted
                />
              ) : null}
              {view.ark_used > 0 ? (
                <Row
                  label="ARK Coin"
                  value={`− ${formatRp(view.ark_used)}`}
                  accent
                />
              ) : null}
              <div className="border-t border-gray-200 pt-3">
                <p className="text-sm uppercase tracking-widest text-gray-400">
                  Total
                </p>
                <p className="text-6xl font-bold tracking-tight text-gray-900">
                  {formatRp(view.total - view.ark_used)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  accent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between text-lg">
      <span className={accent ? "text-rose-500" : "text-gray-400"}>
        {label}
      </span>
      <span
        className={
          accent
            ? "font-medium tabular-nums text-rose-500"
            : muted
              ? "tabular-nums text-gray-600"
              : "tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}

function IdleScreen() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <p className="text-5xl font-semibold tracking-tight text-gray-900">
        Selamat Datang 👋
      </p>
      <p className="text-xl text-gray-500">
        Silakan lakukan pemesanan di kasir
      </p>
    </div>
  );
}

function PaymentPanel({ state }: { state: CfdState }) {
  const payment = state.payment!;
  if (payment.method === "qris") {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="text-xl font-semibold text-gray-900">Scan untuk bayar</p>
        {payment.qr_loading ? (
          <div className="flex h-64 w-64 items-center justify-center rounded-3xl border border-gray-200 bg-white">
            <Loader2 className="h-10 w-10 animate-spin text-rose-500" />
          </div>
        ) : payment.qr_string ? (
          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-[0_6px_16px_rgba(0,0,0,0.08)]">
            <QRCodeSVG value={payment.qr_string} size={256} />
          </div>
        ) : (
          <p className="text-gray-500">QR belum tersedia — tunggu kasir</p>
        )}
        <p className="text-sm text-gray-500">
          QRIS · nominal terkunci {formatRp(payment.amount)}
        </p>
      </div>
    );
  }
  if (payment.method === "cash") {
    return (
      <div className="space-y-2 text-right">
        <p className="text-xl font-semibold text-gray-900">Pembayaran Tunai</p>
        {payment.cash_received !== undefined && payment.cash_received > 0 ? (
          <>
            <Row label="Diterima" value={formatRp(payment.cash_received)} muted />
            {payment.change !== undefined && payment.change >= 0 ? (
              <div>
                <p className="text-sm uppercase tracking-widest text-gray-400">
                  Kembalian
                </p>
                <p className="text-4xl font-bold tabular-nums text-rose-500">
                  {formatRp(payment.change)}
                </p>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    );
  }
  return (
    <p className="text-right text-xl font-semibold text-gray-900">
      Pembayaran {METHOD_LABELS[payment.method] ?? payment.method}
    </p>
  );
}

function DoneScreen({ state }: { state: CfdState }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <p className="text-6xl">🙏</p>
      <p className="text-5xl font-semibold tracking-tight text-gray-900">
        Terima Kasih!
      </p>
      {state.done_change !== undefined && state.done_change > 0 ? (
        <p className="text-2xl font-medium tabular-nums text-rose-500">
          Kembalian: {formatRp(state.done_change)}
        </p>
      ) : null}
      <p className="text-lg text-gray-500">Sampai jumpa kembali ✨</p>
    </div>
  );
}
