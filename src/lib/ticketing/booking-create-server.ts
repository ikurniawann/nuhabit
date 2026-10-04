import "server-only";
// Endpoint PUBLIK: buat booking prepaid. Harga TIDAK diambil dari klien —
// dihitung ulang dari katalog server (varian tersembunyi/blok tidak bisa
// dibeli). Tanpa Xendit terkonfigurasi (atau mock) → 503 SEBELUM insert,
// supaya tidak ada booking yatim yang tak mungkin dibayar.

import type { PoolClient } from "pg";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, withTransaction } from "@/lib/db";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";
import {
  PromoRejectedError,
  holdPromoRedemption,
  releasePromoRedemption,
} from "@/lib/promo/promo-server";
import { createInvoice, getInvoiceExpiryHours, isXenditConfigured } from "@/lib/xendit/client";
import {
  BOOKING_MAX_QTY,
  GUEST_NAME_MAX_LENGTH,
  generateAccessToken,
  generateBookingCode,
  todayInJakarta,
  visitDateWindowError,
} from "./booking";
import { priceBookingCart, type PricedCartItem } from "./booking-checkout";
import { buildPublicCatalog, resolvePublicVenue, type PublicVenueCtx } from "./booking-server";
import { allocateBundlePrice } from "./bundle";
import {
  assertCapacityAvailable,
  assertSlotCapacity,
  loadActiveSlot,
  loadActiveSlots,
} from "./capacity-server";
import { isUniqueViolation } from "./sql";

export const createBookingSchema = z.object({
  visit_date: z.string(),
  customer_name: z.string().trim().min(2).max(120),
  customer_phone: z.string().trim().min(8).max(25),
  // EPIC-031 D — slot waktu: WAJIB bila venue punya slot aktif (dicek
  // server-side), dilarang bila tidak punya
  slot_id: z.string().uuid().optional(),
  // EPIC-032 B1 — kode promo (opsional): dievaluasi & di-hold server-side
  // di dalam transaksi; potongan TIDAK pernah dipercaya dari klien
  promo_code: z.string().trim().min(3).max(40).optional(),
  // EPIC-032 D2 — hadiah: e-tiket dikirim ke WA penerima saat PAID
  // (pemesan tetap pembayar & menerima bukti). Wajib berpasangan.
  gift_recipient_name: z.string().trim().min(2).max(120).optional(),
  gift_recipient_phone: z.string().trim().min(8).max(25).optional(),
  items: z
    .array(
      z.object({
        variant_id: z.string().uuid(),
        qty: z.number().int().min(1).max(BOOKING_MAX_QTY),
        // Nama anggota per unit (opsional, urut) — kosong/null diisi
        // default "Group {pemesan} - N" server-side
        guest_names: z
          .array(z.string().trim().max(GUEST_NAME_MAX_LENGTH).nullable())
          .max(BOOKING_MAX_QTY)
          .optional(),
      })
    )
    .min(1)
    .max(10),
});

type CreateBookingInput = z.infer<typeof createBookingSchema>;

const NOT_FOUND = "Not found";

interface PreparedBooking {
  venue: PublicVenueCtx;
  phone: string;
  giftPhone: string | null;
  items: PricedCartItem[];
  totalQty: number;
  total: number;
  guestNames: string[];
}

/** Validasi input + hitung ulang keranjang dari katalog server (tanpa tulis). */
async function prepareBooking(slug: string, body: CreateBookingInput): Promise<PreparedBooking> {
  const windowError = visitDateWindowError(body.visit_date, todayInJakarta());
  if (windowError) throw ApiError.badRequest(windowError);

  const phone = normalizePhoneDigits(body.customer_phone);
  if (!phone) throw ApiError.badRequest("Nomor WhatsApp tidak valid");

  // EPIC-032 D2 — hadiah: nama & WA penerima wajib berpasangan
  let giftPhone: string | null = null;
  if (body.gift_recipient_name || body.gift_recipient_phone) {
    if (!body.gift_recipient_name || !body.gift_recipient_phone) {
      throw ApiError.badRequest("Nama dan nomor WA penerima hadiah wajib diisi");
    }
    giftPhone = normalizePhoneDigits(body.gift_recipient_phone);
    if (!giftPhone) throw ApiError.badRequest("Nomor WA penerima hadiah tidak valid");
  }

  const variantIds = body.items.map((i) => i.variant_id);
  if (new Set(variantIds).size !== variantIds.length) {
    throw ApiError.badRequest("Varian duplikat dalam pesanan");
  }

  if (!isXenditConfigured()) {
    throw new ApiError(503, "Pembayaran online belum tersedia — silakan beli di loket");
  }

  const venue = await resolvePublicVenue(slug);
  if (!venue) throw ApiError.notFound(NOT_FOUND);

  // EPIC-031 D — venue ber-slot: slot wajib dipilih; venue tanpa slot:
  // slot_id ditolak (jangan percaya klien). Validasi detail slot di
  // dalam transaksi (loadActiveSlot via client).
  const activeSlots = await loadActiveSlots({ companyId: venue.companyId, branchId: venue.branchId });
  if (activeSlots.length > 0 && !body.slot_id) {
    throw ApiError.badRequest("Pilih slot waktu kunjungan dulu");
  }
  if (activeSlots.length === 0 && body.slot_id) {
    throw ApiError.badRequest("Venue ini tidak memakai slot waktu — muat ulang halaman");
  }

  // Harga & kelayakan dihitung ulang server-side dari katalog tanggal itu
  const catalog = await buildPublicCatalog(venue, body.visit_date);
  const cart = priceBookingCart(catalog, body.items, body.customer_name);
  if (!cart.ok) throw ApiError.badRequest(cart.error);

  return { venue, phone, giftPhone, ...cart };
}

