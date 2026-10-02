import type { PoolClient } from "pg";
import { ApiError } from "@/lib/api/auth";
import { postJournalFromMapping } from "@/lib/accounting/journal-mapping-posting";
import { query, queryOne, withTransaction } from "@/lib/db";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";
import { breakageOnExpiry, generatePassCode, type PaymentMethod } from "@/lib/studio/pass";
import type { StudioContext } from "@/lib/studio/server";

/**
 * Akses DB Member Pass (EPIC-053). Tanggal "hari ini" selalu memakai zona venue
 * (Asia/Jakarta) supaya pass tidak kedaluwarsa jam 07.00 WIB karena UTC.
 */

/** Kolom katalog paket (alias tabel `p`). */
export const PASS_PRODUCT_COLUMNS = `p.id, p.code, p.name, p.category, p.class_credits, p.pt_credits, p.facility_access,
  p.validity_days, p.price::float8 AS price, p.class_value::float8 AS class_value, p.pt_value::float8 AS pt_value,
  p.facility_value::float8 AS facility_value, p.description, p.is_active, p.is_public, p.sort_order`;

export const VENUE_TODAY_SQL = `(now() AT TIME ZONE 'Asia/Jakarta')::date`;

/** Normalisasi HP member ke 62xxx (selaras login OTP Member Portal). */
export function normalizeMemberPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return normalizePhoneDigits(digits.startsWith("8") ? `62${digits}` : digits);
}

export async function venueToday(): Promise<string> {
  const row = await queryOne<{ d: string }>(`SELECT ${VENUE_TODAY_SQL}::text AS d`);
  return row?.d ?? new Date().toISOString().slice(0, 10);
}

/** Kolom pass + saldo kredit dari ledger (dipakai list, detail, dan booking). */
export const PASS_SELECT = `
  mp.id, mp.pass_code, mp.customer_id, c.name AS member_name, c.phone AS member_phone,
  mp.product_id, mp.product_name, mp.category, mp.status,
  mp.class_credits_total, mp.pt_credits_total, mp.facility_access,
  mp.price_paid::float8 AS price_paid, mp.class_value::float8 AS class_value,
  mp.pt_value::float8 AS pt_value, mp.facility_value::float8 AS facility_value,
  mp.valid_from::text AS valid_from, mp.valid_until::text AS valid_until, mp.frozen_days,
  mp.channel, mp.payment_method, mp.payment_ref, mp.paid_at, mp.journal_entry_id,
  mp.breakage_recognized_at, mp.cancelled_at, mp.cancel_reason, mp.notes, mp.created_at,
  COALESCE(u.class_used, 0)::int AS class_used,
  COALESCE(u.pt_used, 0)::int AS pt_used,
  COALESCE(u.class_redeemed, 0)::int AS class_redeemed,
  COALESCE(u.pt_redeemed, 0)::int AS pt_redeemed,
  COALESCE(u.recognized_class, 0)::float8 AS recognized_class,
  COALESCE(u.recognized_pt, 0)::float8 AS recognized_pt,
  COALESCE(u.recognized_facility, 0)::float8 AS recognized_facility`;

/**
 * Dari ledger: kredit terpakai (redeem + unredeem + adjust, untuk saldo sesi),
 * kredit yang benar-benar di-redeem (untuk nilai redeem berikutnya), dan nilai
 * yang sudah diakui revenue (redeem/unredeem/expire — basis utang tersisa).
 */
