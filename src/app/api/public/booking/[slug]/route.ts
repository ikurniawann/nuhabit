import { NextRequest, NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-origin";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, withTransaction } from "@/lib/db";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";
import { checkRateLimit, clientIpFrom } from "@/lib/public/rate-limit";
import {
  BOOKING_MAX_QTY,
  GUEST_NAME_MAX_LENGTH,
  buildGuestNames,
  generateAccessToken,
  generateBookingCode,
  todayInJakarta,
  validateVisitDateWindow,
} from "@/lib/ticketing/booking";
import { allocateBundlePrice, type BundleMember } from "@/lib/ticketing/bundle";
import {
  buildPublicCatalog,
  resolvePublicVenue,
} from "@/lib/ticketing/booking-server";
import {
  assertCapacityAvailable,
  assertSlotCapacity,
  loadActiveSlot,
  loadActiveSlots,
} from "@/lib/ticketing/capacity-server";
import {
  holdPromoRedemption,
  releasePromoRedemption,
} from "@/lib/promo/promo-server";
import {
  createInvoice,
  getInvoiceExpiryHours,
  isXenditConfigured,
} from "@/lib/xendit/client";

// Endpoint PUBLIK: buat booking prepaid. Harga TIDAK diambil dari klien —
// dihitung ulang dari katalog server (varian tersembunyi/blok tidak bisa
// dibeli). Tanpa Xendit terkonfigurasi (atau mock) → 503 SEBELUM insert,
// supaya tidak ada booking yatim yang tak mungkin dibayar.

const MAX_QTY_PER_BOOKING = BOOKING_MAX_QTY;

const createSchema = z.object({
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
        qty: z.number().int().min(1).max(MAX_QTY_PER_BOOKING),
        // Nama anggota per unit (opsional, urut) — kosong/null diisi
        // default "Group {pemesan} - N" server-side
        guest_names: z
          .array(z.string().trim().max(GUEST_NAME_MAX_LENGTH).nullable())
          .max(MAX_QTY_PER_BOOKING)
          .optional(),
      })
    )
    .min(1)
    .max(10),
});

const notFound = () =>
  NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

