import "server-only";
// Pemrosesan callback invoice Xendit (PAID/EXPIRED) untuk booking tiket
// dan Season Pass. Idempotent: transisi status pakai UPDATE ... WHERE
// status=... — callback ulang di-ACK tanpa efek ganda (WA tidak terkirim
// dua kali). WA best-effort: gagal WA ≠ gagal webhook. Verifikasi token
// & rate limit ada di route.

import { z } from "zod";
import { query, queryOne, withTransaction } from "@/lib/db";
import { formatRupiah } from "@/lib/format";
import { capturePromoRedemption, releasePromoRedemption } from "@/lib/promo/promo-server";
import { todayInJakarta } from "./booking";
import { sendBookingGiftWa, sendBookingPaidWa } from "./booking-wa";
import { sendPassPaidWa } from "./pass-wa";
import { addMonthsIso } from "./season-pass";

export const xenditCallbackSchema = z.object({
  id: z.string(),
  external_id: z.string(),
  status: z.string(),
  paid_at: z.string().optional(),
  // Nominal callback dicek silang dgn total booking — token webhook bocor
  // saja tidak cukup untuk menandai lunas dgn nominal ngawur.
  amount: z.number().optional(),
});

type XenditCallback = z.infer<typeof xenditCallbackSchema>;

/** Body ACK ke Xendit (selalu 200). `ignored` = callback sah tanpa aksi. */
export type WebhookAck = { success: true; ignored?: true };

const ACK: WebhookAck = { success: true };
const IGNORED: WebhookAck = { success: true, ignored: true };

const BOOKING_PREFIX = "tkt-booking-";
const PASS_PREFIX = "tkt-pass-";

const isPaid = (status: string) => status === "PAID" || status === "SETTLED";
const isUuid = (value: string) => z.string().uuid().safeParse(value).success;

/**
 * EPIC-028 B2 — invoice Season Pass. Aktivasi pass: valid_from = tanggal
 * bayar (rolling), valid_until = + validity_months.
 */
async function handlePassCallback(passId: string, callback: XenditCallback): Promise<WebhookAck> {
  if (isPaid(callback.status)) {
    const info = await queryOne<{ validity_months: number; unit_price: string }>(
      `SELECT pc.validity_months, sp.unit_price
       FROM ticketing.ticket_season_passes sp
       JOIN ticketing.ticket_pass_configs pc
         ON pc.ticket_product_id = sp.ticket_product_id
       WHERE sp.id = $1::uuid`,
      [passId]
    );
    if (!info) return IGNORED;
    if (callback.amount !== undefined && callback.amount < Math.floor(Number(info.unit_price))) {
      console.error(
        `[pass] webhook PAID nominal janggal: pass ${passId} harga ${info.unit_price}, ` +
          `callback ${callback.amount} — diabaikan`
      );
      return IGNORED;
    }
    const today = todayInJakarta();
    const activated = await queryOne<{
      pass_code: string;
      access_token: string;
      holder_name: string;
      holder_phone: string | null;
      valid_until: string;
    }>(
      `UPDATE ticketing.ticket_season_passes
       SET status = 'active', paid_at = COALESCE($2::timestamptz, now()),
           valid_from = $3, valid_until = $4, activated_at = now(),
           xendit_invoice_id = COALESCE(xendit_invoice_id, $5), updated_at = now()
       WHERE id = $1::uuid AND status = 'pending'
       RETURNING pass_code, access_token, holder_name, holder_phone,
                 valid_until::text AS valid_until`,
      [
        passId,
        callback.paid_at ?? null,
        today,
        addMonthsIso(today, info.validity_months),
        callback.id,
      ]
    );
    if (activated) await sendPassPaidWa(activated);
    return ACK;
  }
  if (callback.status === "EXPIRED") {
    await query(
      `UPDATE ticketing.ticket_season_passes
       SET status = 'cancelled', updated_at = now()
       WHERE id = $1::uuid AND status = 'pending'`,
      [passId]
    );
    return ACK;
  }
  return IGNORED;
}

const setWebhookAlert = (bookingId: string, alert: string) =>
  query(
    `UPDATE ticketing.ticket_bookings
     SET webhook_alert = $2, updated_at = now()
     WHERE id = $1::uuid`,
    [bookingId, alert]
  );

/**
 * Cek silang nominal (bila Xendit mengirimnya): amount < tagihan (total
 * GROSS − potongan promo, toleransi pembulatan 1 rupiah) → JANGAN tandai
 * lunas; simpan alert yang tampil di dashboard Booking. true = ditolak.
 */
async function rejectUnderpaid(bookingId: string, amount: number | undefined): Promise<boolean> {
  if (amount === undefined) return false;
  const expected = await queryOne<{ total: string; discount_amount: string }>(
    `SELECT total, discount_amount
     FROM ticketing.ticket_bookings WHERE id = $1::uuid`,
    [bookingId]
  );
  if (!expected) return false;
  const expectedPayable = Number(expected.total) - Number(expected.discount_amount);
  if (amount >= Math.floor(expectedPayable)) return false;

  console.error(
    `[booking] webhook PAID nominal janggal: booking ${bookingId} ` +
      `tagihan ${expectedPayable}, callback amount ${amount} — diabaikan`
  );
  await setWebhookAlert(
    bookingId,
    `Xendit melapor PAID dengan nominal ${formatRupiah(amount)} — kurang dari tagihan booking ${formatRupiah(expectedPayable)}. Pembayaran TIDAK ditandai lunas; periksa dashboard Xendit.`
  );
  return true;
}