export const PASS_USAGE_JOIN = `
  LEFT JOIN LATERAL (
    SELECT
      -SUM(l.qty) FILTER (WHERE l.credit_type = 'class' AND l.entry_type IN ('redeem','unredeem','adjust')) AS class_used,
      -SUM(l.qty) FILTER (WHERE l.credit_type = 'pt' AND l.entry_type IN ('redeem','unredeem','adjust')) AS pt_used,
      -SUM(l.qty) FILTER (WHERE l.credit_type = 'class' AND l.entry_type IN ('redeem','unredeem')) AS class_redeemed,
      -SUM(l.qty) FILTER (WHERE l.credit_type = 'pt' AND l.entry_type IN ('redeem','unredeem')) AS pt_redeemed,
      SUM(l.amount) FILTER (WHERE l.credit_type = 'class' AND l.entry_type IN ('redeem','unredeem','expire')) AS recognized_class,
      SUM(l.amount) FILTER (WHERE l.credit_type = 'pt' AND l.entry_type IN ('redeem','unredeem','expire')) AS recognized_pt,
      SUM(l.amount) FILTER (WHERE l.credit_type = 'facility' AND l.entry_type = 'expire') AS recognized_facility
    FROM studio.pass_credit_ledger l WHERE l.pass_id = mp.id
  ) u ON true`;

/** Ringkasan nilai yang sudah diakui sebuah pass. */
export function recognizedOf(p: Pick<PassRow, "recognized_class" | "recognized_pt" | "recognized_facility">) {
  return { class: p.recognized_class, pt: p.recognized_pt, facility: p.recognized_facility };
}

export interface PassRow {
  id: string;
  pass_code: string;
  customer_id: string;
  member_name: string | null;
  member_phone: string;
  product_id: string;
  product_name: string;
  category: string;
  status: "pending_payment" | "active" | "expired" | "exhausted" | "cancelled";
  class_credits_total: number;
  pt_credits_total: number;
  facility_access: boolean;
  price_paid: number;
  class_value: number;
  pt_value: number;
  facility_value: number;
  valid_from: string;
  valid_until: string;
  frozen_days: number;
  channel: string;
  payment_method: string | null;
  payment_ref: string | null;
  paid_at: string | null;
  journal_entry_id: string | null;
  breakage_recognized_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  notes: string | null;
  created_at: string;
  class_used: number;
  pt_used: number;
  class_redeemed: number;
  pt_redeemed: number;
  recognized_class: number;
  recognized_pt: number;
  recognized_facility: number;
}

export async function loadPass(branchId: string, id: string): Promise<PassRow | null> {
  return queryOne<PassRow>(
    `SELECT ${PASS_SELECT}
     FROM studio.member_passes mp
     JOIN pos.pos_customers c ON c.id = mp.customer_id
     ${PASS_USAGE_JOIN}
     WHERE mp.id = $1 AND mp.branch_id = $2`,
    [id, branchId]
  );
}

const SALE_EVENT: Record<string, string> = {
  cash: "STUDIO_PASS_SALE_CASH",
  qris: "STUDIO_PASS_SALE_QRIS",
  card: "STUDIO_PASS_SALE_CARD",
  transfer: "STUDIO_PASS_SALE_TRANSFER",
  xendit: "STUDIO_PASS_SALE_ONLINE",
};

/**
 * Posting jurnal non-blocking: tanpa mapping aktif → dilewati, mapping belum
 * lengkap → draft. Kegagalan teknis dicatat saja; transaksi pass tidak dibatalkan.
 */
async function postPassJournal(
  ctx: StudioContext,
  eventCode: string,
  documentId: string,
  amount: number,
  entryDate: string,
  description: string
): Promise<string | null> {
  if (amount <= 0) return null;
  try {
    const res = await postJournalFromMapping({
      companyId: ctx.companyId,
      userId: ctx.user.id,
      eventCode,
      documentType: "STUDIO_PASS",
      documentId,
      entryDate,
      amounts: { TOTAL: amount, SUBTOTAL: amount, PAID: amount },
      description,
      sourceModule: "STUDIO",
    });
    return res.entryId ?? null;
  } catch (error) {
    console.error(`[studio] jurnal ${eventCode} gagal (non-blocking):`, error);
    return null;
  }
}

export interface IssuePassInput {
  customer_id: string;
  product_id: string;
  valid_from: string;
  payment_method: PaymentMethod;
  payment_ref?: string | null;
  notes?: string | null;
  price_override?: number | null;
}

async function uniquePassCode(client: PoolClient, branchId: string): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = generatePassCode();
    const { rowCount } = await client.query(`SELECT 1 FROM studio.member_passes WHERE branch_id = $1 AND pass_code = $2`, [branchId, code]);
    if (!rowCount) return code;
  }
  throw new Error("Gagal membuat kode pass unik");
}

