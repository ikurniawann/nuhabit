"use client";

// Fase D3 — halaman status booking publik via capability token.
// menunggu-bayar: countdown + tombol bayar; terbayar: QR booking_code
// (dipindai loket saat redeem D4); digunakan/kedaluwarsa/dibatalkan:
// keterangan. Poll 10 dtk selama masih menunggu-bayar supaya halaman
// yang dibuka dari redirect Xendit berpindah sendiri ke "terbayar".
// Redesign 23 Jul: disamakan dengan wizard ala Airbnb — bg putih, heading
// besar rata kiri, kartu rounded-3xl ber-shadow lembut, CTA rose.

import type { ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  BadgeCheck,
  CircleSlash,
  Clock3,
  Loader2,
  TicketCheck,
  TimerOff,
} from "lucide-react";
import { formatDateLong, formatDateTime, formatRupiah } from "@/lib/format";
import { useBookingStatus } from "./queries";

const STATUS_VIEW: Record<
  string,
  {
    label: string;
    badge: string;
    icon: ReactNode;
    title: string;
    subtitle: string;
  }
> = {
  "menunggu-bayar": {
    label: "Menunggu Pembayaran",
    badge: "bg-amber-100 text-amber-800",
    icon: <Clock3 className="h-4 w-4" />,
    title: "Selesaikan pembayaranmu",
    subtitle:
      "Booking sudah dibuat — lakukan pembayaran sebelum batas waktu habis.",
  },
  terbayar: {
    label: "Terbayar",
    badge: "bg-emerald-100 text-emerald-800",
    icon: <BadgeCheck className="h-4 w-4" />,
    title: "Pembayaran berhasil! 🎉",
    subtitle:
      "Tunjukkan QR di bawah ke petugas loket pada tanggal kunjungan.",
  },
  digunakan: {
    label: "Sudah Digunakan",
    badge: "bg-blue-100 text-blue-800",
    icon: <TicketCheck className="h-4 w-4" />,
    title: "Tiket sudah digunakan",
    subtitle: "Booking ini sudah ditukar di loket. Selamat bermain!",
  },
  kedaluwarsa: {
    label: "Kedaluwarsa",
    badge: "bg-gray-200 text-gray-600",
    icon: <TimerOff className="h-4 w-4" />,
    title: "Booking kedaluwarsa",
    subtitle: "Batas waktu pembayaran terlewati. Silakan buat booking baru.",
  },
  dibatalkan: {
    label: "Dibatalkan",
    badge: "bg-red-100 text-red-700",
    icon: <CircleSlash className="h-4 w-4" />,
    title: "Booking dibatalkan",
    subtitle:
      "Bila sudah terlanjur membayar, hubungi petugas venue untuk proses pengembalian.",
  },
  hangus: {
    label: "Hangus",
    badge: "bg-orange-100 text-orange-700",
    icon: <TimerOff className="h-4 w-4" />,
    title: "Booking hangus",
    subtitle:
      "Masa berlaku tiket sudah lewat. Hubungi petugas venue bila ada kendala.",
  },
};

interface BookingStatusPageProps {
  token: string;
}

