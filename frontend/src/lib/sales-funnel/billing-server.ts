import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireDealChildAccess, type AccessibleDeal } from "./access";
import { derivePaymentStatus, resolveReferenceTotal, roundCents } from "./billing";
import { EVENT_TYPE_DOC_LABELS } from "./deals";
import { buildInvoicePdf, invoiceFileName } from "./invoice-pdf";
import { allocateTermAmounts, termProgress } from "./quotations";
import { isValidCalendarDate, type SalesFunnelUser } from "./server";

/**
 * EPIC-025 (Opsi B): sales/super_admin MENGAJUKAN invoice dari termin
 * quotation acuan; penerbitan/kirim/batal dan pembayaran diproses finance.
 * Status pelunasan diturunkan dari pembayaran.
 */

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidCalendarDate, { message: "Tanggal tidak valid" });

/** Acuan termin: quotation diterima terbaru → quotation terbaru. */
async function loadReferenceQuotation(dealId: string) {
  return queryOne<{ id: string; quote_number: string; status: string; total: string; use_ppn: boolean; ppn_persen: string }>(
    `SELECT id, quote_number, status, total, use_ppn, ppn_persen
     FROM crm.crm_sales_quotations
     WHERE deal_id = $1 AND deleted_at IS NULL
     ORDER BY (status = 'diterima') DESC, created_at DESC
     LIMIT 1`,
    [dealId]
  );
}

async function loadTerms(quotationId: string | undefined) {
  if (!quotationId) return [];
  return query<{ id: string; label: string; percent: string; due_date: string | null }>(
    `SELECT id, label, percent, due_date::text AS due_date
     FROM crm.crm_sales_quotation_terms
     WHERE quotation_id = $1
     ORDER BY sort_order`,
    [quotationId]
  );
}

// ── Invoice per deal ──

export const createInvoiceSchema = z.object({
  term_id: z.string().uuid().optional().nullable(),
  label: z.string().trim().min(1).max(150),
  amount: z.number().positive().max(999_999_999_999),
  due_date: calendarDate.optional().nullable().or(z.literal("")),
  note: z.string().trim().max(300).optional().nullable(),
});

export async function loadDealInvoices(dealId: string) {
  const [invoices, refQuotation] = await Promise.all([
    query<{
      id: string;
      invoice_number: string;
      label: string;
      amount: string;
      due_date: string | null;
      status: string;
      sent_at: string | null;
      note: string | null;
      quotation_id: string | null;
      term_id: string | null;
      quote_number: string | null;
      paid: string;
      created_at: string;
    }>(
      `SELECT i.id, i.invoice_number, i.label, i.amount,
              i.due_date::text AS due_date, i.status, i.sent_at, i.note,
              i.quotation_id, i.term_id, q.quote_number,
              COALESCE(
                (SELECT SUM(p.amount) FROM crm.crm_sales_deal_payments p
                 WHERE p.invoice_id = i.id AND p.deleted_at IS NULL),
                0
              ) AS paid,
              i.created_at
       FROM crm.crm_sales_invoices i
       LEFT JOIN crm.crm_sales_quotations q ON q.id = i.quotation_id
       WHERE i.deal_id = $1 AND i.deleted_at IS NULL
       ORDER BY i.created_at DESC
       LIMIT 50`,
      [dealId]
    ),
    loadReferenceQuotation(dealId),
  ]);
  const terms = await loadTerms(refQuotation?.id);
  const amounts = allocateTermAmounts(refQuotation ? Number(refQuotation.total) : 0, terms.map((t) => Number(t.percent)));
  const invoicedTermIds = new Set(
    invoices.filter((inv) => inv.term_id && inv.status !== "batal").map((inv) => inv.term_id as string)
  );

  return {
    invoices: invoices.map((inv) => {
      const amount = Number(inv.amount);
      const paid = Number(inv.paid);
      return { ...inv, amount, paid, payment_status: derivePaymentStatus(paid, amount) };
    }),
    reference: refQuotation
      ? {
          quotation_id: refQuotation.id,
          quote_number: refQuotation.quote_number,
          is_accepted: refQuotation.status === "diterima",
          total: Number(refQuotation.total),
          // PPN invoice mengikuti setelan quotation acuan
          use_ppn: refQuotation.use_ppn,
          ppn_persen: Number(refQuotation.ppn_persen),
        }
      : null,
    available_terms: terms.map((term, index) => ({
      term_id: term.id,
      label: term.label,
      percent: Number(term.percent),
      amount: amounts[index],
      due_date: term.due_date,
      invoiced: invoicedTermIds.has(term.id),
    })),
  };
}

