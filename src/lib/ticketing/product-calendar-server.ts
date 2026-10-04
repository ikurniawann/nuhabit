import "server-only";
// Kalender per ticket: rentang high season / blok penjualan online, dan
// simpan hasil ceklis kalender bulanan (flow owner).

import type { PoolClient } from "pg";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { planDateUnmark } from "./distribution";
import { isValidCalendarDate } from "./pricing";
import { PRODUCT_NOT_FOUND, lockProduct } from "./products-server";
import type { TicketingContext } from "./server";

const DATE_KINDS = ["high-season", "blok-online"] as const;

export const createProductDateSchema = z.object({
  date_kind: z.enum(DATE_KINDS),
  label: z.string().trim().min(1).max(120),
  start_date: z.string(),
  end_date: z.string(),
});

/** Tambah rentang kalender ticket: high season atau blok penjualan online. */
export async function addProductDateRange(
  ctx: TicketingContext,
  productId: string,
  body: z.infer<typeof createProductDateSchema>
) {
  if (
    !isValidCalendarDate(body.start_date) ||
    !isValidCalendarDate(body.end_date) ||
    body.end_date < body.start_date
  ) {
    throw ApiError.badRequest("Rentang tanggal tidak valid");
  }
  const product = await queryOne<{ id: string }>(
    `SELECT id FROM ticketing.ticket_products
     WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
    [productId, ctx.branchId, ctx.companyId]
  );
  if (!product) throw ApiError.notFound(PRODUCT_NOT_FOUND);

  const rows = await query<{ id: string }>(
    `INSERT INTO ticketing.ticket_product_dates
       (company_id, branch_id, ticket_product_id, date_kind, label,
        start_date, end_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      ctx.companyId,
      ctx.branchId,
      productId,
      body.date_kind,
      body.label,
      body.start_date,
      body.end_date,
      ctx.user.id,
    ]
  );
  return rows[0];
}

/** Hapus rentang kalender ticket (master murni — boleh hard delete). */
export async function deleteProductDateRange(
  ctx: TicketingContext,
  productId: string,
  dateId: string
) {
  const rows = await query<{ id: string }>(
    `DELETE FROM ticketing.ticket_product_dates
     WHERE id = $1 AND ticket_product_id = $2
       AND branch_id = $3 AND company_id = $4
     RETURNING id`,
    [dateId, productId, ctx.branchId, ctx.companyId]
  );
  if (rows.length === 0) throw ApiError.notFound("Rentang tanggal tidak ditemukan");
}

export const bulkProductDatesSchema = z.object({
  date_kind: z.enum(DATE_KINDS),
  /** Tanggal YYYY-MM-DD yang DICEKLIS (ditandai). */
  add: z.array(z.string()).max(100).default([]),
  /** Tanggal YYYY-MM-DD yang DI-UNCEKLIS (hapus tanda). */
  remove: z.array(z.string()).max(100).default([]),
});

async function removeDateMark(
  client: PoolClient,
  productId: string,
  dateKind: string,
  date: string
) {
  const ranges = await client.query<{ id: string; start_date: string; end_date: string }>(
    `SELECT id, start_date::text AS start_date, end_date::text AS end_date
     FROM ticketing.ticket_product_dates
     WHERE ticket_product_id = $1 AND date_kind = $2
       AND start_date <= $3 AND end_date >= $3`,
    [productId, dateKind, date]
  );

  for (const range of ranges.rows) {
    const plan = planDateUnmark(range, date);
    if (plan.kind === "delete") {
      await client.query(`DELETE FROM ticketing.ticket_product_dates WHERE id = $1`, [range.id]);
    } else if (plan.kind === "set-start") {
      await client.query(
        `UPDATE ticketing.ticket_product_dates
         SET start_date = $2, updated_at = now() WHERE id = $1`,
        [range.id, plan.start]
      );
    } else {
      // set-end dan split sama-sama memotong ujung rentang lama
      await client.query(
        `UPDATE ticketing.ticket_product_dates
         SET end_date = $2, updated_at = now() WHERE id = $1`,
        [range.id, plan.kind === "set-end" ? plan.end : plan.leftEnd]
      );
      if (plan.kind === "split") {
        await client.query(
          `INSERT INTO ticketing.ticket_product_dates
             (company_id, branch_id, ticket_product_id, date_kind, label,
              start_date, end_date)
           SELECT company_id, branch_id, ticket_product_id, date_kind, label,
                  $2, $3
           FROM ticketing.ticket_product_dates WHERE id = $1`,
          [range.id, plan.rightStart, range.end_date]
        );
      }
    }
  }
}

/**
 * Simpan hasil ceklis kalender bulanan (flow owner): tiap tanggal yang
 * diceklis jadi baris sehari; unceklis menghapus tanda (rentang lama
 * ikut dibelah bila perlu). Idempotent — tanggal yang sudah tertanda
 * tidak diduplikasi.
 */
export async function saveProductDateMarks(
  ctx: TicketingContext,
  productId: string,
  body: z.infer<typeof bulkProductDatesSchema>
) {
  if ([...body.add, ...body.remove].some((d) => !isValidCalendarDate(d))) {
    throw ApiError.badRequest("Ada tanggal yang tidak valid");
  }
  if (body.add.length === 0 && body.remove.length === 0) return;

  await withTransaction(async (client) => {
    await lockProduct(client, ctx, productId, "id");

    for (const date of body.remove) {
      await removeDateMark(client, productId, body.date_kind, date);
    }

    for (const date of new Set(body.add)) {
      // Idempotent: lewati bila tanggal sudah tertanda kind yang sama
      const existing = await client.query(
        `SELECT 1 FROM ticketing.ticket_product_dates
         WHERE ticket_product_id = $1 AND date_kind = $2
           AND start_date <= $3 AND end_date >= $3
         LIMIT 1`,
        [productId, body.date_kind, date]
      );
      if (existing.rows.length > 0) continue;
      await client.query(
        `INSERT INTO ticketing.ticket_product_dates
           (company_id, branch_id, ticket_product_id, date_kind, label,
            start_date, end_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
        [ctx.companyId, ctx.branchId, productId, body.date_kind, date, date, ctx.user.id]
      );
    }
  });
}
