import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { canReleaseQuotation, type ApprovalStatus } from "@/lib/crm/approvals";
import { syncQuotationApproval } from "@/lib/crm/approvals-server";
import { emitCrmEvent } from "@/lib/crm/events";
import { query, queryOne, withTransaction } from "@/lib/db";
import { formatRupiah } from "@/lib/format";
import { requireDealChildAccess, type AccessibleDeal } from "./access";
import { assertWaCooldown, requireWaGateway, sendWaText } from "./deals-server";
import { EVENT_TYPE_DOC_LABELS } from "./deals";
import { buildQuotationPdf, quotationFileName, type QuotationPdfItem } from "./quotation-pdf";
import {
  QUOTATION_STATUSES,
  allocateTermAmounts,
  buildQuotationWaMessage,
  computeTotals,
  insertItems,
  insertTerms,
  quotationPayloadSchema,
  validateProducts,
  type QuotationPayload,
} from "./quotations";
import { findShortfalls, planDeductions, type Shortfall } from "./realization";
import { requireValidPhone, type SalesFunnelUser } from "./server";

/** Akses quotation mengikuti deal induknya (404 tidak ada, 403 deal tak terjangkau). */
export async function requireAccessibleQuotation(id: string, user: SalesFunnelUser) {
  const row = await queryOne<{
    id: string;
    deal_id: string;
    company_id: string;
    branch_id: string;
    status: string;
    stock_deducted_at: string | null;
    parent_quotation_id: string | null;
  }>(
    `SELECT id, deal_id, status, stock_deducted_at, company_id, branch_id, parent_quotation_id
     FROM crm.crm_sales_quotations WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return requireDealChildAccess(row, user, "Quotation tidak ditemukan");
}

/** Satu sumber nomor QT-YYMM-NNNN. */
const QUOTE_NUMBER_SQL = `'QT-' || to_char(now(), 'YYMM') || '-' || lpad(nextval('crm.crm_sales_quotation_number_seq')::text, 4, '0')`;

const syncApproval = (quotationId: string, userId: string) =>
  syncQuotationApproval(quotationId, userId).catch((e) => console.error("[crm-approval] sync gagal:", e));

/** Error produk katalog dari validateProducts dilempar sebagai 400. */
async function assertProducts(client: Parameters<typeof validateProducts>[0], payload: QuotationPayload) {
  const productError = await validateProducts(client, payload);
  if (productError) throw ApiError.badRequest(productError);
}

/** Daftar quotation sebuah deal + item & termin (EPIC-022 Fase F1). */
export async function listDealQuotations(dealId: string) {
  return query(
    `SELECT q.id, q.quote_number, q.status, q.use_ppn, q.ppn_persen,
            q.subtotal, q.ppn_nominal, q.total, q.notes, q.valid_until,
            q.discount_percent, q.discount_nominal, q.approval_status, q.approval_request_id,
            q.version, q.parent_quotation_id, q.superseded_at,
            q.stock_deducted_at, q.bom_status, q.created_at,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'id', i.id, 'item_type', i.item_type,
                 'product_id', i.product_id, 'description', i.description,
                 'qty', i.qty, 'unit_price', i.unit_price,
                 'line_total', i.line_total
               ) ORDER BY i.sort_order)
               FROM crm.crm_sales_quotation_items i
               WHERE i.quotation_id = q.id),
              '[]'::json
            ) AS items,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'id', t.id, 'label', t.label, 'percent', t.percent,
                 'due_date', t.due_date
               ) ORDER BY t.sort_order)
               FROM crm.crm_sales_quotation_terms t
               WHERE t.quotation_id = q.id),
              '[]'::json
            ) AS terms
     FROM crm.crm_sales_quotations q
     WHERE q.deal_id = $1 AND q.deleted_at IS NULL
     ORDER BY q.created_at DESC
     LIMIT 20`,
    [dealId]
  );
}

/** Buat quotation baru — total dihitung server, item dalam satu transaksi. */
export async function createQuotation(user: SalesFunnelUser, deal: AccessibleDeal, payload: QuotationPayload) {
  const { subtotal, discountNominal, ppnNominal, total, lines } = computeTotals(payload);
  const row = await withTransaction(async (client) => {
    await assertProducts(client, payload);
    const inserted = await client.query<{ id: string; quote_number: string; total: string }>(
      `INSERT INTO crm.crm_sales_quotations
         (company_id, branch_id, deal_id, quote_number, use_ppn,
          ppn_persen, subtotal, ppn_nominal, total, notes, valid_until,
          created_by, discount_percent, discount_nominal)
       VALUES ($1, $2, $3, ${QUOTE_NUMBER_SQL}, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, quote_number, total`,
      [
        deal.company_id,
        deal.branch_id,
        deal.id,
        payload.use_ppn,
        payload.ppn_persen,
        subtotal,
        ppnNominal,
        total,
        payload.notes || null,
        payload.valid_until || null,
        user.id,
        payload.discount_percent ?? 0,
        discountNominal,
      ]
    );
    const quotation = inserted.rows[0];
    await insertItems(client, quotation.id, lines);
    await insertTerms(client, quotation.id, payload.terms);
    // Total penawaran = estimasi nilai deal berjalan
    await client.query(
      `UPDATE crm.crm_sales_deals SET value_estimate = $1, updated_at = now() WHERE id = $2 AND closed_at IS NULL`,
      [total, deal.id]
    );
    return quotation;
  });

  // EPIC-050 Fase 2: approval diskon + event bus
  await syncApproval(row.id, user.id);
  await emitCrmEvent({
    event_type: "quotation.created",
    subject_type: "quotation",
    subject_id: row.id,
    company_id: deal.company_id,
    branch_id: deal.branch_id,
    actor_user_id: user.id,
    payload: { total, discount_percent: payload.discount_percent ?? 0 },
  });
  return row;
}

export const updateQuotationSchema = z.object({
  status: z.enum(QUOTATION_STATUSES).optional(),
  payload: quotationPayloadSchema.optional(),
});

const FROZEN = "Quotation sudah direalisasi — isi tidak bisa diubah";

function releaseBlockedMessage(approvalStatus: ApprovalStatus, action: string): string {
  return approvalStatus === "pending"
    ? `Quotation menunggu approval diskon — belum boleh ${action}`
    : "Approval diskon quotation DITOLAK — ubah diskon lalu ajukan lagi";
}

export async function updateQuotation(
  user: SalesFunnelUser,
  quotation: Awaited<ReturnType<typeof requireAccessibleQuotation>>["row"],
  { status, payload }: z.infer<typeof updateQuotationSchema>
) {
  if (!status && !payload) throw ApiError.badRequest("Tidak ada field yang diubah");
  // Quotation yang sudah direalisasikan stoknya (F3) dibekukan
  if (payload && quotation.stock_deducted_at) throw ApiError.conflict(FROZEN);
  const id = quotation.id;

  const row = await withTransaction(async (client) => {
    if (payload) {
      await assertProducts(client, payload);
      const { subtotal, discountNominal, ppnNominal, total, lines } = computeTotals(payload);
      // Guard beku DI DALAM tulis — menutup race dengan tombol Realisasi F3
      const updated = await client.query(
        `UPDATE crm.crm_sales_quotations
         SET use_ppn = $1, ppn_persen = $2, subtotal = $3,
             ppn_nominal = $4, total = $5, notes = $6,
             valid_until = $7, discount_percent = $9, discount_nominal = $10,
             updated_at = now()
         WHERE id = $8 AND stock_deducted_at IS NULL`,
        [
          payload.use_ppn,
          payload.ppn_persen,
          subtotal,
          ppnNominal,
          total,
          payload.notes || null,
          payload.valid_until || null,
          id,
          payload.discount_percent ?? 0,
          discountNominal,
        ]
      );
      if (updated.rowCount === 0) throw ApiError.conflict(FROZEN);
      await client.query(`DELETE FROM crm.crm_sales_quotation_items WHERE quotation_id = $1`, [id]);
      await insertItems(client, id, lines);
      await client.query(`DELETE FROM crm.crm_sales_quotation_terms WHERE quotation_id = $1`, [id]);
      await insertTerms(client, id, payload.terms);
      // Estimasi deal mengikuti quotation terbaru selama deal berjalan
      await client.query(
        `UPDATE crm.crm_sales_deals SET value_estimate = $1, updated_at = now() WHERE id = $2 AND closed_at IS NULL`,
        [total, quotation.deal_id]
      );
    }
    if (status) {
      // EPIC-050 Fase 2: diskon > ambang wajib disetujui sebelum dikirim/diterima
      if (status === "terkirim" || status === "diterima") {
        const gate = await client.query<{ approval_status: ApprovalStatus | null }>(
          `SELECT approval_status FROM crm.crm_sales_quotations WHERE id = $1`,
          [id]
        );
        const approvalStatus = gate.rows[0]?.approval_status ?? "none";
        if (!canReleaseQuotation(approvalStatus)) {
          throw ApiError.conflict(releaseBlockedMessage(approvalStatus, "dikirim/diterima"));
        }
      }
      await client.query(`UPDATE crm.crm_sales_quotations SET status = $1, updated_at = now() WHERE id = $2`, [status, id]);
      // Quotation diterima = angka kesepakatan — estimasi deal ikut
      if (status === "diterima") {
        await client.query(
          `UPDATE crm.crm_sales_deals d
           SET value_estimate = q.total, updated_at = now()
           FROM crm.crm_sales_quotations q
           WHERE q.id = $1 AND d.id = q.deal_id AND d.closed_at IS NULL`,
          [id]
        );
      }
    }
    const result = await client.query(`SELECT id, quote_number, status, total FROM crm.crm_sales_quotations WHERE id = $1`, [id]);
    return result.rows[0];
  });

  if (payload) await syncApproval(id, user.id);
  await emitCrmEvent({
    event_type: status ? "quotation.status_changed" : "quotation.updated",
    subject_type: "quotation",
    subject_id: id,
    company_id: quotation.company_id,
    branch_id: quotation.branch_id,
    actor_user_id: user.id,
    payload: { status: status ?? null },
  });
  return row;
}

/**
 * Hapus (soft) quotation yang belum direalisasi. Guard beku di dalam tulis
 * (anti-TOCTOU F3); estimasi deal dihitung ulang dari quotation tersisa terbaru.
 */
export async function deleteQuotation(quotation: { id: string; deal_id: string; stock_deducted_at: string | null }) {
  const frozen = "Quotation sudah direalisasi — tidak bisa dihapus";
  if (quotation.stock_deducted_at) throw ApiError.conflict(frozen);
  const deleted = await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE crm.crm_sales_quotations
       SET deleted_at = now(), updated_at = now()
       WHERE id = $1 AND stock_deducted_at IS NULL RETURNING id, deal_id`,
      [quotation.id]
    );
    if (result.rowCount === 0) return false;
    await client.query(
      `UPDATE crm.crm_sales_deals d
       SET value_estimate = (
             SELECT q.total FROM crm.crm_sales_quotations q
             WHERE q.deal_id = d.id AND q.deleted_at IS NULL
             ORDER BY q.created_at DESC LIMIT 1
           ),
           updated_at = now()
       WHERE d.id = $1 AND d.closed_at IS NULL`,
      [quotation.deal_id]
    );
    return true;
  });
  if (!deleted) throw ApiError.conflict(frozen);
}