/**
 * Jual pass di front desk (lunas). Kredit diterbitkan ke ledger, nilai harga
 * di-snapshot dari produk (harga khusus/diskon dibagi proporsional), lalu jurnal
 * penjualan → utang pass diposting.
 */
export async function issuePass(ctx: StudioContext, input: IssuePassInput): Promise<PassRow> {
  const passId = await withTransaction(async (client) => {
    const { rows: prodRows } = await client.query(
      `SELECT id, name, category, class_credits, pt_credits, facility_access, validity_days,
              price::float8 AS price, class_value::float8 AS class_value, pt_value::float8 AS pt_value,
              facility_value::float8 AS facility_value, is_active
       FROM studio.pass_products WHERE id = $1 AND branch_id = $2 FOR SHARE`,
      [input.product_id, ctx.branchId]
    );
    const p = prodRows[0];
    if (!p) throw ApiError.notFound("Paket tidak ditemukan");
    if (!p.is_active) throw ApiError.conflict("Paket sudah tidak dijual");

    const complimentary = input.payment_method === "complimentary";
    const price = complimentary ? 0 : input.price_override ?? p.price;
    // Harga khusus: bagi proporsional terhadap pembagian nilai produk.
    const ratio = p.price > 0 ? price / p.price : 0;
    const classValue = Math.round(p.class_value * ratio * 100) / 100;
    const ptValue = Math.round(p.pt_value * ratio * 100) / 100;
    const facilityValue = Math.round((price - classValue - ptValue) * 100) / 100;

    const code = await uniquePassCode(client, ctx.branchId);
    const { rows } = await client.query(
      `INSERT INTO studio.member_passes (company_id, branch_id, pass_code, customer_id, product_id, product_name, category,
         status, class_credits_total, pt_credits_total, facility_access, price_paid, class_value, pt_value, facility_value,
         valid_from, valid_until, channel, payment_method, payment_ref, paid_at, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11,$12,$13,$14,$15::date,
               ($15::date + ($16::int - 1)),$17,$18,$19,now(),$20,$21)
       RETURNING id`,
      [
        ctx.companyId, ctx.branchId, code, input.customer_id, p.id, p.name, p.category,
        p.class_credits, p.pt_credits, p.facility_access, price, classValue, ptValue, Math.max(facilityValue, 0),
        input.valid_from, p.validity_days, complimentary ? "complimentary" : "front_desk", input.payment_method,
        input.payment_ref ?? null, input.notes ?? null, ctx.user.id,
      ]
    );
    const id = rows[0].id as string;
    for (const [type, qty] of [["class", p.class_credits], ["pt", p.pt_credits]] as const) {
      if (qty > 0) {
        await client.query(
          `INSERT INTO studio.pass_credit_ledger (company_id, branch_id, pass_id, entry_type, credit_type, qty, note, created_by)
           VALUES ($1,$2,$3,'issue',$4,$5,'Penerbitan pass',$6)`,
          [ctx.companyId, ctx.branchId, id, type, qty, ctx.user.id]
        );
      }
    }
    return id;
  });

  const pass = (await loadPass(ctx.branchId, passId))!;
  const event = SALE_EVENT[input.payment_method];
  if (event) {
    const entryId = await postPassJournal(ctx, event, passId, pass.price_paid, await venueToday(),
      `Penjualan ${pass.product_name} ${pass.pass_code} — ${pass.member_name ?? pass.member_phone}`);
    if (entryId) await query(`UPDATE studio.member_passes SET journal_entry_id = $2 WHERE id = $1`, [passId, entryId]);
  }
  return pass;
}

/**
 * Kedaluwarsakan pass yang lewat masa berlaku: sisa kredit dipindah ke ledger
 * `expire` beserta nilainya, nilai facility ikut diakui, status → expired,
 * jurnal breakage diposting. Aman dipanggil berulang (hanya yang belum diproses).
 */