export function BookingStatusPage({ token }: BookingStatusPageProps) {
  const { data: booking, isPending } = useBookingStatus(token);

  if (isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-white">
        <Loader2 className="h-7 w-7 animate-spin text-rose-500" />
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-white px-6">
        <div className="max-w-sm text-center">
          <CircleSlash className="mx-auto h-10 w-10 text-gray-300" />
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-gray-900">
            Booking tidak ditemukan
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
            Tautan tidak valid atau sudah tidak berlaku. Periksa kembali link
            dari WhatsApp Anda.
          </p>
        </div>
      </div>
    );
  }

  const view = STATUS_VIEW[booking.status] ?? STATUS_VIEW["menunggu-bayar"];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-white md:max-w-2xl">
      <main className="flex-1 px-5 pb-16 pt-8">
        {/* ── Heading ala wizard: chip status + judul besar rata kiri ── */}
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${view.badge}`}
        >
          {view.icon}
          {view.label}
        </span>
        <h1 className="mt-3 text-[26px] font-semibold leading-tight tracking-tight text-gray-900">
          {view.title}
        </h1>
        <p className="mt-1.5 text-sm text-gray-500">{view.subtitle}</p>

        {booking.status === "terbayar" && (
          <section className="mt-6 rounded-3xl border border-gray-200 p-6 text-center shadow-[0_6px_16px_rgba(0,0,0,0.10)]">
            <div className="mx-auto w-fit rounded-2xl border border-gray-200 p-4">
              <QRCodeSVG
                value={booking.booking_code}
                size={192}
                marginSize={1}
              />
            </div>
            <p className="mt-4 text-xs uppercase tracking-wide text-gray-400">
              Kode booking
            </p>
            <p className="text-2xl font-bold tracking-widest text-gray-900">
              {booking.booking_code}
            </p>
            <p className="mx-auto mt-3 max-w-xs text-xs leading-relaxed text-gray-500">
              Tunjukkan QR ini ke petugas loket pada tanggal kunjungan untuk
              ditukar dengan gelang masuk.
            </p>
          </section>
        )}

        {booking.status === "menunggu-bayar" && (
          <section className="mt-6 rounded-3xl border border-gray-200 p-5 shadow-[0_6px_16px_rgba(0,0,0,0.08)]">
            <p className="flex items-start gap-2 text-sm leading-relaxed text-gray-600">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              <span>
                Selesaikan pembayaran sebelum{" "}
                <b className="text-gray-900">
                  {booking.expires_at
                    ? formatDateTime(booking.expires_at)
                    : "—"}
                </b>{" "}
                atau booking otomatis kedaluwarsa.
              </span>
            </p>
            {booking.invoice_url && (
              <a
                href={booking.invoice_url}
                className="mt-4 block w-full rounded-xl bg-rose-500 py-3.5 text-center text-[15px] font-semibold text-white transition-colors hover:bg-rose-600"
              >
                Bayar Sekarang — {formatRupiah(booking.payable ?? booking.total)}
              </a>
            )}
            <p className="mt-3 text-center text-xs text-gray-400">
              Halaman ini memperbarui status secara otomatis setelah pembayaran.
            </p>
          </section>
        )}

        {booking.status === "digunakan" && booking.used_at && (
          <section className="mt-6 rounded-3xl border border-gray-200 p-5 text-sm leading-relaxed text-gray-600">
            Booking ditukar di loket pada{" "}
            <b className="text-gray-900">{formatDateTime(booking.used_at)}</b>.
            Selamat bermain! 🎡
          </section>
        )}

        {/* Detail pesanan — kartu ringkasan ala wizard */}
        <section className="mt-4 rounded-3xl border border-gray-200 p-5 shadow-[0_6px_16px_rgba(0,0,0,0.08)]">
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Tanggal kunjungan</dt>
              <dd className="font-medium text-gray-900">
                {formatDateLong(booking.visit_date)}
              </dd>
            </div>
            {booking.gift_recipient_name && (
              <div className="flex items-center justify-between">
                <dt className="text-gray-500">Hadiah untuk</dt>
                <dd className="font-medium text-gray-900">
                  🎁 {booking.gift_recipient_name}
                </dd>
              </div>
            )}
            {booking.slot_start_time && (
              <div className="flex items-center justify-between">
                <dt className="text-gray-500">Jam kunjungan</dt>
                <dd className="font-medium tabular-nums text-gray-900">
                  {booking.slot_label ? `${booking.slot_label} · ` : ""}
                  {booking.slot_start_time}–{booking.slot_end_time}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between">
              <dt className="text-gray-500">Atas nama</dt>
              <dd className="font-medium text-gray-900">
                {booking.customer_name}
              </dd>
            </div>
            {booking.paid_at && (
              <div className="flex items-center justify-between">
                <dt className="text-gray-500">Dibayar</dt>
                <dd className="font-medium text-gray-900">
                  {formatDateTime(booking.paid_at)}
                </dd>
              </div>
            )}
          </dl>
          <div className="my-4 border-t border-gray-100" />
          <div className="space-y-2.5 text-sm">
            {booking.items.map((item, i) => (
              <div key={i} className="flex justify-between gap-3">
                <span className="text-gray-700">
                  {item.product_name} — {item.variant_name} × {item.qty}
                </span>
                <span className="font-medium tabular-nums text-gray-900">
                  {formatRupiah(item.subtotal)}
                </span>
              </div>
            ))}
          </div>
          {booking.guests.length > 1 && (
            <>
              <div className="my-4 border-t border-gray-100" />
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                Anggota rombongan
              </p>
              <ol className="space-y-1.5 text-sm text-gray-700">
                {booking.guests.map((guest, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="truncate">
                      {i + 1}. {guest.guest_name}
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">
                      {guest.variant_name}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
          <div className="mt-4 space-y-1.5 border-t border-gray-200 pt-4">
            {booking.discount_amount > 0 && (
              <>
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatRupiah(booking.total)}</span>
                </div>
                <div className="flex justify-between text-sm text-emerald-600">
                  <span>
                    Potongan promo
                    {booking.promo_code ? ` (${booking.promo_code})` : ""}
                  </span>
                  <span className="tabular-nums">
                    −{formatRupiah(booking.discount_amount)}
                  </span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span className="text-base font-semibold text-gray-900">
                {booking.discount_amount > 0 ? "Total Bayar" : "Total"}
              </span>
              <span className="text-base font-semibold tabular-nums text-gray-900">
                {formatRupiah(
                  booking.discount_amount > 0
                    ? (booking.payable ?? booking.total)
                    : booking.total
                )}
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
