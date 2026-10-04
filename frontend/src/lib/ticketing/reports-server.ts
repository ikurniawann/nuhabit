import "server-only";
// Query Laporan Ticketing (EPIC-023 Fase E). Tanggal memakai hari
// operasional venue (WIB), bukan UTC server; agregasi di reports.ts.

import { query } from "@/lib/db";
import {
  buildTicketingReport,
  type CountRow,
  type HangingRow,
  type LedgerRow,
  type MethodRow,
  type TicketContextRow,
} from "./reports";
import type { TicketingContext } from "./server";

const HANGING_LIMIT = 50;

const dayExpr = (col: string) => `(${col} AT TIME ZONE 'Asia/Jakarta')::date`;

export async function loadTicketingReport(ctx: TicketingContext, from: string, to: string) {
  const venue = [ctx.branchId, ctx.companyId];
  const ranged = [ctx.branchId, ctx.companyId, from, to];

  const [
    ledger,
    ticketContexts,
    methods,
    gateDaily,
    visitDaily,
    bandsRecap,
    hanging,
    variantNames,
    channelNames,
    bundleNames,
    bookingDeposit,
    bookingForfeited,
  ] = await Promise.all([
    // Net per hari × jenis efektif (void menunjuk jenis baris asal)
    query<LedgerRow>(
      `SELECT ${dayExpr("c.created_at")}::text AS day,
              COALESCE(orig.charge_type, c.charge_type) AS eff_type,
              SUM(CASE WHEN c.direction = 'debit' THEN c.amount ELSE -c.amount END) AS net,
              SUM(CASE WHEN c.direction = 'debit' THEN 1 ELSE -1 END) AS qty
       FROM ticketing.ticket_visit_charges c
       LEFT JOIN ticketing.ticket_visit_charges orig
         ON orig.id = c.voided_by_charge_id
       WHERE c.branch_id = $1 AND c.company_id = $2
         AND ${dayExpr("c.created_at")} BETWEEN $3 AND $4
       GROUP BY 1, 2`,
      ranged
    ),
    // Rincian tiket per konteks harga (varian/kanal/musim/paket) — net
    query<TicketContextRow>(
      `SELECT ctx.j->>'variant_id' AS variant_id,
              ctx.j->>'channel_id' AS channel_id,
              ctx.j->>'season_kind' AS season_kind,
              ctx.j->>'bundle_product_id' AS bundle_product_id,
              SUM(CASE WHEN c.direction = 'debit' THEN c.amount ELSE -c.amount END) AS net,
              SUM(CASE WHEN c.direction = 'debit' THEN 1 ELSE -1 END) AS qty
       FROM ticketing.ticket_visit_charges c
       LEFT JOIN ticketing.ticket_visit_charges orig
         ON orig.id = c.voided_by_charge_id
       CROSS JOIN LATERAL (
         SELECT COALESCE(c.price_context, orig.price_context, '{}'::jsonb) AS j
       ) ctx
       WHERE c.branch_id = $1 AND c.company_id = $2
         AND COALESCE(orig.charge_type, c.charge_type) = 'tiket'
         AND ${dayExpr("c.created_at")} BETWEEN $3 AND $4
       GROUP BY 1, 2, 3, 4`,
      ranged
    ),
    // Uang fisik per metode (rekonsiliasi kasir): masuk deposit +
    // pembayaran, keluar refund-deposit
    query<MethodRow>(
      `SELECT c.charge_type, COALESCE(c.payment_method, 'lainnya') AS method,
              SUM(c.amount) AS total
       FROM ticketing.ticket_visit_charges c
       WHERE c.branch_id = $1 AND c.company_id = $2
         AND c.charge_type IN ('deposit', 'pembayaran', 'refund-deposit')
         AND ${dayExpr("c.created_at")} BETWEEN $3 AND $4
       GROUP BY 1, 2
       ORDER BY 1, 2`,
      ranged
    ),
    // Traffic gate per hari × hasil tap
    query<CountRow & { day: string }>(
      `SELECT ${dayExpr("created_at")}::text AS day, result AS key,
              COUNT(*) AS n
       FROM ticketing.ticket_gate_events
       WHERE branch_id = $1 AND company_id = $2
         AND ${dayExpr("created_at")} BETWEEN $3 AND $4
       GROUP BY 1, 2`,
      ranged
    ),
    query<CountRow>(
      `SELECT ${dayExpr("opened_at")}::text AS key, COUNT(*) AS n
       FROM ticketing.ticket_visits
       WHERE branch_id = $1 AND company_id = $2
         AND ${dayExpr("opened_at")} BETWEEN $3 AND $4
       GROUP BY 1`,
      ranged
    ),
    // Rekap gelang = keadaan SAAT INI (bukan per rentang)
    query<CountRow>(
      `SELECT status AS key, COUNT(*) AS n
       FROM ticketing.ticket_bands
       WHERE branch_id = $1 AND company_id = $2
       GROUP BY 1`,
      venue
    ),
    // Tab menggantung = visit open ber-outstanding positif (keadaan kini)
    query<HangingRow>(
      `SELECT v.id, v.contact_name, v.payment_mode, v.opened_at,
              COALESCE(SUM(CASE WHEN c.direction = 'debit' THEN c.amount
                                ELSE -c.amount END), 0) AS outstanding
       FROM ticketing.ticket_visits v
       LEFT JOIN ticketing.ticket_visit_charges c ON c.visit_id = v.id
       WHERE v.branch_id = $1 AND v.company_id = $2 AND v.status = 'open'
       GROUP BY v.id
       HAVING COALESCE(SUM(CASE WHEN c.direction = 'debit' THEN c.amount
                                ELSE -c.amount END), 0) > 0
       ORDER BY v.opened_at
       LIMIT ${HANGING_LIMIT}`,
      venue
    ),
    query<{ id: string; variant_name: string; product_name: string }>(
      `SELECT pv.id, pv.name AS variant_name, tp.name AS product_name
       FROM ticketing.ticket_product_variants pv
       JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
       WHERE pv.branch_id = $1 AND pv.company_id = $2`,
      venue
    ),
    query<{ id: string; name: string }>(
      `SELECT id, name FROM ticketing.ticket_channels
       WHERE branch_id = $1 AND company_id = $2`,
      venue
    ),
    query<{ id: string; name: string }>(
      `SELECT id, name FROM ticketing.ticket_products
       WHERE branch_id = $1 AND company_id = $2 AND product_kind = 'bundle'`,
      venue
    ),
    // Titipan booking = pendapatan diterima di muka (keadaan KINI):
    // terbayar & belum di-redeem → uang sudah di tangan, belum revenue
    query<{ n: string; total: string }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
       FROM ticketing.ticket_bookings
       WHERE branch_id = $1 AND company_id = $2
         AND status = 'terbayar' AND visit_id IS NULL`,
      venue
    ),
    // Pendapatan hangus dalam rentang — diakui di tanggal forfeited_at
    query<{ n: string; total: string }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
       FROM ticketing.ticket_bookings
       WHERE branch_id = $1 AND company_id = $2
         AND status = 'hangus'
         AND ${dayExpr("forfeited_at")} BETWEEN $3 AND $4`,
      ranged
    ),
  ]);

  return buildTicketingReport(from, to, {
    ledger,
    ticketContexts,
    methods,
    gateDaily,
    visitDaily,
    bandsRecap,
    hanging,
    variantNames,
    channelNames,
    bundleNames,
    bookingDeposit,
    bookingForfeited,
  });
}
