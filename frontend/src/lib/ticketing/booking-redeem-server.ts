import "server-only";
// Fase D4 — redeem booking terbayar di loket: tiap ANGGOTA rombongan
// (ticket_booking_guests) di-pair tepat satu gelang NFC → buat visit
// PREPAID dgn charge tiket snapshot harga booking + baris pembayaran
// Xendit senilai sama (net 0 — revenue tiket kanal website tetap kebaca
// dari ledger). Nama anggota menempel ke gelang (visit_bands.guest_name).
// Idempotent: booking dikunci FOR UPDATE dan transisi terbayar→digunakan
// hanya bisa sekali; redeem ulang → 409.
// Gate tap TIDAK men-charge visit hasil booking (lihat gate-server).

import type { PoolClient } from "pg";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { formatDate } from "@/lib/format";
import {
  BOOKING_MAX_QTY,
  matchRedeemGuests,
  redeemWindowStatus,
  todayInJakarta,
} from "./booking";
import { slotWindowStatus } from "./capacity";
import { nowJakartaTime } from "./capacity-server";
import { requireDistinctNfcUids, type TicketingContext } from "./server";
import { lockAvailableBands } from "./visit-registration-server";

export const redeemSchema = z.object({
  bands: z
    .array(
      z.object({
        nfc_uid: z.string().trim().min(1).max(80),
        guest_id: z.string().uuid(),
      })
    )
    .min(1)
    .max(BOOKING_MAX_QTY),
});

interface LockedBookingRow {
  id: string;
  booking_code: string;
  visit_date: string;
  customer_name: string;
  customer_phone: string;
  status: string;
  total: string;
  slot_label: string | null;
  slot_start_time: string | null;
  slot_end_time: string | null;
  discount_amount: string | null;
  promo_code: string | null;
}

interface GuestRow {
  id: string;
  guest_name: string;
  position: number;
  variant_id: string;
  ticket_product_id: string;
  product_name: string;
  variant_name: string;
  unit_price: string;
  season_kind: string;
  bundle_product_id: string | null;
  bundle_unit_no: number | null;
  allocated_price: string | null;
  member_label: string | null;
}

/**
 * Harga per orang: guest paket memakai allocated_price (prorata Fase P);
 * guest satuan memakai unit_price item — dua-duanya snapshot saat booking.
 */
const guestPrice = (guest: Pick<GuestRow, "unit_price" | "allocated_price">) =>
  guest.allocated_price === null ? Number(guest.unit_price) : Number(guest.allocated_price);

async function lockBooking(client: PoolClient, ctx: TicketingContext, id: string) {
  const result = await client.query<LockedBookingRow>(
    `SELECT id, booking_code, visit_date::text AS visit_date,
            customer_name, customer_phone, status, total,
            slot_label, slot_start_time::text AS slot_start_time,
            slot_end_time::text AS slot_end_time,
            discount_amount, promo_code
     FROM ticketing.ticket_bookings
     WHERE id = $1 AND branch_id = $2 AND company_id = $3
     FOR UPDATE`,
    [id, ctx.branchId, ctx.companyId]
  );
  const booking = result.rows[0];
  if (!booking) throw ApiError.notFound("Booking tidak ditemukan di venue ini");
  if (booking.status === "digunakan") {
    throw ApiError.conflict(`Booking ${booking.booking_code} SUDAH dipakai — tidak bisa dua kali`);
  }
  if (booking.status !== "terbayar") {
    throw ApiError.conflict(
      `Booking ${booking.booking_code} berstatus "${booking.status}" — hanya booking terbayar yang bisa di-redeem`
    );
  }
  return booking;
}

/**
 * Jendela redeem (keputusan owner 2026-07-23): hari-H s/d H +
 * booking_forfeit_days venue (NULL = hanya hari-H). Booking ber-slot
 * (EPIC-031 D) hanya bisa masuk pada jam slot ± grace venue di HARI
 * kunjungan; redeem H+N bebas jam (slotnya sudah lewat total).
 */
