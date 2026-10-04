import { z } from "zod";
import type { PoolClient } from "pg";
import { formatDateLong, formatNumber, formatRupiah } from "@/lib/format";
import { isValidCalendarDate } from "./server";

// Batas selaras presisi kolom numeric(14,2) — line_total maks 12 digit
const MAX_LINE_TOTAL = 999_999_999_999;

export const QUOTATION_STATUSES = [
  "draft",
  "terkirim",
  "diterima",
  "ditolak",
] as const;

export const quotationItemSchema = z
  .object({
    item_type: z.enum(["produk", "bebas"]).default("bebas"),
    product_id: z.string().uuid().optional().nullable(),
    description: z.string().trim().min(1).max(300),
    qty: z.number().positive().max(100_000),
    unit_price: z.number().min(0).max(999_999_999),
  })
  .refine((v) => v.item_type !== "produk" || Boolean(v.product_id), {
    message: "Baris produk wajib memilih produk katalog",
  })
  .refine((v) => v.qty * v.unit_price <= MAX_LINE_TOTAL, {
    message: "Jumlah baris melebihi batas nilai (12 digit)",
  });

// Fase G — termin pembayaran: persentase dari total quotation. Boleh
// kosong (tanpa termin); bila diisi, Σ persen WAJIB 100 (toleransi 0.01
// utk pecahan 33.33+33.33+33.34).
export const quotationTermSchema = z.object({
  label: z.string().trim().min(1).max(100),
  percent: z.number().gt(0).max(100),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isValidCalendarDate, { message: "Tanggal tidak valid" })
    .optional()
    .nullable()
    .or(z.literal("")),
});

export const quotationPayloadSchema = z.object({
  use_ppn: z.boolean().default(true),
  ppn_persen: z.number().min(0).max(100).default(11),
  // EPIC-050 Fase 2: diskon header (% dari subtotal) — > ambang butuh approval
  discount_percent: z.number().min(0).max(100).default(0),
  notes: z.string().trim().max(2000).optional().nullable(),
  valid_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isValidCalendarDate, { message: "Tanggal tidak valid" })
    .optional()
    .nullable()
    .or(z.literal("")),
  items: z.array(quotationItemSchema).min(1).max(100),
  terms: z
    .array(quotationTermSchema)
    .max(12)
    .default([])
    .refine(
      (terms) =>
        terms.length === 0 ||
        Math.abs(terms.reduce((sum, t) => sum + t.percent, 0) - 100) <= 0.01,
      { message: "Total persentase termin harus tepat 100%" }
    ),
});

export type QuotationPayload = z.infer<typeof quotationPayloadSchema>;

/** Hitung total server-side — jangan pernah percaya angka dari klien.
 *  Diskon dihitung dari subtotal; PPN dari DPP (subtotal − diskon). */
export function computeTotals(payload: QuotationPayload): {
  subtotal: number;
  discountNominal: number;
  ppnNominal: number;
  total: number;
  lines: Array<QuotationPayload["items"][number] & { line_total: number }>;
} {
  const lines = payload.items.map((item) => ({
    ...item,
    line_total: Math.round(item.qty * item.unit_price * 100) / 100,
  }));
  const subtotal =
    Math.round(lines.reduce((acc, line) => acc + line.line_total, 0) * 100) / 100;
  const pct = Math.min(100, Math.max(0, payload.discount_percent ?? 0));
  const discountNominal = Math.round(subtotal * pct) / 100;
  const dpp = Math.round((subtotal - discountNominal) * 100) / 100;
  const ppnNominal = payload.use_ppn
    ? Math.round(dpp * payload.ppn_persen) / 100
    : 0;
  const total = Math.round((dpp + ppnNominal) * 100) / 100;
  return { subtotal, discountNominal, ppnNominal, total, lines };
}