export async function expireDuePasses(ctx: StudioContext): Promise<{ expired: number; recognized: number }> {
  const due = await query<PassRow>(
    `SELECT ${PASS_SELECT}
     FROM studio.member_passes mp
     JOIN pos.pos_customers c ON c.id = mp.customer_id
     ${PASS_USAGE_JOIN}
     WHERE mp.branch_id = $1 AND mp.status IN ('active','exhausted')
       AND mp.breakage_recognized_at IS NULL AND mp.valid_until < ${VENUE_TODAY_SQL}
     ORDER BY mp.valid_until
     LIMIT 500`,
    [ctx.branchId]
  );
  const today = await venueToday();
  let recognized = 0;
  for (const p of due) {
    const balance = { class_total: p.class_credits_total, pt_total: p.pt_credits_total, class_used: p.class_used, pt_used: p.pt_used };
    const b = breakageOnExpiry(p, balance, recognizedOf(p));
    const total = Math.round((b.class_amount + b.pt_amount + b.facility_amount) * 100) / 100;
    const done = await withTransaction(async (client) => {
      const lock = await client.query(
        `UPDATE studio.member_passes SET status = 'expired', breakage_recognized_at = now(), updated_at = now()
         WHERE id = $1 AND breakage_recognized_at IS NULL RETURNING id`,
        [p.id]
      );
      if (!lock.rowCount) return false;
      const rows: [string, number, number][] = [
        ["class", -b.class_qty, b.class_amount],
        ["pt", -b.pt_qty, b.pt_amount],
        ["facility", 0, b.facility_amount],
      ];
      for (const [type, qty, amount] of rows) {
        if (qty === 0 && amount === 0) continue;
        await client.query(
          `INSERT INTO studio.pass_credit_ledger (company_id, branch_id, pass_id, entry_type, credit_type, qty, amount, note, created_by)
           VALUES ($1,$2,$3,'expire',$4,$5,$6,'Pass kedaluwarsa',$7)`,
          [ctx.companyId, ctx.branchId, p.id, type, qty, amount, ctx.user.id]
        );
      }
      return true;
    });
    if (!done) continue;
    recognized += total;
    await postPassJournal(ctx, "STUDIO_PASS_BREAKAGE", p.id, total, today,
      `Pass kedaluwarsa ${p.pass_code} — sisa ${b.class_qty} kelas, ${b.pt_qty} PT`);
  }
  return { expired: due.length, recognized: Math.round(recognized * 100) / 100 };
}

/** Batalkan pass yang belum pernah dipakai (refund penuh) + jurnal pembalik. */
export async function cancelPass(ctx: StudioContext, id: string, reason: string): Promise<PassRow> {
  const pass = await loadPass(ctx.branchId, id);
  if (!pass) throw ApiError.notFound("Pass tidak ditemukan");
  if (pass.status === "cancelled") throw ApiError.conflict("Pass sudah dibatalkan");
  if (pass.class_used !== 0 || pass.pt_used !== 0 || pass.class_redeemed > 0 || pass.pt_redeemed > 0 || pass.breakage_recognized_at) {
    throw ApiError.conflict("Pass yang sudah dipakai/kedaluwarsa tidak bisa dibatalkan — gunakan penyesuaian kredit");
  }
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE studio.member_passes SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now() WHERE id = $1`,
      [id, reason]
    );
    for (const [type, qty] of [["class", pass.class_credits_total], ["pt", pass.pt_credits_total]] as const) {
      if (qty > 0) {
        await client.query(
          `INSERT INTO studio.pass_credit_ledger (company_id, branch_id, pass_id, entry_type, credit_type, qty, note, created_by)
           VALUES ($1,$2,$3,'cancel',$4,$5,$6,$7)`,
          [ctx.companyId, ctx.branchId, id, type, -qty, `Dibatalkan: ${reason}`, ctx.user.id]
        );
      }
    }
  });
  await postPassJournal(ctx, "STUDIO_PASS_CANCEL", id, pass.price_paid, await venueToday(), `Pembatalan pass ${pass.pass_code}: ${reason}`);
  return (await loadPass(ctx.branchId, id))!;
}
