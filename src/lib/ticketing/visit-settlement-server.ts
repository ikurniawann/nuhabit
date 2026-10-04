import "server-only";
// Settlement kasir keluar — transaksional & atomik:
// - Tanpa visit_band_id: tutup seluruh rombongan (postpaid bayar total;
//   prepaid refund sisa saldo / tagih kekurangan), release semua gelang,
//   visit → settled.
// - Dengan visit_band_id (postpaid saja): bayar tagihan satu gelang,
//   release gelang itu; visit tetap open selama masih ada gelang aktif
//   atau ledger belum seimbang.

import type { PoolClient } from "pg";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { formatRupiah } from "@/lib/format";
import { CASH_METHODS, type TicketingContext } from "./server";
import { computeTabSummary, settlementPlan } from "./tab";
import { lockOpenVisit } from "./visits-server";

export const settleSchema = z.object({
  // settle satu gelang saja (postpaid) — kosong = tutup seluruh rombongan
  visit_band_id: z.string().uuid().optional().nullable(),
  payments: z
    .array(
      z.object({
        method: z.enum(CASH_METHODS),
        amount: z.number().positive().max(1_000_000_000),
      })
    )
    .max(5)
    .optional(),
  refund_method: z.enum(CASH_METHODS).optional(),
});

type SettleInput = z.infer<typeof settleSchema>;
type Payment = { method: (typeof CASH_METHODS)[number]; amount: number };

export type SettleResult =
  | { mode: "per-gelang"; paid: number; closed: boolean }
  | { mode: "rombongan"; paid: number; refunded: number; closed: true };

const round2 = (n: number) => Math.round(n * 100) / 100;

const exactAmountError = (paid: number, due: number) =>
  ApiError.badRequest(
    `Nominal pembayaran (${formatRupiah(paid)}) harus pas ${formatRupiah(due)}`
  );

async function loadCharges(client: PoolClient, visitId: string) {
  const result = await client.query<{
    band_id: string | null;
    direction: "debit" | "kredit";
    amount: string;
  }>(
    `SELECT band_id, direction, amount
     FROM ticketing.ticket_visit_charges
     WHERE visit_id = $1`,
    [visitId]
  );
  return result.rows.map((row) => ({
    band_id: row.band_id,
    direction: row.direction,
    amount: Number(row.amount),
  }));
}

async function closeVisit(client: PoolClient, ctx: TicketingContext, visitId: string) {
  await client.query(
    `UPDATE ticketing.ticket_visits
     SET status = 'settled', settled_at = now(), settled_by = $2,
         updated_at = now()
     WHERE id = $1`,
    [visitId, ctx.user.id]
  );
}

async function insertPayments(
  client: PoolClient,
  ctx: TicketingContext,
  visitId: string,
  payments: Payment[],
  band: { id: string; label: string } | null
) {
  for (const payment of payments) {
    await client.query(
      `INSERT INTO ticketing.ticket_visit_charges
         (company_id, branch_id, visit_id, band_id, charge_type,
          direction, description, amount, payment_method, created_by)
       VALUES ($1, $2, $3, $4, 'pembayaran', 'kredit', $5, $6, $7, $8)`,
      [
        ctx.companyId,
        ctx.branchId,
        visitId,
        band?.id ?? null,
        `${band ? band.label : "Pembayaran settlement"} (${payment.method})`,
        payment.amount,
        payment.method,
        ctx.user.id,
      ]
    );
  }
}

