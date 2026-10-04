import "server-only";
// Jembatan resolver harga murni (pricing.ts v2) ke data ber-tenant:
// varian produk ticket + kalender per ticket + override harga kanal.
// Dipakai gate tap-charge dan (Fase D) website booking.

import type { PoolClient } from "pg";
import {
  resolveTicketPrice,
  type ProductDateRange,
  type ResolveTicketPriceResult,
  type SeasonKind,
} from "./pricing";

export type { ResolveTicketPriceResult, SeasonKind };

/**
 * Resolve harga satu varian untuk satu tanggal & kanal di dalam transaksi:
 * kalender ticket → musim/blok → harga varian dgn override kanal.
 * `ok: false` → pemanggil WAJIB menolak, jangan menebak harga.
 */
export async function resolveVariantPriceOnDate(
  client: PoolClient,
  input: {
    companyId: string;
    branchId: string;
    variantId: string;
    channelId: string;
    visitDate: string;
  }
): Promise<
  | (ResolveTicketPriceResult & { ok: true; ticketProductId: string })
  | (ResolveTicketPriceResult & { ok: false })
> {
  const variantResult = await client.query<{
    ticket_product_id: string;
    price_regular: string | null;
    price_high: string | null;
  }>(
    `SELECT v.ticket_product_id, v.price_regular, v.price_high
     FROM ticketing.ticket_product_variants v
     WHERE v.id = $1 AND v.branch_id = $2 AND v.company_id = $3
       AND v.is_active = true`,
    [input.variantId, input.branchId, input.companyId]
  );
  const variant = variantResult.rows[0];
  if (!variant) {
    return { ok: false, reason: "harga-belum-diisi" };
  }

  const [datesResult, channelResult, overrideResult] = await Promise.all([
    client.query<ProductDateRange>(
      `SELECT date_kind, start_date::text AS start_date,
              end_date::text AS end_date, is_active
       FROM ticketing.ticket_product_dates
       WHERE ticket_product_id = $1`,
      [variant.ticket_product_id]
    ),
    client.query<{ is_online: boolean }>(
      `SELECT is_online FROM ticketing.ticket_channels
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [input.channelId, input.branchId, input.companyId]
    ),
    client.query<{ price_regular: string | null; price_high: string | null }>(
      `SELECT price_regular, price_high
       FROM ticketing.ticket_variant_channel_prices
       WHERE variant_id = $1 AND channel_id = $2`,
      [input.variantId, input.channelId]
    ),
  ]);

  const toPair = (row?: {
    price_regular: string | null;
    price_high: string | null;
  }) =>
    row
      ? {
          price_regular:
            row.price_regular === null ? null : Number(row.price_regular),
          price_high: row.price_high === null ? null : Number(row.price_high),
        }
      : null;

  const result = resolveTicketPrice({
    visitDate: input.visitDate,
    isOnlineChannel: channelResult.rows[0]?.is_online ?? false,
    dates: datesResult.rows,
    variant: toPair(variant)!,
    channelOverride: toPair(overrideResult.rows[0]),
  });

  if (!result.ok) return result;
  return { ...result, ticketProductId: variant.ticket_product_id };
}