async function assertRedeemWindow(
  client: PoolClient,
  ctx: TicketingContext,
  booking: LockedBookingRow
) {
  const settings = await client.query<{
    booking_forfeit_days: number | null;
    slot_grace_minutes: number;
  }>(
    `SELECT booking_forfeit_days, slot_grace_minutes
     FROM ticketing.ticket_settings
     WHERE branch_id = $1 AND company_id = $2`,
    [ctx.branchId, ctx.companyId]
  );
  const forfeitDays = settings.rows[0]?.booking_forfeit_days ?? null;
  const slotGrace = settings.rows[0]?.slot_grace_minutes ?? 30;
  const today = todayInJakarta();
  const visitDay = formatDate(booking.visit_date);

  const window = redeemWindowStatus(booking.visit_date, today, forfeitDays);
  if (window === "belum-mulai") {
    throw ApiError.conflict(
      `Booking untuk tanggal ${visitDay} — belum bisa dipakai (hari ini ${formatDate(today)})`
    );
  }
  if (window === "lewat") {
    // Masa berlaku habis — tandai hangus (catatan: transaksi rollback
    // karena galat di bawah, jadi watcher/lazy-lookup yang menyimpannya)
    if (forfeitDays !== null) {
      await client.query(
        `UPDATE ticketing.ticket_bookings
         SET status = 'hangus', forfeited_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'terbayar' AND visit_id IS NULL`,
        [booking.id]
      );
    }
    throw ApiError.conflict(
      forfeitDays === null
        ? `Booking untuk tanggal ${visitDay} — hanya bisa dipakai pada hari-H (hari ini ${formatDate(today)})`
        : `Masa berlaku booking habis (tanggal ${visitDay} + ${forfeitDays} hari) — tiket hangus`
    );
  }

  if (booking.slot_start_time && booking.slot_end_time && today === booking.visit_date) {
    const nowTime = nowJakartaTime();
    const slotStatus = slotWindowStatus(
      nowTime,
      booking.slot_start_time,
      booking.slot_end_time,
      slotGrace
    );
    if (slotStatus !== "ok") {
      const range = `${booking.slot_start_time.slice(0, 5)}–${booking.slot_end_time.slice(0, 5)}`;
      const label = booking.slot_label ?? "";
      throw ApiError.conflict(
        slotStatus === "terlalu-awal"
          ? `Belum masuk jam slot ${label} (${range}, toleransi ${slotGrace} mnt) — sekarang ${nowTime}`
          : `Jam slot ${label} (${range}) sudah lewat (toleransi ${slotGrace} mnt) — sekarang ${nowTime}`
      );
    }
  }
}