const badRequest = (error: string) =>
  NextResponse.json({ success: false, error }, { status: 400 });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`booking-create:${ip}`, { limit: 5, windowMs: 5 * 60_000 })) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak percobaan — coba lagi beberapa menit lagi" },
      { status: 429 }
    );
  }

  try {
    const { slug } = await params;
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const window = validateVisitDateWindow(body.visit_date, todayInJakarta());
    if (window !== "ok") {
      return badRequest(
        window === "masa-lalu"
          ? "Tanggal kunjungan sudah lewat"
          : window === "terlalu-jauh"
            ? "Tanggal kunjungan terlalu jauh ke depan"
            : "Tanggal kunjungan tidak valid"
      );
    }

    const phone = normalizePhoneDigits(body.customer_phone);
    if (!phone) return badRequest("Nomor WhatsApp tidak valid");

    // EPIC-032 D2 — hadiah: nama & WA penerima wajib berpasangan
    const isGift = Boolean(body.gift_recipient_name || body.gift_recipient_phone);
    let giftPhone: string | null = null;
    if (isGift) {
      if (!body.gift_recipient_name || !body.gift_recipient_phone) {
        return badRequest("Nama dan nomor WA penerima hadiah wajib diisi");
      }
      giftPhone = normalizePhoneDigits(body.gift_recipient_phone);
      if (!giftPhone) return badRequest("Nomor WA penerima hadiah tidak valid");
    }

    const variantIds = body.items.map((i) => i.variant_id);
    if (new Set(variantIds).size !== variantIds.length) {
      return badRequest("Varian duplikat dalam pesanan");
    }

    if (!isXenditConfigured()) {
      return NextResponse.json(
        { success: false, error: "Pembayaran online belum tersedia — silakan beli di loket" },
        { status: 503 }
      );
    }

    const venue = await resolvePublicVenue(slug);
    if (!venue) return notFound();

    // EPIC-031 D — venue ber-slot: slot wajib dipilih; venue tanpa slot:
    // slot_id ditolak (jangan percaya klien). Validasi detail slot di
    // dalam transaksi (loadActiveSlot via client).
    const venueScope = { companyId: venue.companyId, branchId: venue.branchId };
    const activeSlots = await loadActiveSlots(venueScope);
    if (activeSlots.length > 0 && !body.slot_id) {
      return badRequest("Pilih slot waktu kunjungan dulu");
    }
    if (activeSlots.length === 0 && body.slot_id) {
      return badRequest("Venue ini tidak memakai slot waktu — muat ulang halaman");
    }

    // Harga & kelayakan dihitung ulang server-side dari katalog tanggal itu
    const catalog = await buildPublicCatalog(venue, body.visit_date);
    const variantIndex = new Map(
      catalog.flatMap((p) =>
        p.variants.map((v) => [
          v.variant_id,
          {
            product_id: p.ticket_product_id,
            product_name: p.name,
            variant_name: v.variant_name,
            price: v.price,
            season_kind: v.season_kind,
            product_kind: p.product_kind,
            // Fase P — paket: anggota per unit (varian komponen + bobot)
            members: v.members ?? null,
          },
        ])
      )
    );

    interface PricedItem {
      variant_id: string;
      qty: number;
      guest_names?: (string | null)[];
      product_id: string;
      product_name: string;
      variant_name: string;
      price: number;
      season_kind: string;
      product_kind: "single" | "bundle";
      members: BundleMember[] | null;
      /** Jumlah ORANG per 1 qty item (paket = Σ anggota; satuan = 1). */
      persons_per_unit: number;
      subtotal: number;
    }
    const items: PricedItem[] = [];
    for (const item of body.items) {
      const known = variantIndex.get(item.variant_id);
      if (!known) {
        return badRequest(
          "Ada tiket yang tidak tersedia untuk tanggal ini — muat ulang halaman"
        );
      }
      items.push({
        ...item,
        ...known,
        persons_per_unit:
          known.product_kind === "bundle" ? (known.members?.length ?? 0) : 1,
        // 2dp per baris — konvensi ledger Fase B, anti selisih float
        subtotal: Math.round(known.price * item.qty * 100) / 100,
      });
    }
    if (items.some((i) => i.product_kind === "bundle" && i.persons_per_unit === 0)) {
      return badRequest(
        "Ada paket yang tidak tersedia untuk tanggal ini — muat ulang halaman"
      );
    }

    // Kuota & nama dihitung per ORANG (1 unit paket = beberapa orang)
    const totalQty = items.reduce(
      (sum, i) => sum + i.qty * i.persons_per_unit,
      0
    );
    if (totalQty > MAX_QTY_PER_BOOKING) {
      return badRequest(`Maksimum ${MAX_QTY_PER_BOOKING} tiket per booking`);
    }
    if (
      items.some(
        (i) => (i.guest_names?.length ?? 0) > i.qty * i.persons_per_unit
      )
    ) {
      return badRequest("Jumlah nama anggota melebihi jumlah tiket");
    }

    // Nama anggota final: urutan unit mengikuti urutan item; kosong →
    // default posisi-global (posisi 1 = pemesan)
    const guestNames = buildGuestNames(
      body.customer_name,
      totalQty,
      items.flatMap((i) =>
        Array.from(
          { length: i.qty * i.persons_per_unit },
          (_, k) => i.guest_names?.[k] ?? null
        )
      )
    );

    const total =
      Math.round(items.reduce((sum, i) => sum + i.subtotal, 0) * 100) / 100;

    const accessToken = generateAccessToken();
    const expiresAt = new Date(
      Date.now() + getInvoiceExpiryHours() * 60 * 60 * 1000
    );

    // Insert dgn retry tabrakan booking_code (23505) — pola kode TKT R1.
    // discount diketahui DI DALAM transaksi (hold promo) — dibawa keluar
    // utk invoice net.
    let bookingId: string | null = null;
    let discountAmount = 0;
    let bookingCode = "";
    for (let attempt = 0; attempt < 3 && !bookingId; attempt++) {
      bookingCode = generateBookingCode();
      try {
        bookingId = await withTransaction(async (client) => {
          // EPIC-031 B1 — guard kuota harian DI DALAM transaksi: advisory
          // lock (venue, tanggal) → hitung okupansi live (booking pemegang
          // kuota + walk-in) → 409 bila totalQty menembus kapasitas.
          // No-op tanpa lock bila kuota venue tidak aktif (unlimited).
          await assertCapacityAvailable(
            client,
            venueScope,
            body.visit_date,
            totalQty
          );
          // EPIC-031 D — slot: validasi ulang via client (bisa berubah di
          // antara pre-check dan transaksi) + guard kuota per (tanggal,slot)
          const slot = body.slot_id
            ? await loadActiveSlot(client, venueScope, body.slot_id)
            : null;
          if (body.slot_id && !slot) {
            throw Object.assign(
              new Error("Slot waktu tidak tersedia lagi — muat ulang halaman"),
              { statusCode: 400 }
            );
          }
          if (slot) {
            await assertSlotCapacity(
              client,
              venueScope,
              body.visit_date,
              slot,
              totalQty
            );
          }
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
              isGift ? body.gift_recipient_name : null,
              giftPhone,
            ]
          );
          const id = inserted.rows[0].id;

          // EPIC-032 B1 — hold kode promo DI transaksi yang sama (advisory
          // lock per campaign; 422 PromoRejectedError bila tak lolos).
          // `total` booking TETAP GROSS; potongan di-snapshot terpisah dan
          // yang ditagih Xendit = total - discount.
          if (body.promo_code) {
            const hold = await holdPromoRedemption(client, {
              scope: venueScope,
              code: body.promo_code,
              channel: "ticketing_online",
              contextType: "ticket_booking",
              contextId: id,
              subtotal: total,
              phone,
            });
            await client.query(
              `UPDATE ticketing.ticket_bookings
               SET discount_amount = $2, promo_code = $3, updated_at = now()
               WHERE id = $1`,
              [id, hold.discount, body.promo_code.toUpperCase()]
            );
            discountAmount = hold.discount;
          }
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
              // Fase P — paket meledak jadi guest per ANGGOTA: varian
              // komponen + harga alokasi prorata (Σ per unit = harga
              // paket → net-0 redeem tetap tepat)
              const shares = allocateBundlePrice(
                item.price,
                item.members.map((m) => m.weight_price)
              );
              for (let u = 0; u < item.qty; u++) {
                bundleUnitNo += 1;
                for (const [mi, member] of item.members.entries()) {
                  position += 1;
                  await client.query(
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
                      member.component_variant_id,
                      guestNames[position - 1],
                      position,
                      item.product_id,
                      bundleUnitNo,
                      shares[mi],
                      `${item.product_name} — ${member.member_label}`,
                    ]
                  );
                }
              }
            } else {
              // Satu guest per unit tiket — nama final dari buildGuestNames
              for (let k = 0; k < item.qty; k++) {
                position += 1;
                await client.query(
                  `INSERT INTO ticketing.ticket_booking_guests
                     (company_id, branch_id, booking_id, booking_item_id,
                      variant_id, guest_name, position)
                   VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                  [
                    venue.companyId,
                    venue.branchId,
                    id,
                    itemId,
                    item.variant_id,
                    guestNames[position - 1],
                    position,
                  ]
                );
              }
            }
          }
          return id;
        });
      } catch (err) {
        const pgCode = (err as { code?: string }).code;
        if (pgCode === "23505" && attempt < 2) continue; // kode tabrakan → coba lagi
        throw err;
      }
    }
    if (!bookingId) {
      throw new Error("Gagal mengalokasikan kode booking");
    }

    const baseUrl = appOrigin(request);
    const statusUrl = `${baseUrl}/booking/status/${accessToken}`;

    try {
      // Yang ditagih = total GROSS − potongan promo; Xendit IDR rupiah bulat
      const payable = Math.round(total - discountAmount);
      const invoice = await createInvoice({
        externalId: `tkt-booking-${bookingId}`,
        amount: payable,
        payerName: body.customer_name,
        description: `Tiket ${bookingCode} — kunjungan ${body.visit_date}`,
        redirectUrl: statusUrl,
      });
      await query(
        `UPDATE ticketing.ticket_bookings
         SET xendit_invoice_id = $2, xendit_invoice_url = $3,
             expires_at = $4, updated_at = now()
         WHERE id = $1`,
        [
          bookingId,
          invoice.invoiceId,
          invoice.invoiceUrl,
          invoice.expiresAt.toISOString(),
        ]
      );
      return successResponse(
        {
          booking_code: bookingCode,
          access_token: accessToken,
          status_url: statusUrl,
          invoice_url: invoice.invoiceUrl,
          total,
          discount_amount: discountAmount,
          payable: Math.round((total - discountAmount) * 100) / 100,
          expires_at: invoice.expiresAt.toISOString(),
        },
        "Booking dibuat — selesaikan pembayaran"
      );
    } catch (invoiceErr) {
      // Invoice gagal → booking dibatalkan rapi, klien diberi tahu jelas
      console.error("[booking] invoice error:", invoiceErr);
      await query(
        `UPDATE ticketing.ticket_bookings
         SET status = 'dibatalkan', refund_note = 'pembuatan-invoice-gagal',
             updated_at = now()
         WHERE id = $1 AND status = 'menunggu-bayar'`,
        [bookingId]
      );
      // Lepas hold promo (idempoten; jatah kode kembali)
      if (discountAmount > 0) {
        const releasedId = bookingId;
        await withTransaction((client) =>
          releasePromoRedemption(client, "ticket_booking", releasedId)
        ).catch((releaseErr) =>
          console.error("[booking] release promo error:", releaseErr)
        );
      }
      return NextResponse.json(
        { success: false, error: "Pembayaran sedang gangguan — coba lagi" },
        { status: 502 }
      );
    }
  } catch (err) {
    // Error ber-statusCode (mis. CapacityFullError 409) → pesan apa adanya
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode) {
      return NextResponse.json(
        { success: false, error: (err as Error).message },
        { status: statusCode }
      );
    }
    console.error("[booking] create error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal membuat booking" },
      { status: 500 }
    );
  }
}