export async function createInvoice(user: SalesFunnelUser, deal: AccessibleDeal, body: z.infer<typeof createInvoiceSchema>) {
  // Termin harus milik quotation deal ini; satu termin satu invoice aktif
  let quotationId: string | null = null;
  if (body.term_id) {
    const term = await queryOne<{ quotation_id: string }>(
      `SELECT t.quotation_id
       FROM crm.crm_sales_quotation_terms t
       JOIN crm.crm_sales_quotations q ON q.id = t.quotation_id
       WHERE t.id = $1 AND q.deal_id = $2 AND q.deleted_at IS NULL`,
      [body.term_id, deal.id]
    );
    if (!term) throw ApiError.badRequest("Termin tidak ditemukan pada quotation deal ini");
    quotationId = term.quotation_id;
  }
  try {
    return await queryOne<{ id: string; invoice_number: string }>(
      `INSERT INTO crm.crm_sales_invoices
         (company_id, branch_id, deal_id, quotation_id, term_id,
          invoice_number, label, amount, due_date, note, created_by, status)
       VALUES ($1, $2, $3, $4, $5,
               'INV-' || to_char(now(), 'YYMM') || '-' ||
                 lpad(nextval('crm.crm_sales_invoice_number_seq')::text, 4, '0'),
               $6, $7, $8, $9, $10, 'diajukan')
       RETURNING id, invoice_number`,
      [
        deal.company_id,
        deal.branch_id,
        deal.id,
        quotationId,
        body.term_id || null,
        body.label,
        roundCents(body.amount),
        body.due_date || null,
        body.note || null,
        user.id,
      ]
    );
  } catch (err) {
    // Index unik uq_crm_sales_invoices_term_active — termin sudah ber-invoice
    if (err instanceof Error && err.message.includes("uq_crm_sales_invoices_term_active")) {
      throw ApiError.conflict("Termin ini sudah memiliki invoice aktif");
    }
    throw err;
  }
}

// ── Satu invoice (akses lewat deal induk) ──

export async function requireAccessibleInvoice(id: string, user: SalesFunnelUser) {
  const row = await queryOne<{ id: string; deal_id: string; status: string; paid: string }>(
    `SELECT i.id, i.deal_id, i.status,
            COALESCE(
              (SELECT SUM(p.amount) FROM crm.crm_sales_deal_payments p
               WHERE p.invoice_id = i.id AND p.deleted_at IS NULL),
              0
            ) AS paid
     FROM crm.crm_sales_invoices i
     WHERE i.id = $1 AND i.deleted_at IS NULL`,
    [id]
  );
  return (await requireDealChildAccess(row, user, "Invoice tidak ditemukan")).row;
}

export const updateInvoiceSchema = z.object({ status: z.enum(["terkirim", "batal"]) });

/** Diajukan/draft → terkirim (terbit + buat AR), atau batal. */
export async function updateInvoiceStatus(
  user: SalesFunnelUser,
  invoice: { id: string; paid: string },
  status: z.infer<typeof updateInvoiceSchema>["status"]
): Promise<{ row: { id: string; invoice_number: string; status: string } | null; message: string }> {
  // Invoice berpembayaran tidak boleh dibatalkan — koreksi pembayarannya dulu
  if (status === "batal" && Number(invoice.paid) > 0) {
    throw ApiError.conflict("Invoice sudah menerima pembayaran — tidak bisa dibatalkan");
  }
  const row = await queryOne<{ id: string; invoice_number: string; status: string }>(
    // status dikirim DUA kali ($1 & $2): satu parameter untuk kolom varchar +
    // perbandingan text membuat Postgres gagal mendeduksi tipe (42P08)
    `UPDATE crm.crm_sales_invoices
     SET status = $1,
         sent_at = CASE WHEN $2::text = 'terkirim' AND sent_at IS NULL THEN now() ELSE sent_at END,
         updated_at = now()
     WHERE id = $3
     RETURNING id, invoice_number, status`,
    [status, status, invoice.id]
  );

  let accountingNote: string | null = null;
  if (status === "terkirim" && row) {
    try {
      const { createArInvoiceFromSalesInvoice } = await import("@/lib/accounting/ar-store");
      const ar = await createArInvoiceFromSalesInvoice({ salesInvoiceId: invoice.id, userId: user.id });
      accountingNote = ar.note ? `AR ${ar.invoice.invoice_no} (${ar.note})` : `AR ${ar.invoice.invoice_no}`;
    } catch (arErr) {
      console.error("[sales-funnel] create AR invoice:", arErr);
      accountingNote = arErr instanceof Error ? `AR gagal: ${arErr.message}` : "AR gagal dibuat";
    }
  }
  return { row, message: accountingNote ? `Invoice diperbarui (${accountingNote})` : "Invoice diperbarui" };
}

