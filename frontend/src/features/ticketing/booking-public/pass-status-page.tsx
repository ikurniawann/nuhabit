"use client";

// EPIC-028 B2 — status Season Pass publik: pending → tombol bayar; active →
// QR + kode + masa berlaku; expired/cancelled → info.

import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { formatDate, formatRupiah } from "@/lib/format";
import { usePassStatus } from "./queries";
import { PUBLIC_ENTRY_LABEL } from "./types";

export function PassStatusPage({ token }: { token: string }) {
  const { data: pass, isPending: loading } = usePassStatus(token);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!pass) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 bg-white px-6 text-center">
        <XCircle className="h-12 w-12 text-gray-300" />
        <p className="text-gray-600">Pass tidak ditemukan.</p>
      </div>
    );
  }

  const isActive = pass.status === "active";
  const isPending = pass.status === "pending";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-white px-6 py-10">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
          {pass.product_name}
        </p>
        <h1 className="mt-1 font-mono text-xl font-bold text-gray-900">
          {pass.pass_code}
        </h1>
        <p className="mt-1 text-sm text-gray-500">{pass.holder_name}</p>
      </div>

      {isActive ? (
        <div className="mt-8 flex flex-col items-center gap-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <QRCodeSVG value={pass.qr_value} size={220} />
          </div>
          <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Pass Aktif
          </div>
          <dl className="mt-2 w-full space-y-2 rounded-2xl border border-gray-100 bg-gray-50/60 p-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Berlaku</dt>
              <dd className="text-right font-medium text-gray-900">
                {formatDate(pass.valid_from, "—")} — {formatDate(pass.valid_until, "—")}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Kebijakan masuk</dt>
              <dd className="font-medium text-gray-900">
                {PUBLIC_ENTRY_LABEL[pass.entry_policy] ?? pass.entry_policy}
              </dd>
            </div>
            {pass.entry_policy === "limited_visits" && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Sisa kunjungan</dt>
                <dd className="font-medium text-gray-900">
                  {(pass.visit_quota_total ?? 0) - pass.visit_quota_used} /{" "}
                  {pass.visit_quota_total}
                </dd>
              </div>
            )}
          </dl>
          <p className="text-center text-xs text-gray-400">
            Tunjukkan / scan QR ini di gate untuk masuk.
          </p>
        </div>
      ) : isPending ? (
        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <Clock className="h-12 w-12 text-amber-400" />
          <p className="font-semibold text-gray-900">Menunggu pembayaran</p>
          <p className="text-sm text-gray-500">
            Selesaikan pembayaran {formatRupiah(pass.unit_price)} untuk mengaktifkan
            pass. Halaman ini akan otomatis menampilkan QR setelah lunas.
          </p>
          {pass.invoice_url && (
            <a
              href={pass.invoice_url}
              className="mt-2 w-full rounded-xl bg-emerald-600 py-3.5 text-center text-[15px] font-semibold text-white transition-colors hover:bg-emerald-700"
            >
              Lanjutkan Pembayaran
            </a>
          )}
        </div>
      ) : (
        <div className="mt-10 flex flex-col items-center gap-3 text-center">
          <XCircle className="h-12 w-12 text-gray-300" />
          <p className="font-semibold text-gray-900">
            {pass.status === "expired"
              ? "Pembayaran kedaluwarsa"
              : pass.status === "cancelled"
                ? "Pass dibatalkan"
                : `Status: ${pass.status}`}
          </p>
          <p className="text-sm text-gray-500">
            Silakan beli ulang atau hubungi loket.
          </p>
        </div>
      )}
    </div>
  );
}
