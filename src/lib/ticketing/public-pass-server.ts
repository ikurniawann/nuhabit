import "server-only";
// EPIC-028 — Season Pass PUBLIK: katalog online, pembelian (pending →
// aktif saat webhook Xendit PAID), dan status via access_token. Harga &
// kelayakan dihitung ulang server-side; tanpa Xendit → 503 sebelum insert.

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";
import { createInvoice, getInvoiceExpiryHours, isXenditConfigured } from "@/lib/xendit/client";
import { generateAccessToken, todayInJakarta } from "./booking";
import { resolvePublicVenue, type PublicVenueCtx } from "./booking-server";
import { generatePassCode } from "./season-pass";
import { PASS_PRICE_LATERAL } from "./season-pass-server";
import { isUniqueViolation } from "./sql";

/** Produk pass Active, season_pass, terdistribusi ke kanal 'website'. */
const ONLINE_PASS_FROM = `FROM ticketing.ticket_products tp
   JOIN ticketing.ticket_pass_configs pc ON pc.ticket_product_id = tp.id
   JOIN ticketing.ticket_product_channels pch
     ON pch.ticket_product_id = tp.id AND pch.is_distributed = true
   JOIN ticketing.ticket_channels ch
     ON ch.id = pch.channel_id AND ch.code = 'website'
   ${PASS_PRICE_LATERAL}`;

const ONLINE_PASS_WHERE = `tp.branch_id = $1 AND tp.company_id = $2
   AND tp.product_kind = 'season_pass' AND tp.status = 'active'`;

export async function listOnlinePasses(venue: PublicVenueCtx) {
  const rows = await query<{
    ticket_product_id: string;
    name: string;
    description: string | null;
    thumbnail_url: string | null;
    validity_months: number;
    entry_policy: string;
    visit_quota: number | null;
    unit_price: string | null;
  }>(
    `SELECT tp.id AS ticket_product_id, tp.name, tp.description, tp.thumbnail_url,
            pc.validity_months, pc.entry_policy, pc.visit_quota,
            COALESCE(v.price_regular, tp.base_price) AS unit_price
     ${ONLINE_PASS_FROM}
     WHERE ${ONLINE_PASS_WHERE}
     ORDER BY tp.name`,
    [venue.branchId, venue.companyId]
  );
  return rows.map((r) => ({
    ticket_product_id: r.ticket_product_id,
    name: r.name,
    description: r.description,
    thumbnail_url: r.thumbnail_url,
    validity_months: r.validity_months,
    entry_policy: r.entry_policy,
    visit_quota: r.visit_quota,
    unit_price: Number(r.unit_price ?? 0),
  }));
}

export const purchasePassSchema = z.object({
  ticket_product_id: z.string().uuid(),
  holder_name: z.string().trim().min(2).max(120),
  holder_phone: z.string().trim().min(8).max(25),
});

/**
 * Beli pass online: insert 'pending' (retry tabrakan pass_code) lalu
 * invoice Xendit. Invoice gagal → pass dibatalkan rapi, 502 ke klien.
 */
export async function purchasePassOnline(
  slug: string,
  body: z.infer<typeof purchasePassSchema>,
  baseUrl: string
) {
  const phone = normalizePhoneDigits(body.holder_phone);
  if (!phone) throw ApiError.badRequest("Nomor WhatsApp tidak valid");
  if (!isXenditConfigured()) {
    throw new ApiError(503, "Pembayaran online belum tersedia — silakan beli di loket");
  }
  const venue = await resolvePublicVenue(slug);
  if (!venue) throw ApiError.notFound("Not found");

  const product = await queryOne<{
    entry_policy: string;
    visit_quota: number | null;
    unit_price: string | null;
    name: string;
  }>(
    `SELECT pc.entry_policy, pc.visit_quota, tp.name,
            COALESCE(v.price_regular, tp.base_price) AS unit_price
     ${ONLINE_PASS_FROM}
     WHERE tp.id = $3 AND ${ONLINE_PASS_WHERE}`,
    [venue.branchId, venue.companyId, body.ticket_product_id]
  );
  if (!product) throw ApiError.badRequest("Produk pass tidak tersedia untuk dibeli online");

  const unitPrice = Number(product.unit_price ?? 0);
  if (unitPrice <= 0) throw ApiError.badRequest("Harga pass belum diatur — hubungi loket");
  const quotaTotal = product.entry_policy === "limited_visits" ? product.visit_quota : null;

  const accessToken = generateAccessToken();
  const expiresAt = new Date(Date.now() + getInvoiceExpiryHours() * 60 * 60 * 1000);
  const today = todayInJakarta();

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
      if (isUniqueViolation(err) && attempt < 2) continue;
      throw err;
    }
  }
  if (!passId) throw new Error("Gagal mengalokasikan kode pass");

  const statusUrl = `${baseUrl}/pass/status/${accessToken}`;
  try {
    const invoice = await createInvoice({
      externalId: `tkt-pass-${passId}`,
      amount: Math.round(unitPrice),
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
    return {
      pass_code: passCode,
      access_token: accessToken,
      status_url: statusUrl,
      invoice_url: invoice.invoiceUrl,
      total: unitPrice,
      expires_at: invoice.expiresAt.toISOString(),
    };
  } catch (invoiceErr) {
    console.error("[pass] invoice error:", invoiceErr);
    await query(
      `UPDATE ticketing.ticket_season_passes
       SET status = 'cancelled', notes = 'pembuatan-invoice-gagal', updated_at = now()
       WHERE id = $1 AND status = 'pending'`,
      [passId]
    );
    throw new ApiError(502, "Pembayaran sedang gangguan — coba lagi");
  }
}

/**
 * Status pass via access_token. 'pending' yang invoice-nya lewat waktu
 * dilaporkan 'expired' (lazy, tanpa tulis). null = tak dikenal (404).
 */
export async function getPassStatus(token: string) {
  const pass = await queryOne<{
    pass_code: string;
    holder_name: string;
    status: string;
    entry_policy: string;
    valid_from: string | null;
    valid_until: string | null;
    visit_quota_total: number | null;
    visit_quota_used: number;
    unit_price: string;
    product_name: string;
    xendit_invoice_url: string | null;
    payment_expires_at: string | null;
  }>(
    `SELECT sp.pass_code, sp.holder_name, sp.status, sp.entry_policy,
            sp.valid_from::text AS valid_from, sp.valid_until::text AS valid_until,
            sp.visit_quota_total, sp.visit_quota_used, sp.unit_price,
            tp.name AS product_name, sp.xendit_invoice_url,
            sp.payment_expires_at::text AS payment_expires_at
     FROM ticketing.ticket_season_passes sp
     JOIN ticketing.ticket_products tp ON tp.id = sp.ticket_product_id
     WHERE sp.access_token = $1`,
    [token]
  );
  if (!pass) return null;

  const expired =
    pass.status === "pending" &&
    pass.payment_expires_at !== null &&
    new Date(pass.payment_expires_at).getTime() < Date.now();

  return {
    pass_code: pass.pass_code,
    holder_name: pass.holder_name,
    product_name: pass.product_name,
    status: expired ? "expired" : pass.status,
    entry_policy: pass.entry_policy,
    valid_from: pass.valid_from,
    valid_until: pass.valid_until,
    visit_quota_total: pass.visit_quota_total,
    visit_quota_used: pass.visit_quota_used,
    unit_price: Number(pass.unit_price),
    // QR = access_token (sama dgn URL ini) — dipindai di gate
    qr_value: token,
    invoice_url: pass.xendit_invoice_url,
    payment_expires_at: pass.payment_expires_at,
  };
}
