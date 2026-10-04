import "server-only";
// Booking website di dashboard & loket (Fase D4/D5): daftar, lookup kode
// (scan QR), rincian, catatan refund / tutup alert, batal, kirim ulang WA.
// Keputusan owner 2026-07-22: loket boleh LIHAT & resend WA; aksi
// ber-uang (cancel/catatan refund) tetap admin di route-nya.

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { releasePromoRedemption } from "@/lib/promo/promo-server";
import {
  BOOKING_STATUSES,
  isForfeitDue,
  redeemWindowStatus,
  todayInJakarta,
} from "./booking";
import { expireBookingIfDue, loadBookingItems, publicItem } from "./booking-server";
import { sendBookingGiftWa, sendBookingPaidWa } from "./booking-wa";
import { isValidCalendarDate } from "./pricing";
import type { TicketingContext } from "./server";
import { splitTotalCount } from "./sql";

const BOOKING_NOT_FOUND = "Booking tidak ditemukan";

/** Id booking dari URL; bukan uuid → 404 (sama seperti tak ditemukan). */
export function requireBookingId(id: string): string {
  if (!z.string().uuid().safeParse(id).success) throw ApiError.notFound("Booking tidak dikenal");
  return id;
}

// ── Daftar ────────────────────────────────────────────────────────────

interface BookingListRow {
  id: string;
  booking_code: string;
  visit_date: string;
  customer_name: string;
  customer_phone: string;
  status: string;
  total: string;
  paid_at: string | null;
  used_at: string | null;
  visit_id: string | null;
  refund_note: string | null;
  webhook_alert: string | null;
  created_at: string;
  total_count: string;
}