async function markBookingPaid(bookingId: string, callback: XenditCallback): Promise<void> {
  // Uang menang atas tebakan expiry: PAID juga membangkitkan booking yang
  // terlanjur di-lazy-expire. `dibatalkan` TIDAK dibangkitkan — itu
  // keputusan manusia; kasusnya dicatat utk tindak lanjut manual.
  const paid = await queryOne<{
    id: string;
    booking_code: string;
    access_token: string;
    visit_date: string;
    customer_name: string;
    customer_phone: string;
    total: string;
    discount_amount: string | null;
    gift_recipient_name: string | null;
    gift_recipient_phone: string | null;
  }>(
    `UPDATE ticketing.ticket_bookings
     SET status = 'terbayar', paid_at = COALESCE($2::timestamptz, now()),
         xendit_invoice_id = COALESCE(xendit_invoice_id, $3),
         updated_at = now()
     WHERE id = $1::uuid AND status IN ('menunggu-bayar', 'kedaluwarsa')
     RETURNING id, booking_code, access_token, visit_date::text AS visit_date,
               customer_name, customer_phone, total, discount_amount,
               gift_recipient_name, gift_recipient_phone`,
    [bookingId, callback.paid_at ?? null, callback.id]
  );
  if (paid) {
    // EPIC-032 B1 — pemakaian promo jadi FINAL (held → captured);
    // idempoten, callback ulang tak menggandakan
    await withTransaction((client) =>
      capturePromoRedemption(client, "ticket_booking", bookingId)
    ).catch((err) => console.error("[booking] capture promo error:", err));
    await sendBookingPaidWa(paid);
    // EPIC-032 D2 — e-tiket hadiah ke penerima (best-effort)
    if (paid.gift_recipient_phone) await sendBookingGiftWa(paid);
    return;
  }

  // 0 baris = callback ulang yang sah (terbayar/digunakan) ATAU pembayaran
  // masuk utk booking dibatalkan — bedakan supaya kasus butuh-refund tidak
  // lenyap tanpa jejak.
  const current = await queryOne<{ status: string }>(
    `SELECT status FROM ticketing.ticket_bookings WHERE id = $1::uuid`,
    [bookingId]
  );
  if (current?.status === "dibatalkan") {
    console.error(
      `[booking] PAID diterima utk booking DIBATALKAN ${bookingId} — ` +
        `uang masuk tanpa tiket, perlu tindak lanjut manual/refund`
    );
    await setWebhookAlert(
      bookingId,
      "Pembayaran Xendit MASUK untuk booking yang sudah DIBATALKAN — uang diterima tanpa tiket. Perlu refund manual; catat di Catatan Refund."
    );
  }
}

async function handleBookingCallback(
  bookingId: string,
  callback: XenditCallback
): Promise<WebhookAck> {
  if (isPaid(callback.status)) {
    // Nominal ditolak → ACK 200 supaya Xendit tidak retry callback yang
    // memang kami tolak
    if (await rejectUnderpaid(bookingId, callback.amount)) return IGNORED;
    await markBookingPaid(bookingId, callback);
    return ACK;
  }
  if (callback.status === "EXPIRED") {
    const expired = await query<{ id: string }>(
      `UPDATE ticketing.ticket_bookings
       SET status = 'kedaluwarsa', updated_at = now()
       WHERE id = $1::uuid AND status = 'menunggu-bayar'
       RETURNING id`,
      [bookingId]
    );
    // EPIC-032 B1 — lepas hold promo (jatah kode kembali); idempoten
    if (expired.length > 0) {
      await withTransaction((client) =>
        releasePromoRedemption(client, "ticket_booking", bookingId)
      ).catch((err) => console.error("[booking] release promo error:", err));
    }
    return ACK;
  }
  // Status lain (PENDING dsb.) — ACK tanpa aksi
  return IGNORED;
}

/**
 * Arahkan callback ke handler pass/booking menurut prefix external_id.
 * external_id datang dari luar — id non-uuid & produk lain di-ACK
 * `ignored`, bukan error.
 */
export async function handleTicketingInvoiceCallback(
  callback: XenditCallback
): Promise<WebhookAck> {
  const externalId = callback.external_id;
  if (externalId.startsWith(PASS_PREFIX)) {
    const passId = externalId.slice(PASS_PREFIX.length);
    return isUuid(passId) ? handlePassCallback(passId, callback) : IGNORED;
  }
  if (externalId.startsWith(BOOKING_PREFIX)) {
    const bookingId = externalId.slice(BOOKING_PREFIX.length);
    return isUuid(bookingId) ? handleBookingCallback(bookingId, callback) : IGNORED;
  }
  // Callback produk lain (mis. topup nanti) — ACK saja, bukan error
  return IGNORED;
}