/**
 * EPIC-050 T-3.4 — versi baru: salin header/item/termin sebagai draft v+1
 * (nomor baru); versi lama jadi `superseded` kecuali sudah direalisasi.
 */
export async function reviseQuotation(
  user: SalesFunnelUser,
  deal: AccessibleDeal,
  src: { id: string; status: string; parent_quotation_id: string | null; stock_deducted_at: string | null }
) {
  const sourceId = src.id;
  if (src.status === "superseded") {
    throw ApiError.conflict("Versi ini sudah digantikan — buat revisi dari versi terbaru");
  }
  const rootId = src.parent_quotation_id ?? sourceId;
  const row = await withTransaction(async (client) => {
    const latest = await client.query<{ v: number }>(
      `SELECT COALESCE(max(version), 1) AS v FROM crm.crm_sales_quotations WHERE (id = $1 OR parent_quotation_id = $1) AND deleted_at IS NULL`,
      [rootId]
    );
    const nextVersion = Number(latest.rows[0]?.v ?? 1) + 1;
    const inserted = await client.query<{ id: string; quote_number: string; version: number }>(
      `INSERT INTO crm.crm_sales_quotations
         (company_id, branch_id, deal_id, quote_number, use_ppn, ppn_persen, subtotal, ppn_nominal, total,
          notes, valid_until, created_by, discount_percent, discount_nominal, version, parent_quotation_id, status)
       SELECT company_id, branch_id, deal_id, ${QUOTE_NUMBER_SQL},
              use_ppn, ppn_persen, subtotal, ppn_nominal, total, notes, valid_until, $2, discount_percent, discount_nominal,
              $3, $4, 'draft'
       FROM crm.crm_sales_quotations WHERE id = $1
       RETURNING id, quote_number, version`,
      [sourceId, user.id, nextVersion, rootId]
    );
    const q = inserted.rows[0];
    await client.query(
      `INSERT INTO crm.crm_sales_quotation_items (quotation_id, item_type, product_id, description, qty, unit_price, line_total, sort_order)
       SELECT $2, item_type, product_id, description, qty, unit_price, line_total, sort_order
       FROM crm.crm_sales_quotation_items WHERE quotation_id = $1`,
      [sourceId, q.id]
    );
    await client.query(
      `INSERT INTO crm.crm_sales_quotation_terms (quotation_id, label, percent, due_date, sort_order)
       SELECT $2, label, percent, due_date, sort_order FROM crm.crm_sales_quotation_terms WHERE quotation_id = $1`,
      [sourceId, q.id]
    );
    // versi lama → superseded (kecuali sudah direalisasi: biarkan statusnya)
    if (!src.stock_deducted_at) {
      await client.query(
        `UPDATE crm.crm_sales_quotations SET status = 'superseded', superseded_at = now(), updated_at = now() WHERE id = $1`,
        [sourceId]
      );
    }
    return q;
  });
  await syncApproval(row.id, user.id);
  await emitCrmEvent({
    event_type: "quotation.created",
    subject_type: "quotation",
    subject_id: row.id,
    company_id: deal.company_id,
    branch_id: deal.branch_id,
    actor_user_id: user.id,
    payload: { revised_from: sourceId, version: row.version },
  });
  return row;
}

