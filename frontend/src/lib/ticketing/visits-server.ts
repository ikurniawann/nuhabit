import "server-only";
// Kunjungan (tab rombongan) di loket: daftar, rincian ledger, top-up
// deposit, void baris tagihan, tandai gelang hilang, dan statistik tab.
// Registrasi → visit-registration-server; settlement →
// visit-settlement-server.

import type { PoolClient } from "pg";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { CASH_METHODS, normalizeNfcUid, type TicketingContext } from "./server";
import { splitTotalCount, toNumberOrNull } from "./sql";
import { computeTabSummary, settlementPlan } from "./tab";

const VISIT_NOT_FOUND = "Kunjungan tidak ditemukan";

/**
 * Kunci visit venue (FOR UPDATE) — serialisasi dgn gate tap / settle /
 * charge F&B. 404 bila tak ada; 409 `closedMessage` bila tidak open.
 */
export async function lockOpenVisit<T extends { status: string }>(
  client: PoolClient,
  ctx: TicketingContext,
  visitId: string,
  columns: string,
  closedMessage: string
): Promise<T> {
  const result = await client.query<T>(
    `SELECT ${columns} FROM ticketing.ticket_visits
     WHERE id = $1 AND branch_id = $2 AND company_id = $3
     FOR UPDATE`,
    [visitId, ctx.branchId, ctx.companyId]
  );
  const visit = result.rows[0];
  if (!visit) throw ApiError.notFound(VISIT_NOT_FOUND);
  if (visit.status !== "open") throw ApiError.conflict(closedMessage);
  return visit;
}

// ── Daftar & rincian ──────────────────────────────────────────────────

export const VISIT_STATUSES = ["open", "settled", "void"] as const;

interface VisitListRow {
  id: string;
  contact_name: string;
  contact_phone: string | null;
  payment_mode: "postpaid" | "prepaid";
  credit_limit: string | null;
  status: (typeof VISIT_STATUSES)[number];
  opened_at: string;
  settled_at: string | null;
  band_count: string;
  active_band_count: string;
  debit: string;
  kredit: string;
  total_count: string;
}

export async function listVisits(
  ctx: TicketingContext,
  filter: { status: string; q: string; page: number; limit: number }
) {
  const conditions = ["v.branch_id = $1", "v.company_id = $2", "v.status = $3"];
  const params: unknown[] = [ctx.branchId, ctx.companyId, filter.status];
  if (filter.q) {
    params.push(`%${filter.q}%`, normalizeNfcUid(filter.q) || filter.q);
    conditions.push(
      `(v.contact_name ILIKE $${params.length - 1}
        OR v.contact_phone ILIKE $${params.length - 1}
        OR EXISTS (
          SELECT 1 FROM ticketing.ticket_visit_bands vb
          JOIN ticketing.ticket_bands b ON b.id = vb.band_id
          WHERE vb.visit_id = v.id AND b.nfc_uid = $${params.length}
        ))`
    );
  }

  params.push(filter.limit, (filter.page - 1) * filter.limit);
  const rows = await query<VisitListRow>(
    `SELECT v.id, v.contact_name, v.contact_phone, v.payment_mode,
            v.credit_limit, v.status, v.opened_at, v.settled_at,
            (SELECT COUNT(*) FROM ticketing.ticket_visit_bands vb
             WHERE vb.visit_id = v.id) AS band_count,
            (SELECT COUNT(*) FROM ticketing.ticket_visit_bands vb
             WHERE vb.visit_id = v.id AND vb.status = 'aktif') AS active_band_count,
            COALESCE((SELECT SUM(c.amount) FROM ticketing.ticket_visit_charges c
             WHERE c.visit_id = v.id AND c.direction = 'debit'), 0) AS debit,
            COALESCE((SELECT SUM(c.amount) FROM ticketing.ticket_visit_charges c
             WHERE c.visit_id = v.id AND c.direction = 'kredit'), 0) AS kredit,
            COUNT(*) OVER() AS total_count
     FROM ticketing.ticket_visits v
     WHERE ${conditions.join(" AND ")}
     ORDER BY v.opened_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const { total, items } = splitTotalCount(rows);
  return {
    total,
    items: items.map((visit) => {
      const debit = Number(visit.debit);
      const kredit = Number(visit.kredit);
      return {
        ...visit,
        band_count: Number(visit.band_count),
        active_band_count: Number(visit.active_band_count),
        debit,
        kredit,
        outstanding: Math.round((debit - kredit) * 100) / 100,
        saldo: Math.round((kredit - debit) * 100) / 100,
      };
    }),
  };
}

interface VisitRow {
  id: string;
  contact_name: string;
  contact_phone: string | null;
  payment_mode: "postpaid" | "prepaid";
  credit_limit: string | null;
  status: string;
  opened_at: string;
  settled_at: string | null;
  notes: string | null;
}

interface VisitBandRow {
  id: string;
  band_id: string;
  nfc_uid: string;
  label: string | null;
  variant_id: string;
  ticket_type_name: string;
  guest_name: string | null;
  entered_at: string | null;
  status: string;
}

interface ChargeRow {
  id: string;
  band_id: string | null;
  charge_type: string;
  direction: "debit" | "kredit";
  description: string;
  amount: string;
  payment_method: string | null;
  pos_order_id: string | null;
  voided_by_charge_id: string | null;
  created_at: string;
}

export async function getVisitDetail(ctx: TicketingContext, id: string) {
  const visit = await queryOne<VisitRow>(
    `SELECT id, contact_name, contact_phone, payment_mode, credit_limit,
            status, opened_at, settled_at, notes
     FROM ticketing.ticket_visits
     WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
    [id, ctx.branchId, ctx.companyId]
  );
  if (!visit) throw ApiError.notFound(VISIT_NOT_FOUND);

  const [bands, charges] = await Promise.all([
    query<VisitBandRow>(
      `SELECT vb.id, vb.band_id, b.nfc_uid, b.label, vb.variant_id,
              tp.name || ' — ' || pv.name AS ticket_type_name,
              vb.guest_name, vb.entered_at, vb.status
       FROM ticketing.ticket_visit_bands vb
       JOIN ticketing.ticket_bands b ON b.id = vb.band_id
       JOIN ticketing.ticket_product_variants pv ON pv.id = vb.variant_id
       JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
       WHERE vb.visit_id = $1
       ORDER BY vb.created_at`,
      [id]
    ),
    query<ChargeRow>(
      `SELECT id, band_id, charge_type, direction, description, amount,
              payment_method, pos_order_id, voided_by_charge_id, created_at
       FROM ticketing.ticket_visit_charges
       WHERE visit_id = $1
       ORDER BY created_at, id`,
      [id]
    ),
  ]);

  const summary = computeTabSummary(
    charges.map((c) => ({ direction: c.direction, amount: Number(c.amount) }))
  );
  return {
    visit: { ...visit, credit_limit: toNumberOrNull(visit.credit_limit) },
    bands,
    charges: charges.map((c) => ({ ...c, amount: Number(c.amount) })),
    summary,
    plan: settlementPlan(summary),
  };
}