export async function deleteInvoice(user: SalesFunnelUser, invoice: { id: string; status: string; paid: string }) {
  // Sales hanya boleh menarik PENGAJUANNYA yang belum diproses finance
  if (user.role === "sales" && invoice.status !== "diajukan") {
    throw ApiError.forbidden("Invoice sudah diproses Finance — hubungi finance untuk pembatalan");
  }
  if (Number(invoice.paid) > 0) {
    throw ApiError.conflict("Invoice sudah menerima pembayaran — tidak bisa dihapus");
  }
  await queryOne(
    `UPDATE crm.crm_sales_invoices
     SET deleted_at = now(), deleted_by = $2, updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [invoice.id, user.id]
  );
}

export async function renderInvoicePdf(invoiceId: string): Promise<{ pdf: Buffer; fileName: string }> {
  const invoice = await queryOne<{
    invoice_number: string;
    label: string;
    amount: string;
    due_date: string | null;
    status: string;
    note: string | null;
    created_at: string;
    paid: string;
    quote_number: string | null;
    use_ppn: boolean | null;
    ppn_persen: string | null;
    term_percent: string | null;
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
    `SELECT i.invoice_number, i.label, i.amount,
            i.due_date::text AS due_date, i.status, i.note, i.created_at,
            COALESCE(
              (SELECT SUM(p.amount) FROM crm.crm_sales_deal_payments p
               WHERE p.invoice_id = i.id AND p.deleted_at IS NULL),
              0
            ) AS paid,
            q.quote_number, q.use_ppn, q.ppn_persen,
            t.percent AS term_percent,
            d.title AS deal_title, d.event_type, d.event_date,
            l.org_name, l.pic_name, l.pic_title,
            u.full_name AS owner_name,
            c.name AS company_name, b.name AS branch_name
     FROM crm.crm_sales_invoices i
     JOIN crm.crm_sales_deals d ON d.id = i.deal_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     LEFT JOIN crm.crm_sales_quotations q ON q.id = i.quotation_id
     LEFT JOIN crm.crm_sales_quotation_terms t ON t.id = i.term_id
     LEFT JOIN configuration.users u ON u.id = d.owner_user_id
     LEFT JOIN configuration.companies c ON c.id = i.company_id
     LEFT JOIN configuration.branches b ON b.id = i.branch_id
     WHERE i.id = $1 AND i.deleted_at IS NULL`,
    [invoiceId]
  );
  if (!invoice) throw ApiError.notFound("Invoice tidak ditemukan");

  const pdf = await buildInvoicePdf({
    invoice_number: invoice.invoice_number,
    label: invoice.label,
    amount: Number(invoice.amount),
    paid: Number(invoice.paid),
    due_date: invoice.due_date,
    status: invoice.status,
    created_at: invoice.created_at,
    company_name: invoice.company_name,
    branch_name: invoice.branch_name,
    org_name: invoice.org_name,
    pic_name: invoice.pic_name,
    pic_title: invoice.pic_title,
    deal_title: invoice.deal_title,
    event_type_label: EVENT_TYPE_DOC_LABELS[invoice.event_type] ?? "Acara",
    event_date: invoice.event_date,
    quote_number: invoice.quote_number,
    term_percent: invoice.term_percent !== null ? Number(invoice.term_percent) : null,
    // PPN mengikuti setelan quotation asal invoice
    use_ppn: invoice.use_ppn ?? false,
    ppn_persen: Number(invoice.ppn_persen ?? 0),
    note: invoice.note,
    owner_name: invoice.owner_name,
  });
  return { pdf, fileName: invoiceFileName(invoice.invoice_number, invoice.org_name) };
}

// ── Pembayaran per deal (EPIC-022 Fase G) ──

const PAYMENT_METHODS = ["cash", "transfer", "qris", "edc", "lainnya"] as const;

export const createPaymentSchema = z.object({
  amount: z.number().positive().max(999_999_999_999),
  method: z.enum(PAYMENT_METHODS).default("transfer"),
  paid_on: calendarDate,
  note: z.string().trim().max(300).optional().nullable(),
  // Pembayaran mengacu ke invoice (nullable — catatan lama tetap sah)
  invoice_id: z.string().uuid().optional().nullable(),
});

/** Progress pelunasan: pembayaran, ringkasan vs tagihan acuan, status per termin (waterfall). */
export async function loadPaymentSummary(dealId: string) {
  const [payments, refQuotation, deal] = await Promise.all([
    query<{
      id: string;
      amount: string;
      method: string;
      paid_on: string;
      note: string | null;
      invoice_id: string | null;
      invoice_number: string | null;
      created_by_name: string | null;
      created_at: string;
    }>(
      `SELECT p.id, p.amount, p.method, p.paid_on::text AS paid_on, p.note,
              p.invoice_id, inv.invoice_number,
              u.full_name AS created_by_name, p.created_at
       FROM crm.crm_sales_deal_payments p
       LEFT JOIN crm.crm_sales_invoices inv ON inv.id = p.invoice_id
       LEFT JOIN configuration.users u ON u.id = p.created_by
       WHERE p.deal_id = $1 AND p.deleted_at IS NULL
       ORDER BY p.paid_on DESC, p.created_at DESC`,
      [dealId]
    ),
    loadReferenceQuotation(dealId),
    queryOne<{ value_final: string | null; value_estimate: string | null }>(
      `SELECT value_final, value_estimate FROM crm.crm_sales_deals WHERE id = $1`,
      [dealId]
    ),
  ]);

  const totalPaid = roundCents(payments.reduce((sum, p) => sum + Number(p.amount), 0));
  const referenceTotal = resolveReferenceTotal(refQuotation, deal);
  const terms = await loadTerms(refQuotation?.id);

  return {
    payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })),
    summary: {
      reference_total: roundCents(referenceTotal),
      reference_quote_number: refQuotation?.quote_number ?? null,
      reference_is_accepted: refQuotation?.status === "diterima",
      total_paid: totalPaid,
      outstanding: Math.max(0, roundCents(referenceTotal - totalPaid)),
    },
    terms: termProgress(
      terms.map((t) => ({ label: t.label, due_date: t.due_date, percent: Number(t.percent) })),
      referenceTotal,
      totalPaid
    ),
  };
}

export async function createPayment(user: SalesFunnelUser, deal: AccessibleDeal, body: z.infer<typeof createPaymentSchema>) {
  // Invoice acuan harus milik deal ini & belum dibatalkan/dihapus
  if (body.invoice_id) {
    const invoice = await queryOne<{ id: string }>(
      `SELECT id FROM crm.crm_sales_invoices
       WHERE id = $1 AND deal_id = $2 AND deleted_at IS NULL AND status <> 'batal'`,
      [body.invoice_id, deal.id]
    );
    if (!invoice) throw ApiError.badRequest("Invoice tidak ditemukan pada deal ini");
  }
  return queryOne<{ id: string }>(
    `INSERT INTO crm.crm_sales_deal_payments
       (company_id, branch_id, deal_id, amount, method, paid_on, note, invoice_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      deal.company_id,
      deal.branch_id,
      deal.id,
      roundCents(body.amount),
      body.method,
      body.paid_on,
      body.note || null,
      body.invoice_id || null,
      user.id,
    ]
  );
}

/** Hapus (soft) satu catatan pembayaran — jejak tetap (deleted_at + deleted_by). */
export async function deletePayment(dealId: string, paymentId: string, userId: string): Promise<void> {
  const deleted = await queryOne<{ id: string }>(
    `UPDATE crm.crm_sales_deal_payments
     SET deleted_at = now(), deleted_by = $3, updated_at = now()
     WHERE id = $1 AND deal_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [paymentId, dealId, userId]
  );
  if (!deleted) throw ApiError.notFound("Catatan pembayaran tidak ditemukan");
}
