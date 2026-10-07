"use client";

import { QRCodeSVG } from "qrcode.react";

/**
 * Kartu QRIS bergaya materi cetak standar Indonesia (permintaan owner
 * 2026-08-16, mengikuti contoh terpampang QRIS/GPN yang beredar):
 * logo QRIS kiri-atas + GPN kanan-atas, nama merchant, NMID, QR besar,
 * "SATU QRIS UNTUK SEMUA", dengan aksen segitiga merah khas.
 *
 * Murni presentational — dipakai dialog pembayaran kasir dan halaman
 * top-up. Logo resmi (SVG, Wikimedia Commons) di public/qris/.
 */
export function QrisCard({
  qrString,
  qrImageUrl,
  merchantName,
  nmid,
}: {
  /** Payload EMV QRIS — dirender jadi QR di sini */
  qrString?: string | null;
  /** Alternatif: URL gambar QR yang sudah jadi (jalur top-up) */
  qrImageUrl?: string | null;
  merchantName?: string | null;
  nmid?: string | null;
}) {
  return (
    <div className="relative w-full max-w-sm overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Aksen segitiga merah khas terpampang QRIS */}
      <div
        className="pointer-events-none absolute left-0 top-20 h-32 w-16 bg-[#e11d2e]"
        style={{ clipPath: "polygon(0 0, 100% 50%, 0 100%)" }}
      />
      <div
        className="pointer-events-none absolute -bottom-1 -right-1 h-16 w-16 bg-[#e11d2e]"
        style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
      />

      <div className="relative px-6 pb-5 pt-5">
        {/* Header: logo QRIS kiri, GPN kanan */}
        <div className="flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/qris/qris-logo.svg" alt="QRIS" className="h-9 w-auto" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/qris/gpn-logo.svg" alt="GPN" className="h-11 w-auto" />
        </div>

        {merchantName || nmid ? (
          <div className="mt-4 text-center">
            {merchantName ? (
              <div className="text-lg font-extrabold leading-snug text-gray-900">
                {merchantName}
              </div>
            ) : null}
            {nmid ? (
              <div className="mt-0.5 text-sm font-semibold tracking-wide text-gray-800">
                NMID : {nmid}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex justify-center">
          <div className="rounded-lg bg-white p-2">
            {qrString ? (
              <QRCodeSVG value={qrString} size={224} marginSize={1} />
            ) : qrImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrImageUrl} alt="QRIS" className="h-56 w-56 object-contain" />
            ) : null}
          </div>
        </div>

        <div className="mt-4 text-center">
          <div className="text-sm font-bold tracking-wide text-gray-900">
            SATU QRIS UNTUK SEMUA
          </div>
          <div className="mt-1 text-[11px] leading-snug text-gray-500">
            Cek aplikasi penyelenggara di: www.aspi-qris.id
          </div>
        </div>
      </div>
    </div>
  );
}