/** Tab monitor live: ringkasan kunjungan berjalan untuk halaman loket. */
export async function loadTabStats(ctx: TicketingContext) {
  const stats = await queryOne<{
    open_visits: string;
    open_bands: string;
    outstanding_total: string;
    saldo_total: string;
  }>(
    `SELECT
       COUNT(*) AS open_visits,
       COALESCE(SUM((SELECT COUNT(*) FROM ticketing.ticket_visit_bands vb
         WHERE vb.visit_id = v.id AND vb.status = 'aktif')), 0) AS open_bands,
       COALESCE(SUM(CASE WHEN v.payment_mode = 'postpaid' THEN GREATEST(bal.net, 0) END), 0)
         AS outstanding_total,
       COALESCE(SUM(CASE WHEN v.payment_mode = 'prepaid' THEN GREATEST(-bal.net, 0) END), 0)
         AS saldo_total
     FROM ticketing.ticket_visits v
     CROSS JOIN LATERAL (
       SELECT COALESCE(SUM(CASE WHEN c.direction = 'debit' THEN c.amount
                                ELSE -c.amount END), 0) AS net
       FROM ticketing.ticket_visit_charges c
       WHERE c.visit_id = v.id
     ) bal
     WHERE v.branch_id = $1 AND v.company_id = $2 AND v.status = 'open'`,
    [ctx.branchId, ctx.companyId]
  );
  return {
    open_visits: Number(stats?.open_visits ?? 0),
    open_bands: Number(stats?.open_bands ?? 0),
    outstanding_total: Number(stats?.outstanding_total ?? 0),
    saldo_total: Number(stats?.saldo_total ?? 0),
  };
}

// ── Top-up deposit ────────────────────────────────────────────────────

export const topupSchema = z.object({
  amount: z.number().positive().max(1_000_000_000),
  method: z.enum(CASH_METHODS),
});

/** Top-up ulang saldo prepaid — bisa dari kasir mana pun selama visit open. */
export async function topUpDeposit(
  ctx: TicketingContext,
  visitId: string,
  body: z.infer<typeof topupSchema>
) {
  // Bulatkan 2dp — ledger bebas noise pecahan sen
  const amount = Math.round(body.amount * 100) / 100;
  if (amount <= 0) throw ApiError.badRequest("Nominal top-up harus > 0");

  await withTransaction(async (client) => {
    const visit = await lockOpenVisit<{ payment_mode: string; status: string }>(
      client,
      ctx,
      visitId,
      "payment_mode, status",
      "Kunjungan sudah ditutup — top-up tidak bisa"
    );
    if (visit.payment_mode !== "prepaid") {
      throw ApiError.badRequest("Top-up hanya untuk kunjungan mode prepaid");
    }
    await client.query(
      `INSERT INTO ticketing.ticket_visit_charges
         (company_id, branch_id, visit_id, charge_type, direction,
          description, amount, payment_method, created_by)
       VALUES ($1, $2, $3, 'deposit', 'kredit', $4, $5, $6, $7)`,
      [
        ctx.companyId,
        ctx.branchId,
        visitId,
        `Top-up deposit (${body.method})`,
        amount,
        body.method,
        ctx.user.id,
      ]
    );
  });
}