/**
 * Tulis booking + item + guest dalam satu transaksi (guard kuota & slot,
 * hold promo). Mengembalikan id dan potongan promo yang ter-hold.
 */
async function insertBooking(
  client: PoolClient,
  body: CreateBookingInput,
  prepared: PreparedBooking,
  bookingCode: string,
  accessToken: string,
  expiresAt: Date
): Promise<{ id: string; discount: number }> {
  const { venue, phone, giftPhone, items, totalQty, total, guestNames } = prepared;
  const venueScope = { companyId: venue.companyId, branchId: venue.branchId };

  // EPIC-031 B1 — guard kuota harian DI DALAM transaksi: advisory lock
  // (venue, tanggal) → hitung okupansi live → 409 bila totalQty menembus
  // kapasitas. No-op tanpa lock bila kuota venue tidak aktif (unlimited).
  await assertCapacityAvailable(client, venueScope, body.visit_date, totalQty);
  // EPIC-031 D — slot: validasi ulang via client (bisa berubah di antara
  // pre-check dan transaksi) + guard kuota per (tanggal, slot)
  const slot = body.slot_id ? await loadActiveSlot(client, venueScope, body.slot_id) : null;
  if (body.slot_id && !slot) {
    throw ApiError.badRequest("Slot waktu tidak tersedia lagi — muat ulang halaman");
  }
  if (slot) await assertSlotCapacity(client, venueScope, body.visit_date, slot, totalQty);

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO ticketing.ticket_bookings
       (company_id, branch_id, booking_code, access_token, visit_date,
        customer_name, customer_phone, status, total, expires_at,
        slot_id, slot_label, slot_start_time, slot_end_time,
        gift_recipient_name, gift_recipient_phone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'menunggu-bayar',$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id`,
    [
      venue.companyId,
      venue.branchId,
      bookingCode,
      accessToken,
      body.visit_date,
      body.customer_name,
      phone,
      total,
      expiresAt.toISOString(),
      slot?.id ?? null,
      slot?.label ?? null,
      slot?.start_time ?? null,
      slot?.end_time ?? null,
      giftPhone ? body.gift_recipient_name : null,
      giftPhone,
    ]
  );
  const id = inserted.rows[0].id;

  // EPIC-032 B1 — hold kode promo DI transaksi yang sama (advisory lock
  // per campaign; 422 bila tak lolos). `total` booking TETAP GROSS;
  // potongan di-snapshot terpisah dan yang ditagih Xendit = total − diskon.
  let discount = 0;
  if (body.promo_code) {
    const hold = await holdPromoRedemption(client, {
      scope: venueScope,
      code: body.promo_code,
      channel: "ticketing_online",
      contextType: "ticket_booking",
      contextId: id,
      subtotal: total,
      phone,
    }).catch((err: unknown) => {
      if (err instanceof PromoRejectedError) throw new ApiError(err.statusCode, err.message);
      throw err;
    });
    await client.query(
      `UPDATE ticketing.ticket_bookings
       SET discount_amount = $2, promo_code = $3, updated_at = now()
       WHERE id = $1`,
      [id, hold.discount, body.promo_code.toUpperCase()]
    );
    discount = hold.discount;
  }

  const insertGuest = (
    itemId: string,
    variantId: string,
    position: number,
    bundle: { productId: string; unitNo: number; price: number; label: string } | null
  ) =>
    client.query(
      `INSERT INTO ticketing.ticket_booking_guests
         (company_id, branch_id, booking_id, booking_item_id,
          variant_id, guest_name, position, bundle_product_id,
          bundle_unit_no, allocated_price, member_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        venue.companyId,
        venue.branchId,
        id,
        itemId,
        variantId,
        guestNames[position - 1],
        position,
        bundle?.productId ?? null,
        bundle?.unitNo ?? null,
        bundle?.price ?? null,
        bundle?.label ?? null,
      ]
    );

  let position = 0;
  let bundleUnitNo = 0;
  for (const item of items) {
    const itemInserted = await client.query<{ id: string }>(
      `INSERT INTO ticketing.ticket_booking_items
         (company_id, branch_id, booking_id, ticket_product_id,
          variant_id, product_name, variant_name, qty, unit_price,
          season_kind, subtotal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        venue.companyId,
        venue.branchId,
        id,
        item.product_id,
        item.variant_id,
        item.product_name,
        item.variant_name,
        item.qty,
        item.price,
        item.season_kind,
        item.subtotal,
      ]
    );
    const itemId = itemInserted.rows[0].id;
    if (item.product_kind === "bundle" && item.members) {
      // Fase P — paket meledak jadi guest per ANGGOTA: varian komponen +
      // harga alokasi prorata (Σ per unit = harga paket → net-0 redeem)
      const shares = allocateBundlePrice(
        item.price,
        item.members.map((m) => m.weight_price)
      );
      for (let u = 0; u < item.qty; u++) {
        bundleUnitNo += 1;
        for (const [mi, member] of item.members.entries()) {
          position += 1;
          await insertGuest(itemId, member.component_variant_id, position, {
            productId: item.product_id,
            unitNo: bundleUnitNo,
            price: shares[mi],
            label: `${item.product_name} — ${member.member_label}`,
          });
        }
      }
    } else {
      // Satu guest per unit tiket — nama final dari buildGuestNames
      for (let k = 0; k < item.qty; k++) {
        position += 1;
        await insertGuest(itemId, item.variant_id, position, null);
      }
    }
  }
  return { id, discount };
}

export async function createPublicBooking(
  slug: string,
  body: CreateBookingInput,
  baseUrl: string
) {
  const prepared = await prepareBooking(slug, body);
  const accessToken = generateAccessToken();
  const expiresAt = new Date(Date.now() + getInvoiceExpiryHours() * 60 * 60 * 1000);

  // Insert dgn retry tabrakan booking_code (23505) — pola kode TKT R1.
  let booking: { id: string; discount: number } | null = null;
  let bookingCode = "";
  for (let attempt = 0; attempt < 3 && !booking; attempt++) {
    bookingCode = generateBookingCode();
    try {
      booking = await withTransaction((client) =>
        insertBooking(client, body, prepared, bookingCode, accessToken, expiresAt)
      );
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 2) continue; // kode tabrakan → coba lagi
      throw err;
    }
  }
  if (!booking) throw new Error("Gagal mengalokasikan kode booking");

  const statusUrl = `${baseUrl}/booking/status/${accessToken}`;
  const { total } = prepared;
  try {
    // Yang ditagih = total GROSS − potongan promo; Xendit IDR rupiah bulat
    const invoice = await createInvoice({
      externalId: `tkt-booking-${booking.id}`,
      amount: Math.round(total - booking.discount),
      payerName: body.customer_name,
      description: `Tiket ${bookingCode} — kunjungan ${body.visit_date}`,
      redirectUrl: statusUrl,
    });
    await query(
      `UPDATE ticketing.ticket_bookings
       SET xendit_invoice_id = $2, xendit_invoice_url = $3,
           expires_at = $4, updated_at = now()
       WHERE id = $1`,
      [booking.id, invoice.invoiceId, invoice.invoiceUrl, invoice.expiresAt.toISOString()]
    );
    return {
      booking_code: bookingCode,
      access_token: accessToken,
      status_url: statusUrl,
      invoice_url: invoice.invoiceUrl,
      total,
      discount_amount: booking.discount,
      payable: Math.round((total - booking.discount) * 100) / 100,
      expires_at: invoice.expiresAt.toISOString(),
    };
  } catch (invoiceErr) {
    // Invoice gagal → booking dibatalkan rapi, klien diberi tahu jelas
    console.error("[booking] invoice error:", invoiceErr);
    const bookingId = booking.id;
    await query(
      `UPDATE ticketing.ticket_bookings
       SET status = 'dibatalkan', refund_note = 'pembuatan-invoice-gagal',
           updated_at = now()
       WHERE id = $1 AND status = 'menunggu-bayar'`,
      [bookingId]
    );
    // Lepas hold promo (idempoten; jatah kode kembali)
    if (booking.discount > 0) {
      await withTransaction((client) =>
        releasePromoRedemption(client, "ticket_booking", bookingId)
      ).catch((releaseErr) => console.error("[booking] release promo error:", releaseErr));
    }
    throw new ApiError(502, "Pembayaran sedang gangguan — coba lagi");
  }
}