// ── Realisasi stok (Fase F3) ──

export const realizeSchema = z.object({
  // Stok kurang → boleh lanjut TANPA memotong BOM (bom_status 'tidak-terpotong')
  force_skip_bom: z.boolean().default(false),
});

type Shortage = Shortfall & { kode: string | null; nama: string; satuan: string | null };

/** 409 pembawa detail kekurangan stok di level atas body (dibaca realize-dialog). */
export class InsufficientStockError extends ApiError {
  constructor(
    public shortages: Shortage[],
    public warnings: string[]
  ) {
    super(409, "Stok bahan baku tidak mencukupi");
  }

  override toResponse() {
    return NextResponse.json(
      { success: false, error: this.message, shortages: this.shortages, warnings: this.warnings },
      { status: this.status }
    );
  }
}

/**
 * Hitung kebutuhan bahan dari resep (qty pax × resep × waste), kunci stok
 * gudang venue (FOR UPDATE, urut id agar tidak deadlock), potong via
 * inventory_movements 'out', lalu bekukan quotation. Idempoten: quotation
 * dikunci FOR UPDATE dan hanya bisa direalisasi sekali.
 */
export async function realizeQuotation(
  user: SalesFunnelUser,
  quotationId: string,
  branchId: string,
  forceSkipBom: boolean
) {
  return withTransaction(async (client) => {
    const locked = await client.query<{ status: string; stock_deducted_at: string | null; quote_number: string }>(
      `SELECT status, stock_deducted_at, quote_number
       FROM crm.crm_sales_quotations
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [quotationId]
    );
    const quotation = locked.rows[0];
    if (!quotation) throw ApiError.conflict("Quotation tidak ditemukan");
    if (quotation.stock_deducted_at) throw ApiError.conflict("Quotation sudah direalisasi sebelumnya");
    if (quotation.status !== "diterima") {
      throw ApiError.conflict("Hanya quotation berstatus Diterima yang bisa direalisasi");
    }

    const requirementRows = await client.query<{ raw_material_id: string; needed: string }>(
      `SELECT r.raw_material_id,
              SUM(i.qty * r.quantity_per_unit * (1 + COALESCE(r.waste_percentage, 0) / 100)) AS needed
       FROM crm.crm_sales_quotation_items i
       JOIN pos.pos_recipes r ON r.product_id = i.product_id AND r.is_active = true
       WHERE i.quotation_id = $1 AND i.item_type = 'produk'
       GROUP BY r.raw_material_id`,
      [quotationId]
    );
    const requirements = requirementRows.rows.map((r) => ({ raw_material_id: r.raw_material_id, needed: Number(r.needed) }));

    // Produk tanpa resep — peringatan, bukan pemblokir
    const noRecipe = await client.query<{ name: string }>(
      `SELECT DISTINCT p.name
       FROM crm.crm_sales_quotation_items i
       JOIN pos.pos_products p ON p.id = i.product_id
       WHERE i.quotation_id = $1 AND i.item_type = 'produk'
         AND NOT EXISTS (
           SELECT 1 FROM pos.pos_recipes r
           WHERE r.product_id = i.product_id AND r.is_active = true
         )`,
      [quotationId]
    );
    const warnings = noRecipe.rows.map(
      (row) => `Produk "${row.name}" belum punya resep — tidak ada bahan yang dipotong untuknya`
    );

    let bomStatus: "terpotong" | "tidak-terpotong" = "tidak-terpotong";
    let movedCount = 0;
    if (!forceSkipBom) {
      // Tanpa resep sama sekali → wajib konfirmasi eksplisit (force) agar status jujur
      if (requirements.length === 0) {
        throw new InsufficientStockError([], [
          ...warnings,
          "Tidak ada resep produk yang bisa dipotong — lanjutkan tanpa potong BOM?",
        ]);
      }
      // Lock berurutan DETERMINISTIK by id (temuan HIGH gate F3: deadlock);
      // urutan "gudang terbesar dulu" diterapkan di aplikasi setelah terkunci.
      const stockRows = await client.query<{ id: string; raw_material_id: string; warehouse_id: string | null; qty_available: string }>(
        `SELECT id, raw_material_id, warehouse_id, qty_available
         FROM inventory.inventory
         WHERE raw_material_id = ANY($1::uuid[])
           AND branch_id = $2 AND is_active = true
         ORDER BY id ASC
         FOR UPDATE`,
        [requirements.map((r) => r.raw_material_id), branchId]
      );
      const stock = stockRows.rows.map((row) => ({ ...row, qty_available: Number(row.qty_available) }));

      const shortfalls = findShortfalls(requirements, stock);
      if (shortfalls.length > 0) {
        const shortages: Shortage[] = [];
        for (const shortfall of shortfalls) {
          const info = await client.query<{ kode: string | null; nama: string; satuan: string | null }>(
            `SELECT rm.kode, rm.nama, u.nama AS satuan
             FROM item.raw_materials rm
             LEFT JOIN item.units u ON u.id = rm.satuan_kecil_id
             WHERE rm.id = $1`,
            [shortfall.raw_material_id]
          );
          shortages.push({
            ...shortfall,
            kode: info.rows[0]?.kode ?? null,
            nama: info.rows[0]?.nama ?? shortfall.raw_material_id,
            satuan: info.rows[0]?.satuan ?? null,
          });
        }
        throw new InsufficientStockError(shortages, warnings);
      }

      // Ledger qty_before/after per movement — pola adjustment purchasing
      for (const step of planDeductions(requirements, stock)) {
        await client.query(
          `UPDATE inventory.inventory
           SET qty_available = $1, last_movement_at = now(), updated_at = now(), updated_by = $2
           WHERE id = $3`,
          [step.after, user.id, step.inventory_id]
        );
        await client.query(
          `INSERT INTO inventory.inventory_movements
             (inventory_id, raw_material_id, tipe, jumlah, qty_before,
              qty_after, reference_type, reference_id, reference_number,
              alasan, created_by, branch_id, warehouse_id)
           VALUES ($1, $2, 'out', $3, $4, $5, 'sales_realization', $6, $7, $8, $9, $10, $11)`,
          [
            step.inventory_id,
            step.raw_material_id,
            step.take,
            step.before,
            step.after,
            quotationId,
            quotation.quote_number,
            `Realisasi quotation ${quotation.quote_number}`,
            user.id,
            branchId,
            step.warehouse_id,
          ]
        );
        movedCount += 1;
      }
      bomStatus = "terpotong";
    }

    await client.query(
      `UPDATE crm.crm_sales_quotations
       SET stock_deducted_at = now(), bom_status = $1, realized_by = $2, updated_at = now()
       WHERE id = $3`,
      [bomStatus, user.id, quotationId]
    );
    return { bomStatus, movedCount, warnings };
  });
}

// ── Kirim ringkasan quotation via WA (Fase F2) ──

/** Sukses kirim: status draft → terkirim + tercatat sebagai aktivitas `wa`. */
export async function sendQuotationWa(user: SalesFunnelUser, deal: AccessibleDeal, quotationId: string) {
  const quotation = await queryOne<
    Parameters<typeof buildQuotationWaMessage>[0] & {
      deal_id: string;
      status: string;
      pic_phone: string;
      approval_status: ApprovalStatus | null;
    }
  >(
    `SELECT q.deal_id, q.quote_number, q.status, q.use_ppn,
            q.ppn_persen, q.subtotal, q.ppn_nominal, q.total, q.notes,
            q.valid_until, q.approval_status,
            d.title AS deal_title, d.event_date,
            l.org_name, l.pic_name, l.pic_phone, b.name AS branch_name
     FROM crm.crm_sales_quotations q
     JOIN crm.crm_sales_deals d ON d.id = q.deal_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     LEFT JOIN configuration.branches b ON b.id = q.branch_id
     WHERE q.id = $1 AND q.deleted_at IS NULL`,
    [quotationId]
  );
  if (!quotation) throw ApiError.notFound("Quotation tidak ditemukan");
  // EPIC-050 Fase 2: diskon > ambang wajib disetujui sebelum dikirim ke PIC
  const approvalStatus = quotation.approval_status ?? "none";
  if (!canReleaseQuotation(approvalStatus)) {
    throw ApiError.conflict(releaseBlockedMessage(approvalStatus, "dikirim"));
  }
  const config = await requireWaGateway();
  await assertWaCooldown(quotation.deal_id);
  const target = requireValidPhone(quotation.pic_phone, "No. WA PIC tidak valid");

  const items = await query<{ description: string; item_type: string; qty: string; unit_price: string; line_total: string }>(
    `SELECT description, item_type, qty, unit_price, line_total
     FROM crm.crm_sales_quotation_items
     WHERE quotation_id = $1 ORDER BY sort_order ASC`,
    [quotationId]
  );
  const messageId = await sendWaText(config, target, buildQuotationWaMessage(quotation, items));

  // Jejak + transisi status dalam satu transaksi
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO crm.crm_sales_activities
         (company_id, branch_id, deal_id, activity_type, notes, done_at, owner_user_id, created_by)
       VALUES ($1, $2, $3, 'wa', $4, now(), $5, $5)`,
      [
        deal.company_id,
        deal.branch_id,
        deal.id,
        `Kirim quotation ${quotation.quote_number} (${formatRupiah(quotation.total)}) ke ${quotation.pic_name}`,
        user.id,
      ]
    );
    if (quotation.status === "draft") {
      await client.query(
        `UPDATE crm.crm_sales_quotations SET status = 'terkirim', updated_at = now() WHERE id = $1 AND status = 'draft'`,
        [quotationId]
      );
    }
  });
  return { messageId, picName: quotation.pic_name };
}

