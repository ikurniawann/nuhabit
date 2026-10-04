// Fase D — kirim WA kode booking terbayar. Dipakai dua jalur: webhook
// Xendit (otomatis saat PAID) dan tombol "Kirim ulang WA" di dashboard
// Booking (D5). Best-effort: kegagalan WA tidak boleh menggagalkan
// transaksi pemanggil — pemanggil memutus sendiri apa arti hasil false.

import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import { appOrigin } from "@/lib/app-origin";

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
    return `Total: Rp${total.toLocaleString("id-ID")}\n\n`;
  }
  const paid = Math.round((total - discount) * 100) / 100;
  return (
    `Total: Rp${total.toLocaleString("id-ID")}\n` +
    `Potongan promo: -Rp${discount.toLocaleString("id-ID")}\n` +
    `Dibayar: Rp${paid.toLocaleString("id-ID")}\n\n`
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
  const baseUrl = appOrigin();
  const statusUrl = `${baseUrl}/booking/status/${booking.access_token}`;
  const message =
    `*Pembayaran diterima* ✅\n\n` +
    `Kode booking: *${booking.booking_code}*\n` +
    `Tanggal kunjungan: ${booking.visit_date}\n` +
    `Atas nama: ${booking.customer_name}\n` +
    buildTotalLines(booking) +
    (booking.gift_recipient_name
      ? `E-tiket HADIAH telah dikirim ke WA ${booking.gift_recipient_name}. ` +
        `Link di bawah adalah salinan untukmu:\n${statusUrl}`
      : `Tunjukkan QR di halaman ini ke petugas loket:\n${statusUrl}`);

  const result = await sendGatewayText(config, {
    target: booking.customer_phone,
    message,
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
  const baseUrl = appOrigin();
  const statusUrl = `${baseUrl}/booking/status/${booking.access_token}`;
  const message =
    `*Kamu menerima hadiah tiket!* 🎁

` +
    `Dari: ${booking.customer_name}
` +
    `Untuk: *${booking.gift_recipient_name}*
` +
    `Kode booking: *${booking.booking_code}*
` +
    `Tanggal kunjungan: ${booking.visit_date}

` +
    `Tunjukkan QR di halaman ini ke petugas loket:
${statusUrl}`;

  const result = await sendGatewayText(config, {
    target: booking.gift_recipient_phone,
    message,
  });
  if (!result.success) {
    console.error("[booking] kirim WA hadiah gagal:", result.reason);
    return { success: false, reason: result.reason };
  }
  return { success: true };
}