export async function validateProducts(
  client: PoolClient,
  payload: QuotationPayload
): Promise<string | null> {
  const productIds = [
    ...new Set(
      payload.items
        .filter((item) => item.item_type === "produk" && item.product_id)
        .map((item) => item.product_id as string)
    ),
  ];
  if (productIds.length === 0) return null;
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM pos.pos_products
     WHERE id = ANY($1::uuid[]) AND is_active = true`,
    [productIds]
  );
  if (rows.length !== productIds.length) {
    return "Ada produk yang tidak ditemukan atau nonaktif di katalog";
  }
  return null;
}

/** Sisipkan baris termin (dipanggil dalam transaksi; replace-all saat edit). */
export async function insertTerms(
  client: PoolClient,
  quotationId: string,
  terms: QuotationPayload["terms"]
): Promise<void> {
  if (terms.length === 0) return;
  const values: unknown[] = [];
  const rows = terms.map((term, index) => {
    values.push(quotationId, term.label, term.percent, term.due_date || null, index);
    const base = index * 5;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });
  await client.query(
    `INSERT INTO crm.crm_sales_quotation_terms
       (quotation_id, label, percent, due_date, sort_order)
     VALUES ${rows.join(", ")}`,
    values
  );
}

/**
 * Alokasi nominal termin dari total × persen — pembulatan KUMULATIF 2dp:
 * Σ nominal selalu tepat = total (pola allocateBundlePrice ticketing),
 * tidak ada selisih sen yang membuat pelunasan tak pernah "lunas".
 */
export function allocateTermAmounts(total: number, percents: number[]): number[] {
  if (percents.length === 0) return [];
  const amounts: number[] = [];
  let cumTarget = 0;
  let cumAssigned = 0;
  let cumPercent = 0;
  for (let i = 0; i < percents.length; i++) {
    cumPercent += percents[i];
    cumTarget =
      i === percents.length - 1
        ? Math.round(total * 100) / 100
        : Math.round(((total * cumPercent) / 100) * 100) / 100;
    const amount = Math.round((cumTarget - cumAssigned) * 100) / 100;
    amounts.push(amount);
    cumAssigned = Math.round((cumAssigned + amount) * 100) / 100;
  }
  return amounts;
}

export interface TermProgress {
  label: string;
  due_date: string | null;
  percent: number;
  amount: number;
  paid: number;
  status: "lunas" | "sebagian" | "belum";
}

/**
 * Progress per termin dari total pembayaran (waterfall): pembayaran mengisi
 * termin berurutan — pencatatan tetap sederhana (nominal bebas), status per
 * termin diturunkan, bukan dipilih manual kasir.
 */
export function termProgress(
  terms: { label: string; due_date: string | null; percent: number }[],
  total: number,
  paidTotal: number
): TermProgress[] {
  const amounts = allocateTermAmounts(
    total,
    terms.map((t) => t.percent)
  );
  let remaining = Math.round(paidTotal * 100) / 100;
  return terms.map((term, i) => {
    const amount = amounts[i];
    const paid = Math.round(Math.min(amount, Math.max(0, remaining)) * 100) / 100;
    remaining = Math.round((remaining - paid) * 100) / 100;
    return {
      label: term.label,
      due_date: term.due_date,
      percent: term.percent,
      amount,
      paid,
      status: paid >= amount && amount > 0 ? "lunas" : paid > 0 ? "sebagian" : "belum",
    };
  });
}

/** Sisipkan semua baris item dalam SATU pernyataan (dipanggil dalam transaksi). */
export async function insertItems(
  client: PoolClient,
  quotationId: string,
  lines: ReturnType<typeof computeTotals>["lines"]
): Promise<void> {
  if (lines.length === 0) return;
  const values: unknown[] = [];
  const rows = lines.map((line, index) => {
    values.push(
      quotationId,
      line.item_type,
      line.item_type === "produk" ? line.product_id : null,
      line.description,
      line.qty,
      line.unit_price,
      line.line_total,
      index
    );
    const base = index * 8;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
  });
  await client.query(
    `INSERT INTO crm.crm_sales_quotation_items
       (quotation_id, item_type, product_id, description, qty,
        unit_price, line_total, sort_order)
     VALUES ${rows.join(", ")}`,
    values
  );
}

export interface QuotationWaSummary {
  quote_number: string;
  branch_name: string | null;
  pic_name: string;
  deal_title: string;
  org_name: string;
  use_ppn: boolean;
  ppn_persen: string | number;
  subtotal: string | number;
  ppn_nominal: string | number;
  total: string | number;
  event_date: string | null;
  valid_until: string | null;
  notes: string | null;
}

/** Ringkasan penawaran sebagai teks WA ke PIC (EPIC-022 Fase F2, keputusan owner #4). */
export function buildQuotationWaMessage(
  quotation: QuotationWaSummary,
  items: Array<{ description: string; item_type: string; qty: string | number; unit_price: string | number; line_total: string | number }>
): string {
  const lines = [
    `*PENAWARAN ${quotation.quote_number}*`,
    quotation.branch_name ? `_${quotation.branch_name}_` : null,
    ``,
    `Halo ${quotation.pic_name}, berikut ringkasan penawaran untuk *${quotation.deal_title}* (${quotation.org_name}):`,
    ``,
    ...items.map((item) => {
      const unit = item.item_type === "produk" ? " pax" : "x";
      return `• ${item.description} — ${formatNumber(item.qty, 3)}${unit} @ ${formatRupiah(item.unit_price)} = *${formatRupiah(item.line_total)}*`;
    }),
    ``,
    `Subtotal: ${formatRupiah(quotation.subtotal)}`,
    quotation.use_ppn ? `PPN ${Number(quotation.ppn_persen)}%: ${formatRupiah(quotation.ppn_nominal)}` : null,
    `*TOTAL: ${formatRupiah(quotation.total)}*`,
    ``,
    quotation.event_date ? `Tanggal acara: ${formatDateLong(quotation.event_date)}` : null,
    quotation.valid_until ? `Penawaran berlaku s.d. ${formatDateLong(quotation.valid_until)}` : null,
    quotation.notes ? `Catatan: ${quotation.notes}` : null,
    ``,
    `Bila sudah sesuai, mohon konfirmasinya ya 🙏`,
  ];
  return lines.filter((line) => line !== null).join("\n");
}
