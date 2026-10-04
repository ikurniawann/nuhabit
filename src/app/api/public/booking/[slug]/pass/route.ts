import { NextRequest, NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-origin";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";
import { checkRateLimit, clientIpFrom } from "@/lib/public/rate-limit";
import { generateAccessToken, todayInJakarta } from "@/lib/ticketing/booking";
import { resolvePublicVenue } from "@/lib/ticketing/booking-server";
import { generatePassCode } from "@/lib/ticketing/season-pass";
import {
  createInvoice,
  getInvoiceExpiryHours,
  isXenditConfigured,
} from "@/lib/xendit/client";

// Endpoint PUBLIK: beli Season Pass online. Harga & kelayakan dihitung ulang
// server-side (produk harus Active, season_pass, terdistribusi 'website').
// Pass dibuat 'pending' → aktif saat webhook Xendit PAID (valid_from = tanggal
// bayar, rolling). Tanpa Xendit → 503 sebelum insert (tak ada pass yatim).

const createSchema = z.object({
  ticket_product_id: z.string().uuid(),
  holder_name: z.string().trim().min(2).max(120),
  holder_phone: z.string().trim().min(8).max(25),
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
  if (!checkRateLimit(`pass-create:${ip}`, { limit: 5, windowMs: 5 * 60_000 })) {
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

    const phone = normalizePhoneDigits(body.holder_phone);
    if (!phone) return badRequest("Nomor WhatsApp tidak valid");

    if (!isXenditConfigured()) {
      return NextResponse.json(
        { success: false, error: "Pembayaran online belum tersedia — silakan beli di loket" },
        { status: 503 }
      );
    }

    const venue = await resolvePublicVenue(slug);
    if (!venue) return notFound();

    // Produk pass harus Active, season_pass, terdistribusi 'website'
    const product = await queryOne<{
      entry_policy: string;
      visit_quota: number | null;
      unit_price: string | null;
      name: string;
    }>(
      `SELECT pc.entry_policy, pc.visit_quota, tp.name,
              COALESCE(v.price_regular, tp.base_price) AS unit_price
       FROM ticketing.ticket_products tp
       JOIN ticketing.ticket_pass_configs pc ON pc.ticket_product_id = tp.id
       JOIN ticketing.ticket_product_channels pch
         ON pch.ticket_product_id = tp.id AND pch.is_distributed = true
       JOIN ticketing.ticket_channels ch
         ON ch.id = pch.channel_id AND ch.code = 'website'
       LEFT JOIN LATERAL (
         SELECT price_regular FROM ticketing.ticket_product_variants
         WHERE ticket_product_id = tp.id AND is_active = true
         ORDER BY sort_order LIMIT 1
       ) v ON true
       WHERE tp.id = $1 AND tp.branch_id = $2 AND tp.company_id = $3
         AND tp.product_kind = 'season_pass' AND tp.status = 'active'`,
      [body.ticket_product_id, venue.branchId, venue.companyId]
    );
    if (!product) return badRequest("Produk pass tidak tersedia untuk dibeli online");

    const unitPrice = Number(product.unit_price ?? 0);
    if (unitPrice <= 0) return badRequest("Harga pass belum diatur — hubungi loket");
    const invoiceAmount = Math.round(unitPrice);
    const quotaTotal =
      product.entry_policy === "limited_visits" ? product.visit_quota : null;

    const accessToken = generateAccessToken();
    const expiresAt = new Date(
      Date.now() + getInvoiceExpiryHours() * 60 * 60 * 1000
    );
    const today = todayInJakarta();

    // Insert pending dgn retry tabrakan pass_code (23505)
    let passId: string | null = null;
    let passCode = "";
    for (let attempt = 0; attempt < 3 && !passId; attempt++) {
      try {
        passId = await withTransaction(async (client) => {
          passCode = await generatePassCode(client, venue.branchId, today);
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO ticketing.ticket_season_passes
               (company_id, branch_id, ticket_product_id, pass_code, access_token,
                holder_name, holder_phone, status, entry_policy, visit_quota_total,
                visit_quota_used, source, unit_price, payment_expires_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,0,'online',$10,$11)
             RETURNING id`,
            [
              venue.companyId,
              venue.branchId,
              body.ticket_product_id,
              passCode,
              accessToken,
              body.holder_name,
              phone,
              product.entry_policy,
              quotaTotal,
              unitPrice,
              expiresAt.toISOString(),
            ]
          );
          return inserted.rows[0].id;
        });
      } catch (err) {
        if ((err as { code?: string }).code === "23505" && attempt < 2) continue;
        throw err;
      }
    }
    if (!passId) throw new Error("Gagal mengalokasikan kode pass");

    const baseUrl = appOrigin(request);
    const statusUrl = `${baseUrl}/pass/status/${accessToken}`;

    try {
      const invoice = await createInvoice({
        externalId: `tkt-pass-${passId}`,
        amount: invoiceAmount,
        payerName: body.holder_name,
        description: `Season Pass ${passCode} — ${product.name}`,
        redirectUrl: statusUrl,
      });
      await query(
        `UPDATE ticketing.ticket_season_passes
         SET xendit_invoice_id = $2, xendit_invoice_url = $3,
             payment_expires_at = $4, updated_at = now()
         WHERE id = $1`,
        [passId, invoice.invoiceId, invoice.invoiceUrl, invoice.expiresAt.toISOString()]
      );
      return successResponse(
        {
          pass_code: passCode,
          access_token: accessToken,
          status_url: statusUrl,
          invoice_url: invoice.invoiceUrl,
          total: unitPrice,
          expires_at: invoice.expiresAt.toISOString(),
        },
        "Pass dibuat — selesaikan pembayaran"
      );
    } catch (invoiceErr) {
      console.error("[pass] invoice error:", invoiceErr);
      await query(
        `UPDATE ticketing.ticket_season_passes
         SET status = 'cancelled', notes = 'pembuatan-invoice-gagal', updated_at = now()
         WHERE id = $1 AND status = 'pending'`,
        [passId]
      );
      return NextResponse.json(
        { success: false, error: "Pembayaran sedang gangguan — coba lagi" },
        { status: 502 }
      );
    }
  } catch (err) {
    console.error("[pass] create error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal membuat pass" },
      { status: 500 }
    );
  }
}