/** Filter: tanggal kunjungan, status, cari kode/nama/WA. */
export async function listBookings(
  ctx: TicketingContext,
  filter: { date: string; status: string; q: string; page: number; limit: number }
) {
  const conditions = ["b.branch_id = $1", "b.company_id = $2"];
  const params: unknown[] = [ctx.branchId, ctx.companyId];
  if (isValidCalendarDate(filter.date)) {
    params.push(filter.date);
    conditions.push(`b.visit_date = $${params.length}`);
  }
  if ((BOOKING_STATUSES as readonly string[]).includes(filter.status)) {
    params.push(filter.status);
    conditions.push(`b.status = $${params.length}`);
  }
  if (filter.q) {
    params.push(`%${filter.q}%`);
    conditions.push(
      `(b.booking_code ILIKE $${params.length}
        OR b.customer_name ILIKE $${params.length}
        OR b.customer_phone ILIKE $${params.length})`
    );
  }

  params.push(filter.limit, (filter.page - 1) * filter.limit);
  const rows = await query<BookingListRow>(
    `SELECT b.id, b.booking_code, b.visit_date::text AS visit_date,
            b.customer_name, b.customer_phone, b.status, b.total,
            b.paid_at::text AS paid_at, b.used_at::text AS used_at,
            b.visit_id, b.refund_note, b.webhook_alert,
            b.created_at::text AS created_at,
            COUNT(*) OVER() AS total_count
     FROM ticketing.ticket_bookings b
     WHERE ${conditions.join(" AND ")}
     ORDER BY b.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const { total, items } = splitTotalCount(rows);
  return { total, items: items.map((booking) => ({ ...booking, total: Number(booking.total) })) };
}

// ── Lookup kode di loket ──────────────────────────────────────────────

interface BookingLookupRow {
  id: string;
  booking_code: string;
  visit_date: string;
  customer_name: string;
  gift_recipient_name: string | null;
  customer_phone: string;
  status: string;
  total: string;
  paid_at: string | null;
  used_at: string | null;
  visit_id: string | null;
}

/**
 * Loket mencari booking dari kode (venue sendiri; booking_code unik per
 * branch). Lookup tidak mengubah status kecuali lazy expiry menunggu-bayar
 * yang basi dan lazy forfeit terbayar yang lewat masa berlaku.
 */
export async function lookupBooking(ctx: TicketingContext, code: string) {
  const booking = await queryOne<BookingLookupRow>(
    `SELECT id, booking_code, visit_date::text AS visit_date, customer_name,
            customer_phone, status, total, paid_at::text AS paid_at,
            used_at::text AS used_at, visit_id,
            gift_recipient_name
     FROM ticketing.ticket_bookings
     WHERE branch_id = $1 AND company_id = $2 AND booking_code = $3`,
    [ctx.branchId, ctx.companyId, code]
  );
  if (!booking) throw ApiError.notFound(`Booking ${code} tidak ditemukan di venue ini`);

  let status = booking.status;
  if (status === "menunggu-bayar" && (await expireBookingIfDue(booking.id))) {
    status = "kedaluwarsa";
  }

  // Kebijakan hangus venue (keputusan owner 2026-07-23): masa berlaku
  // redeem = hari-H + N hari; NULL = hanya hari-H, tanpa hangus.
  const settingsRow = await queryOne<{ booking_forfeit_days: number | null }>(
    `SELECT booking_forfeit_days FROM ticketing.ticket_settings
     WHERE branch_id = $1 AND company_id = $2`,
    [ctx.branchId, ctx.companyId]
  );
  const forfeitDays = settingsRow?.booking_forfeit_days ?? null;
  const today = todayInJakarta();

  // Lazy forfeit — loket melihat kebenaran terkini walau watcher belum
  // sempat lewat; UPDATE-WHERE-status idempotent (pola lazy expiry).
  if (status === "terbayar" && isForfeitDue(booking.visit_date, today, forfeitDays)) {
    const forfeited = await queryOne<{ id: string }>(
      `UPDATE ticketing.ticket_bookings
       SET status = 'hangus', forfeited_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'terbayar' AND visit_id IS NULL
       RETURNING id`,
      [booking.id]
    );
    if (forfeited) status = "hangus";
  }

  const [items, guests] = await Promise.all([
    loadBookingItems(booking.id),
    // Anggota rombongan — bekal pairing gelang per orang di dialog redeem
    query<{
      id: string;
      guest_name: string;
      position: number;
      variant_id: string;
      product_name: string;
      variant_name: string;
    }>(
      `SELECT g.id, g.guest_name, g.position, g.variant_id,
              i.product_name, i.variant_name
       FROM ticketing.ticket_booking_guests g
       JOIN ticketing.ticket_booking_items i ON i.id = g.booking_item_id
       WHERE g.booking_id = $1
       ORDER BY g.position`,
      [booking.id]
    ),
  ]);

  return {
    id: booking.id,
    booking_code: booking.booking_code,
    visit_date: booking.visit_date,
    customer_name: booking.customer_name,
    customer_phone: booking.customer_phone,
    // EPIC-032 D2 — loket melihat booking hadiah + nama penerimanya
    gift_recipient_name: booking.gift_recipient_name,
    status,
    total: Number(booking.total),
    paid_at: booking.paid_at,
    used_at: booking.used_at,
    visit_id: booking.visit_id,
    // UI menampilkan alasan tanpa menebak ulang aturan server
    redeemable:
      status === "terbayar" &&
      redeemWindowStatus(booking.visit_date, today, forfeitDays) === "boleh",
    today,
    items: items.map((i) => ({
      variant_id: i.variant_id,
      ticket_product_id: i.ticket_product_id,
      ...publicItem(i),
    })),
    guests,
  };
}

// ── Rincian & catatan ─────────────────────────────────────────────────

interface BookingDetailRow {
  id: string;
  booking_code: string;
  visit_date: string;
  customer_name: string;
  customer_phone: string;
  status: string;
  total: string;
  xendit_invoice_url: string | null;
  paid_at: string | null;
  expires_at: string | null;
  used_at: string | null;
  visit_id: string | null;
  refund_note: string | null;
  webhook_alert: string | null;
  created_at: string;
}

/**
 * Rincian booking utk dashboard. MVP: uang refund bergerak DI LUAR sistem
 * (transfer manual); dashboard hanya menyimpan jejak catatannya.
 */
export async function getBookingDetail(ctx: TicketingContext, id: string) {
  const booking = await queryOne<BookingDetailRow>(
    `SELECT id, booking_code, visit_date::text AS visit_date, customer_name,
            customer_phone, status, total, xendit_invoice_url,
            paid_at::text AS paid_at, expires_at::text AS expires_at,
            used_at::text AS used_at, visit_id, refund_note, webhook_alert,
            created_at::text AS created_at
     FROM ticketing.ticket_bookings
     WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
    [id, ctx.branchId, ctx.companyId]
  );
  if (!booking) throw ApiError.notFound(BOOKING_NOT_FOUND);

  const [items, guests] = await Promise.all([
    loadBookingItems(booking.id),
    query<{ guest_name: string; position: number; variant_name: string }>(
      `SELECT g.guest_name, g.position, i.variant_name
       FROM ticketing.ticket_booking_guests g
       JOIN ticketing.ticket_booking_items i ON i.id = g.booking_item_id
       WHERE g.booking_id = $1
       ORDER BY g.position`,
      [booking.id]
    ),
  ]);

  return { ...booking, total: Number(booking.total), items: items.map(publicItem), guests };
}

// PATCH melayani dua aksi kecil dashboard: simpan catatan refund manual
// dan/atau menutup alert webhook (anomali sudah ditindaklanjuti petugas).
export const bookingNotesSchema = z
  .object({
    refund_note: z.string().trim().min(1).max(500).optional(),
    clear_webhook_alert: z.literal(true).optional(),
  })
  .refine((body) => body.refund_note !== undefined || body.clear_webhook_alert, {
    message: "Tidak ada perubahan yang dikirim",
  });

