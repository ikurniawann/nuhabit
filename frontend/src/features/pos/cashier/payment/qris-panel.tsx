"use client";

import { AlertTriangle, Loader2 } from "lucide-react";

import { QrisCard } from "@/components/pos/QrisCard";
import { Button } from "@/components/ui/button";

import type { QrisCode } from "./payment-state";

interface QrisStatusPanelProps {
  preparing: boolean;
  qr: QrisCode | null;
  error: string | null;
}

export function QrisStatusPanel({ preparing, qr, error }: QrisStatusPanelProps) {
  return (
    <div className="rounded-xl border border-gray-200/70 bg-muted/30 p-4 text-sm">
      {preparing ? (
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Membuat QR dinamis…
        </span>
      ) : !qr ? (
        <span className="inline-flex items-center gap-2 text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Warning: {error || "QR belum dikonfigurasi"}
        </span>
      ) : (
        <div className="flex flex-col items-center gap-3">
          {qr.qr_string ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              QR tampil di dialog QRIS…
            </p>
          ) : (
            <span className="inline-flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              QR belum siap — coba pilih metode lain lalu kembali ke QRIS
            </span>
          )}
        </div>
      )}
    </div>
  );
}

interface QrisOverlayProps {
  qr: QrisCode;
  /** Settle sedang berjalan (Xendit lunas atau parent sedang submit). */
  settling: boolean;
  settleError: string | null;
  formatCurrency: (v: number) => string;
  onRetry: () => void;
  onPickOtherMethod: () => void;
}

/**
 * Dialog fokus QRIS (owner 2026-08-16): QR tampil bergaya terpampang QRIS
 * Indonesia (logo QRIS+GPN, merchant, NMID) menutupi modal bayar sampai
 * pembayaran terkonfirmasi atau kasir memilih metode lain.
 */
export function QrisOverlay({
  qr,
  settling,
  settleError,
  formatCurrency,
  onRetry,
  onPickOtherMethod,
}: QrisOverlayProps) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-full w-full max-w-sm flex-col items-center gap-3 overflow-y-auto">
        <QrisCard qrString={qr.qr_string} merchantName={qr.merchant_name} nmid={qr.nmid} />
        <div className="w-full max-w-sm rounded-xl bg-white/95 px-4 py-3 text-center shadow-sm">
          <div className="text-2xl font-bold tabular-nums text-gray-900">
            {formatCurrency(qr.amount)}
          </div>
          {settleError ? (
            <p className="mt-1 flex items-center justify-center gap-2 text-xs font-medium text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>Pembayaran diterima Xendit, tapi gagal disimpan: {settleError}</span>
            </p>
          ) : (
            <p className="mt-1 inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {settling ? "Pembayaran diterima, menyelesaikan…" : "Menunggu pembayaran pelanggan…"}
            </p>
          )}
        </div>
        {settleError ? (
          // Bug #3 fix (insiden 2026-08-25): uang SUDAH diterima Xendit —
          // jangan tawarkan "Pilih metode lain" di sini (risiko tagih dobel).
          // Hanya retry manual; kalau terus gagal, kasir tahu persis kenapa
          // dan bisa panggil supervisor.
          <Button type="button" className="bg-primary hover:bg-primary/90" onClick={onRetry}>
            Coba lagi
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="border-white/40 bg-white/90 hover:bg-white"
            disabled={settling}
            onClick={onPickOtherMethod}
          >
            Pilih metode lain
          </Button>
        )}
      </div>
    </div>
  );
}