// ── PDF (Fase F2) ──

export async function renderQuotationPdf(quotationId: string): Promise<{ pdf: Buffer; fileName: string }> {
  const quotation = await queryOne<{
    quote_number: string;
    status: string;
    use_ppn: boolean;
    ppn_persen: string;
    subtotal: string;
    discount_percent: string | null;
    discount_nominal: string | null;
    ppn_nominal: string;
    total: string;
    notes: string | null;
    valid_until: string | null;
    created_at: string;
    deal_title: string;
    event_type: string;
    event_date: string | null;
    org_name: string;
    pic_name: string;
    pic_title: string | null;
    owner_name: string | null;
    company_name: string | null;
    branch_name: string | null;
  }>(
    `SELECT q.quote_number, q.status, q.use_ppn,
            q.ppn_persen, q.subtotal, q.ppn_nominal, q.total, q.notes,
            q.discount_percent, q.discount_nominal,
            q.valid_until, q.created_at,
            d.title AS deal_title, d.event_type, d.event_date,
            l.org_name, l.pic_name, l.pic_title,
            u.full_name AS owner_name,
            c.name AS company_name, b.name AS branch_name
     FROM crm.crm_sales_quotations q
     JOIN crm.crm_sales_deals d ON d.id = q.deal_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     LEFT JOIN configuration.users u ON u.id = d.owner_user_id
     LEFT JOIN configuration.companies c ON c.id = q.company_id
     LEFT JOIN configuration.branches b ON b.id = q.branch_id
     WHERE q.id = $1 AND q.deleted_at IS NULL`,
    [quotationId]
  );
  if (!quotation) throw ApiError.notFound("Quotation tidak ditemukan");

  const [items, terms] = await Promise.all([
    query<{ description: string; item_type: string; qty: string; unit_price: string; line_total: string }>(
      `SELECT description, item_type, qty, unit_price, line_total
       FROM crm.crm_sales_quotation_items
       WHERE quotation_id = $1
       ORDER BY sort_order ASC`,
      [quotationId]
    ),
    query<{ label: string; percent: string; due_date: string | null }>(
      `SELECT label, percent, due_date::text AS due_date
       FROM crm.crm_sales_quotation_terms
       WHERE quotation_id = $1
       ORDER BY sort_order ASC`,
      [quotationId]
    ),
  ]);
  const termAmounts = allocateTermAmounts(Number(quotation.total), terms.map((t) => Number(t.percent)));

  const pdf = await buildQuotationPdf({
    quote_number: quotation.quote_number,
    created_at: quotation.created_at,
    valid_until: quotation.valid_until,
    status: quotation.status,
    company_name: quotation.company_name,
    branch_name: quotation.branch_name,
    org_name: quotation.org_name,
    pic_name: quotation.pic_name,
    pic_title: quotation.pic_title,
    deal_title: quotation.deal_title,
    event_type_label: EVENT_TYPE_DOC_LABELS[quotation.event_type] ?? "Acara",
    event_date: quotation.event_date,
    use_ppn: quotation.use_ppn,
    ppn_persen: Number(quotation.ppn_persen),
    subtotal: Number(quotation.subtotal),
    discount_percent: Number(quotation.discount_percent ?? 0),
    discount_nominal: Number(quotation.discount_nominal ?? 0),
    ppn_nominal: Number(quotation.ppn_nominal),
    total: Number(quotation.total),
    notes: quotation.notes,
    owner_name: quotation.owner_name,
    items: items.map(
      (item): QuotationPdfItem => ({
        description: item.description,
        item_type: item.item_type,
        qty: Number(item.qty),
        unit_price: Number(item.unit_price),
        line_total: Number(item.line_total),
      })
    ),
    terms: terms.map((term, i) => ({
      label: term.label,
      percent: Number(term.percent),
      amount: termAmounts[i],
      due_date: term.due_date,
    })),
  });
  return { pdf, fileName: quotationFileName(quotation.quote_number, quotation.org_name) };
}