export async function updateBookingNotes(
  ctx: TicketingContext,
  id: string,
  body: z.infer<typeof bookingNotesSchema>
): Promise<string> {
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [id, ctx.branchId, ctx.companyId];
  if (body.refund_note !== undefined) {
    values.push(body.refund_note);
    sets.push(`refund_note = $${values.length}`);
  }
  if (body.clear_webhook_alert) sets.push("webhook_alert = NULL");

  const updated = await queryOne<{ id: string }>(
    `UPDATE ticketing.ticket_bookings
     SET ${sets.join(", ")}
     WHERE id = $1 AND branch_id = $2 AND company_id = $3
     RETURNING id`,
    values
  );
  if (!updated) throw ApiError.notFound(BOOKING_NOT_FOUND);
  return updated.id;
}

// ── Batal ─────────────────────────────────────────────────────────────

/**
 * Batalkan booking (keputusan manusia, bukan otomatis). Hanya
 * menunggu-bayar / terbayar yang bisa dibatalkan (mesin status
 * booking.ts). Pembatalan booking TERBAYAR wajib menyertakan catatan
 * refund — uang sudah masuk, jejaknya tidak boleh kosong.
 */
export async function cancelBooking(
  ctx: TicketingContext,
  id: string,
  refundNote: string | null
): Promise<{ id: string; bookingCode: string }> {
  const current = await queryOne<{ status: string; booking_code: string }>(
    `SELECT status, booking_code FROM ticketing.ticket_bookings
     WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
    [id, ctx.branchId, ctx.companyId]
  );
  if (!current) throw ApiError.notFound(BOOKING_NOT_FOUND);
  if (current.status === "terbayar" && !refundNote) {
    throw ApiError.badRequest(
      "Booking sudah terbayar — wajib isi catatan refund (uang dikembalikan di luar sistem)"
    );
  }

  // Transisi atomik: hanya dari status yang sah (race dgn webhook/redeem
  // aman — kalah race berarti 0 baris → 409, bukan status tertimpa)
  const cancelled = await queryOne<{ id: string }>(
    `UPDATE ticketing.ticket_bookings
     SET status = 'dibatalkan',
         refund_note = COALESCE($4, refund_note),
         updated_at = now()
     WHERE id = $1 AND branch_id = $2 AND company_id = $3
       AND status IN ('menunggu-bayar', 'terbayar')
     RETURNING id`,
    [id, ctx.branchId, ctx.companyId, refundNote]
  );
  if (!cancelled) {
    throw ApiError.conflict(
      `Booking ${current.booking_code} tidak bisa dibatalkan dari status sekarang`
    );
  }
  // EPIC-032 B1 — batal melepas pemakaian promo (held ATAU captured);
  // best-effort idempoten
  await withTransaction((client) =>
    releasePromoRedemption(client, "ticket_booking", id)
  ).catch((err) => console.error("[ticketing] release promo error:", err));
  return { id: cancelled.id, bookingCode: current.booking_code };
}

// ── Kirim ulang WA ────────────────────────────────────────────────────

/**
 * Kirim ulang WA kode booking (pesan sama dgn webhook PAID). Hanya booking
 * terbayar: menunggu-bayar belum punya hak masuk, status terminal tidak
 * butuh QR lagi. Booking hadiah juga dikirim ulang ke penerima.
 */
export async function resendBookingWa(ctx: TicketingContext, id: string) {
  const booking = await queryOne<{
    booking_code: string;
    access_token: string;
    visit_date: string;
    customer_name: string;
    customer_phone: string;
    status: string;
    total: string;
    discount_amount: string | null;
    gift_recipient_name: string | null;
    gift_recipient_phone: string | null;
  }>(
    `SELECT booking_code, access_token, visit_date::text AS visit_date,
            customer_name, customer_phone, status, total, discount_amount,
            gift_recipient_name, gift_recipient_phone
     FROM ticketing.ticket_bookings
     WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
    [id, ctx.branchId, ctx.companyId]
  );
  if (!booking) throw ApiError.notFound(BOOKING_NOT_FOUND);
  if (booking.status !== "terbayar") {
    throw ApiError.conflict(
      `Booking berstatus "${booking.status}" — hanya booking terbayar yang dikirimi ulang`
    );
  }

  const sent = await sendBookingPaidWa(booking);
  if (booking.gift_recipient_phone) await sendBookingGiftWa(booking);
  if (!sent.success) {
    throw new ApiError(
      502,
      sent.reason === "gateway-belum-dikonfigurasi"
        ? "WA gateway belum dikonfigurasi — cek Settings → WhatsApp Gateway"
        : "Gagal mengirim WA — cek koneksi gateway"
    );
  }
  return { booking_code: booking.booking_code, customer_phone: booking.customer_phone };
}