async function settleSingleBand(
  client: PoolClient,
  ctx: TicketingContext,
  visitId: string,
  visitBandId: string,
  payments: Payment[],
  paidTotal: number
): Promise<SettleResult> {
  const vbResult = await client.query<{ id: string; band_id: string; status: string }>(
    `SELECT id, band_id, status FROM ticketing.ticket_visit_bands
     WHERE id = $1 AND visit_id = $2
     FOR UPDATE`,
    [visitBandId, visitId]
  );
  const visitBand = vbResult.rows[0];
  if (!visitBand) throw ApiError.notFound("Gelang tidak ada di kunjungan ini");
  if (visitBand.status !== "aktif") {
    throw ApiError.conflict("Gelang sudah di-settle / tidak aktif");
  }

  const charges = await loadCharges(client, visitId);
  const due = round2(
    computeTabSummary(charges.filter((c) => c.band_id === visitBand.band_id)).outstanding
  );
  if (due <= 0 && paidTotal > 0) {
    throw ApiError.badRequest("Gelang ini tidak punya tagihan — pembayaran tidak diperlukan");
  }
  if (due > 0 && paidTotal !== due) throw exactAmountError(paidTotal, due);
  if (due > 0) {
    await insertPayments(client, ctx, visitId, payments, {
      id: visitBand.band_id,
      label: "Pembayaran settle gelang",
    });
  }

  await client.query(
    `UPDATE ticketing.ticket_visit_bands
     SET status = 'selesai', updated_at = now() WHERE id = $1`,
    [visitBand.id]
  );
  await client.query(
    `UPDATE ticketing.ticket_bands
     SET status = 'tersedia', updated_at = now()
     WHERE id = $1 AND status = 'dipakai'`,
    [visitBand.band_id]
  );

  // Tutup visit otomatis bila tidak ada gelang aktif & ledger seimbang
  const remaining = await client.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM ticketing.ticket_visit_bands
     WHERE visit_id = $1 AND status = 'aktif'`,
    [visitId]
  );
  const afterSummary = computeTabSummary(await loadCharges(client, visitId));
  const closed = Number(remaining.rows[0].n) === 0 && afterSummary.outstanding === 0;
  if (closed) await closeVisit(client, ctx, visitId);
  return { mode: "per-gelang", paid: due, closed };
}

async function settleWholeVisit(
  client: PoolClient,
  ctx: TicketingContext,
  visitId: string,
  payments: Payment[],
  paidTotal: number,
  refundMethod: Payment["method"]
): Promise<SettleResult> {
  const plan = settlementPlan(computeTabSummary(await loadCharges(client, visitId)));
  if (plan.amountDue > 0 && paidTotal !== plan.amountDue) {
    throw exactAmountError(paidTotal, plan.amountDue);
  }
  if (plan.amountDue === 0 && paidTotal > 0) {
    throw ApiError.badRequest("Tidak ada tagihan — pembayaran tidak diperlukan");
  }

  await insertPayments(client, ctx, visitId, payments, null);
  if (plan.refundAmount > 0) {
    await client.query(
      `INSERT INTO ticketing.ticket_visit_charges
         (company_id, branch_id, visit_id, charge_type, direction,
          description, amount, payment_method, created_by)
       VALUES ($1, $2, $3, 'refund-deposit', 'debit', $4, $5, $6, $7)`,
      [
        ctx.companyId,
        ctx.branchId,
        visitId,
        `Refund sisa deposit (${refundMethod})`,
        plan.refundAmount,
        refundMethod,
        ctx.user.id,
      ]
    );
  }

  await closeVisit(client, ctx, visitId);
  // Release semua gelang yang masih aktif (gelang hilang tetap hilang)
  await client.query(
    `UPDATE ticketing.ticket_bands b
     SET status = 'tersedia', updated_at = now()
     FROM ticketing.ticket_visit_bands vb
     WHERE vb.visit_id = $1 AND vb.band_id = b.id
       AND vb.status = 'aktif' AND b.status = 'dipakai'`,
    [visitId]
  );
  await client.query(
    `UPDATE ticketing.ticket_visit_bands
     SET status = 'selesai', updated_at = now()
     WHERE visit_id = $1 AND status = 'aktif'`,
    [visitId]
  );

  return { mode: "rombongan", paid: plan.amountDue, refunded: plan.refundAmount, closed: true };
}

export async function settleVisit(
  ctx: TicketingContext,
  visitId: string,
  body: SettleInput
): Promise<SettleResult> {
  // Bulatkan tiap baris — ledger bebas noise pecahan sen
  const payments = (body.payments ?? []).map((p) => ({ ...p, amount: round2(p.amount) }));
  const paidTotal = round2(payments.reduce((sum, p) => sum + p.amount, 0));

  return withTransaction(async (client) => {
    const visit = await lockOpenVisit<{ payment_mode: "postpaid" | "prepaid"; status: string }>(
      client,
      ctx,
      visitId,
      "payment_mode, status",
      "Kunjungan sudah ditutup"
    );
    if (!body.visit_band_id) {
      return settleWholeVisit(client, ctx, visitId, payments, paidTotal, body.refund_method ?? "cash");
    }
    if (visit.payment_mode === "prepaid") {
      throw ApiError.badRequest(
        "Mode prepaid di-settle satu rombongan sekaligus (refund sisa saldo)"
      );
    }
    return settleSingleBand(client, ctx, visitId, body.visit_band_id, payments, paidTotal);
  });
}
