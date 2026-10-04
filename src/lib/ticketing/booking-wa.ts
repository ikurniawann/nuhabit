// Fase D — kirim WA kode booking terbayar. Dipakai dua jalur: webhook
// Xendit (otomatis saat PAID) dan tombol "Kirim ulang WA" di dashboard
// Booking (D5). Best-effort: kegagalan WA tidak boleh menggagalkan
// transaksi pemanggil — pemanggil memutus sendiri apa arti hasil false.

import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import { appOrigin } from "@/lib/app-origin";
import { formatDateLong, formatRupiah } from "@/lib/format";

export interface PaidBookingWaInput {
  booking_code: string;
  access_token: string;
  visit_date: string;
  customer_name: string;
  customer_phone: string;
  total: string | number;
  /** EPIC-032 B1 — potongan promo (opsional; 0/undefined = tanpa promo). */
  discount_amount?: string | number | null;
  /** EPIC-032 D2 — hadiah: e-tiket dikirim ke penerima (bukan pemesan). */
  gift_recipient_name?: string | null;
  gift_recipient_phone?: string | null;
}

/** Baris total: tanpa promo = 1 baris; dgn promo = rincian potongan. */
function buildTotalLines(booking: PaidBookingWaInput): string {
  const total = Number(booking.total);
  const discount = Number(booking.discount_amount ?? 0);
  if (discount <= 0) {
    return `Total: ${formatRupiah(total)}\n\n`;
  }
  const paid = Math.round((total - discount) * 100) / 100;
  return (
    `Total: ${formatRupiah(total)}\n` +
    `Potongan promo: -${formatRupiah(discount)}\n` +
    `Dibayar: ${formatRupiah(paid)}\n\n`
  );
}

const bookingStatusUrl = (booking: PaidBookingWaInput) =>
  `${appOrigin()}/booking/status/${booking.access_token}`;

/** Pesan WA ke pemesan saat booking terbayar. */
export function buildBookingPaidMessage(booking: PaidBookingWaInput): string {
  const statusUrl = bookingStatusUrl(booking);
  return (
    `*Pembayaran diterima* ✅\n\n` +
    `Kode booking: *${booking.booking_code}*\n` +
    `Tanggal kunjungan: ${formatDateLong(booking.visit_date)}\n` +
    `Atas nama: ${booking.customer_name}\n` +
    buildTotalLines(booking) +
    (booking.gift_recipient_name
      ? `E-tiket HADIAH telah dikirim ke WA ${booking.gift_recipient_name}. ` +
        `Link di bawah adalah salinan untukmu:\n${statusUrl}`
      : `Tunjukkan QR di halaman ini ke petugas loket:\n${statusUrl}`)
  );
}

/** Pesan WA e-tiket hadiah ke penerima. */
export function buildBookingGiftMessage(booking: PaidBookingWaInput): string {
  return (
    `*Kamu menerima hadiah tiket!* 🎁\n\n` +
    `Dari: ${booking.customer_name}\n` +
    `Untuk: *${booking.gift_recipient_name}*\n` +
    `Kode booking: *${booking.booking_code}*\n` +
    `Tanggal kunjungan: ${formatDateLong(booking.visit_date)}\n\n` +
    `Tunjukkan QR di halaman ini ke petugas loket:\n${bookingStatusUrl(booking)}`
  );
}

export async function sendBookingPaidWa(
  booking: PaidBookingWaInput
): Promise<{ success: boolean; reason?: string }> {
  const config = await loadGatewayConfig();
  if (!config) {
    console.error(
      "[booking] WA gateway belum dikonfigurasi — kode booking tidak terkirim"
    );
    return { success: false, reason: "gateway-belum-dikonfigurasi" };
  }
  const result = await sendGatewayText(config, {
    target: booking.customer_phone,
    message: buildBookingPaidMessage(booking),
  });
  if (!result.success) {
    console.error("[booking] kirim WA gagal:", result.reason);
    return { success: false, reason: result.reason };
  }
  return { success: true };
}

/**
 * EPIC-032 D2 — e-tiket HADIAH ke WA penerima (dipanggil setelah PAID,
 * best-effort seperti WA pemesan). Penerima mendapat link status ber-QR
 * yang sama — tanpa halaman klaim (keputusan owner 26 Jul).
 */
export async function sendBookingGiftWa(
  booking: PaidBookingWaInput
): Promise<{ success: boolean; reason?: string }> {
  if (!booking.gift_recipient_name || !booking.gift_recipient_phone) {
    return { success: false, reason: "bukan-hadiah" };
  }
  const config = await loadGatewayConfig();
  if (!config) {
    console.error(
      "[booking] WA gateway belum dikonfigurasi — e-tiket hadiah tidak terkirim"
    );
    return { success: false, reason: "gateway-belum-dikonfigurasi" };
  }
  const result = await sendGatewayText(config, {
    target: booking.gift_recipient_phone,
    message: buildBookingGiftMessage(booking),
  });
  if (!result.success) {
    console.error("[booking] kirim WA hadiah gagal:", result.reason);
    return { success: false, reason: result.reason };
  }
  return { success: true };
}