export async function redeemBooking(
  ctx: TicketingContext,
  id: string,
  body: z.infer<typeof redeemSchema>
): Promise<{ visitId: string; bookingCode: string }> {
  const uids = requireDistinctNfcUids(body.bands.map((b) => b.nfc_uid));

  return withTransaction(async (client) => {
    // Kunci booking — serialisasi dgn redeem ganda & webhook
    const booking = await lockBooking(client, ctx, id);
    await assertRedeemWindow(client, ctx, booking);

    // Anggota rombongan + snapshot harga dari item masing-masing
    const guestsResult = await client.query<GuestRow>(
      `SELECT g.id, g.guest_name, g.position, g.variant_id,
              i.ticket_product_id, i.product_name, i.variant_name,
              i.unit_price, i.season_kind,
              g.bundle_product_id, g.bundle_unit_no, g.allocated_price,
              g.member_label
       FROM ticketing.ticket_booking_guests g
       JOIN ticketing.ticket_booking_items i ON i.id = g.booking_item_id
       WHERE g.booking_id = $1
       ORDER BY g.position`,
      [booking.id]
    );
    if (guestsResult.rows.length === 0) {
      throw ApiError.conflict("Booking tanpa daftar anggota — hubungi supervisor");
    }
    const guestById = new Map(guestsResult.rows.map((g) => [g.id, g]));

    const match = matchRedeemGuests(
      guestsResult.rows.map((g) => g.id),
      body.bands
    );
    if (!match.ok) {
      const guestName =
        (match.guest_id ? guestById.get(match.guest_id)?.guest_name : undefined) ?? "?";
      throw ApiError.badRequest(
        match.reason === "guest-asing"
          ? "Ada gelang yang dipasangkan ke anggota di luar booking ini"
          : match.reason === "guest-dobel"
            ? `Anggota "${guestName}" dipasangkan dua gelang`
            : `Anggota "${guestName}" belum dapat gelang`
      );
    }

    // Kanal website visit — revenue per kanal terbaca benar di laporan
    const channelResult = await client.query<{ id: string }>(
      `SELECT id FROM ticketing.ticket_channels
       WHERE branch_id = $1 AND company_id = $2
         AND is_online = true AND is_active = true
       ORDER BY sort_order LIMIT 1`,
      [ctx.branchId, ctx.companyId]
    );
    if (channelResult.rows.length === 0) {
      throw ApiError.badRequest("Kanal website tidak aktif — hubungi supervisor");
    }
    const channelId = channelResult.rows[0].id;

    const bandByUid = await lockAvailableBands(client, ctx, uids);

    // Ledger wajib net-0: Σ debit tiket harus = total booking (= kredit
    // pembayaran). Divergensi = data booking korup — gagal keras, jangan
    // tulis ledger pincang.
    const total = Number(booking.total);
    const debitSum = body.bands.reduce((sum, b) => sum + guestPrice(guestById.get(b.guest_id)!), 0);
    if (Math.abs(debitSum - total) > 0.01) {
      throw ApiError.conflict(
        `Total booking (${total}) tidak cocok dengan jumlah harga tiket (${debitSum}) — hubungi supervisor`
      );
    }

    // Visit prepaid tanpa plafon: tiket sudah lunas via Xendit
    const visitResult = await client.query<{ id: string }>(
      `INSERT INTO ticketing.ticket_visits
         (company_id, branch_id, contact_name, contact_phone, channel_id,
          payment_mode, credit_limit, created_by)
       VALUES ($1, $2, $3, $4, $5, 'prepaid', NULL, $6)
       RETURNING id`,
      [ctx.companyId, ctx.branchId, booking.customer_name, booking.customer_phone, channelId, ctx.user.id]
    );
    const visitId = visitResult.rows[0].id;

    for (const [index, input] of body.bands.entries()) {
      const band = bandByUid.get(uids[index])!;
      const guest = guestById.get(input.guest_id)!;

      await client.query(
        `INSERT INTO ticketing.ticket_visit_bands
           (company_id, branch_id, visit_id, band_id, variant_id, guest_name,
            bundle_product_id, bundle_unit_no, allocated_price, member_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          ctx.companyId,
          ctx.branchId,
          visitId,
          band.id,
          guest.variant_id,
          guest.guest_name,
          guest.bundle_product_id,
          guest.bundle_unit_no,
          guest.allocated_price,
          guest.member_label,
        ]
      );
      await client.query(
        `UPDATE ticketing.ticket_bands
         SET status = 'dipakai', updated_at = now()
         WHERE id = $1`,
        [band.id]
      );

      // amount > 0 saja (constraint ledger); tiket gratis = tanpa baris
      const unitPrice = guestPrice(guest);
      if (unitPrice > 0) {
        const label = guest.member_label ?? `${guest.product_name} — ${guest.variant_name}`;
        await client.query(
          `INSERT INTO ticketing.ticket_visit_charges
             (company_id, branch_id, visit_id, band_id, charge_type, direction,
              description, amount, price_context, created_by)
           VALUES ($1, $2, $3, $4, 'tiket', 'debit', $5, $6, $7, $8)`,
          [
            ctx.companyId,
            ctx.branchId,
            visitId,
            band.id,
            `Tiket ${label} ` +
              `(${guest.season_kind}, ${booking.visit_date}) — ` +
              `booking ${booking.booking_code}, a.n. ${guest.guest_name}`,
            unitPrice,
            JSON.stringify({
              booking_id: booking.id,
              booking_guest_id: input.guest_id,
              ticket_product_id: guest.ticket_product_id,
              variant_id: guest.variant_id,
              bundle_product_id: guest.bundle_product_id,
              season_kind: guest.season_kind,
              channel_id: channelId,
              visit_date: booking.visit_date,
            }),
            ctx.user.id,
          ]
        );
      }
    }

    // EPIC-032 B1 — visit tetap net-0 dgn promo: Σ debit tiket = total
    // GROSS; sisi kredit = pembayaran (uang riil = total − diskon) +
    // baris `diskon` (potongan promo, kredit non-uang). Tanpa promo,
    // perilaku identik lama (pembayaran = total).
    const discount = Number(booking.discount_amount ?? 0);
    const paidAmount = Math.round((total - discount) * 100) / 100;
    if (paidAmount > 0) {
      await client.query(
        `INSERT INTO ticketing.ticket_visit_charges
           (company_id, branch_id, visit_id, charge_type, direction,
            description, amount, payment_method, created_by)
         VALUES ($1, $2, $3, 'pembayaran', 'kredit', $4, $5, 'xendit', $6)`,
        [
          ctx.companyId,
          ctx.branchId,
          visitId,
          `Pembayaran booking ${booking.booking_code} (Xendit, prepaid online)`,
          paidAmount,
          ctx.user.id,
        ]
      );
    }
    if (discount > 0) {
      await client.query(
        `INSERT INTO ticketing.ticket_visit_charges
           (company_id, branch_id, visit_id, charge_type, direction,
            description, amount, created_by)
         VALUES ($1, $2, $3, 'diskon', 'kredit', $4, $5, $6)`,
        [
          ctx.companyId,
          ctx.branchId,
          visitId,
          `Potongan promo ${booking.promo_code ?? ""} — booking ${booking.booking_code}`,
          discount,
          ctx.user.id,
        ]
      );
    }

    await client.query(
      `UPDATE ticketing.ticket_bookings
       SET status = 'digunakan', used_at = now(), visit_id = $2,
           updated_at = now()
       WHERE id = $1 AND status = 'terbayar'`,
      [booking.id, visitId]
    );

    return { visitId, bookingCode: booking.booking_code };
  });
}