// ── Void baris tagihan ────────────────────────────────────────────────

/**
 * Void baris tagihan (debit) di tab: tulis baris pembalik `koreksi`
 * ber-arah kredit dengan `voided_by_charge_id` menunjuk baris asal —
 * append-only, tidak pernah delete. Idempotent: baris yang sudah punya
 * pembalik ditolak.
 */
export async function voidVisitCharge(
  ctx: TicketingContext,
  visitId: string,
  chargeId: string,
  reason: string
) {
  await withTransaction(async (client) => {
    await lockOpenVisit(
      client,
      ctx,
      visitId,
      "status",
      "Kunjungan sudah ditutup — void lewat koreksi manual"
    );

    const chargeResult = await client.query<{
      band_id: string | null;
      charge_type: string;
      direction: string;
      description: string;
      amount: string;
    }>(
      `SELECT band_id, charge_type, direction, description, amount
       FROM ticketing.ticket_visit_charges
       WHERE id = $1 AND visit_id = $2`,
      [chargeId, visitId]
    );
    const charge = chargeResult.rows[0];
    if (!charge) throw ApiError.notFound("Baris tagihan tidak ditemukan");
    if (charge.direction !== "debit" || charge.charge_type === "refund-deposit") {
      throw ApiError.badRequest("Hanya baris tagihan (tiket/F&B/denda/koreksi) yang bisa di-void");
    }

    const reversed = await client.query(
      `SELECT 1 FROM ticketing.ticket_visit_charges
       WHERE voided_by_charge_id = $1 LIMIT 1`,
      [chargeId]
    );
    if (reversed.rows.length > 0) throw ApiError.conflict("Baris ini sudah pernah di-void");

    await client.query(
      `INSERT INTO ticketing.ticket_visit_charges
         (company_id, branch_id, visit_id, band_id, charge_type, direction,
          description, amount, voided_by_charge_id, created_by)
       VALUES ($1, $2, $3, $4, 'koreksi', 'kredit', $5, $6, $7, $8)`,
      [
        ctx.companyId,
        ctx.branchId,
        visitId,
        charge.band_id,
        `Void: ${charge.description} — ${reason}`,
        charge.amount,
        chargeId,
        ctx.user.id,
      ]
    );
  });
}

// ── Gelang hilang ─────────────────────────────────────────────────────

/**
 * Keputusan owner 2026-07-22: gelang hilang TANPA denda — tagihan tetap
 * ditagih by data saat settlement. Di sini hanya memblokir gelangnya:
 * visit_band → 'hilang' (gate tap & F&B "NFC Tab" otomatis menolak karena
 * keduanya mensyaratkan status 'aktif') dan registry band → 'hilang'
 * (tidak bisa dipakai registrasi baru). Tidak bisa di-undo dari sini —
 * bila gelang ketemu lagi, setelah settlement petugas mengubah statusnya
 * ke 'tersedia' di registry gelang.
 */
export async function markVisitBandLost(
  ctx: TicketingContext,
  visitId: string,
  visitBandId: string
): Promise<{ visit_band_id: string; nfc_uid: string }> {
  return withTransaction(async (client) => {
    await lockOpenVisit(client, ctx, visitId, "status", "Kunjungan sudah ditutup");

    const vbResult = await client.query<{
      id: string;
      band_id: string;
      status: string;
      nfc_uid: string;
    }>(
      `SELECT vb.id, vb.band_id, vb.status, b.nfc_uid
       FROM ticketing.ticket_visit_bands vb
       JOIN ticketing.ticket_bands b ON b.id = vb.band_id
       WHERE vb.id = $1 AND vb.visit_id = $2
       FOR UPDATE OF vb, b`,
      [visitBandId, visitId]
    );
    const visitBand = vbResult.rows[0];
    if (!visitBand) throw ApiError.notFound("Gelang tidak ada di kunjungan ini");
    if (visitBand.status !== "aktif") {
      throw ApiError.conflict("Gelang sudah di-settle / sudah ditandai hilang");
    }

    await client.query(
      `UPDATE ticketing.ticket_visit_bands
       SET status = 'hilang', updated_at = now() WHERE id = $1`,
      [visitBand.id]
    );
    // Registry ikut 'hilang' — gelang yang ditemukan orang lain tidak
    // bisa dipakai registrasi/redeem (syarat 'tersedia' existing)
    await client.query(
      `UPDATE ticketing.ticket_bands
       SET status = 'hilang', updated_at = now()
       WHERE id = $1 AND status = 'dipakai'`,
      [visitBand.band_id]
    );
    return { visit_band_id: visitBand.id, nfc_uid: visitBand.nfc_uid };
  });
}
