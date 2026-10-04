import { ApiError } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import type { FinanceUser } from "@/lib/finance/server";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";

export const INVOICE_STATUSES = ["diajukan", "draft", "terkirim", "batal"] as const;
const MAX_ROWS = 300;

const PAID_SUBQUERY = `COALESCE(
  (SELECT SUM(p.amount) FROM crm.crm_sales_deal_payments p
   WHERE p.invoice_id = i.id AND p.deleted_at IS NULL),
  0
)`;

/** Status bayar + sisa tagihan (dibulatkan 2 desimal, tidak negatif). */
export function invoicePaymentSummary(amount: number, paid: number) {
  return {
    payment_status: amount > 0 && paid >= amount ? "lunas" : paid > 0 ? "sebagian" : "belum",
    outstanding: Math.max(0, Math.round((amount - paid) * 100) / 100),
  } as const;
}

/** Akses invoice mengikuti akses deal induknya: 404 bila tidak ada, 403 bila deal di luar akses. */
export async function assertInvoiceAccess<T extends { deal_id: string }>(
  invoice: T | null,
  user: FinanceUser
): Promise<T> {
  if (!invoice) throw ApiError.notFound("Invoice tidak ditemukan");
  const { deal, forbidden } = await findAccessibleDeal(invoice.deal_id, user);
  if (forbidden || !deal) throw ApiError.forbidden();
  return invoice;
}

type InvoiceListRow = {
  id: string;
  invoice_number: string;
  label: string;
  amount: string;
  due_date: string | null;
  status: string;
  sent_at: string | null;
  note: string | null;
  created_at: string;
  deal_id: string;
  deal_title: string;
  org_name: string;
  pic_name: string;
  quote_number: string | null;
  created_by_name: string | null;
  paid: string;
};

/** Daftar invoice lintas-deal; pengajuan sales (status 'diajukan') di atas. */
export async function listFinanceInvoices(scope: UserScope | null, filters: { status: string; q: string }) {
  const conditions: string[] = ["i.deleted_at IS NULL"];
  const params: unknown[] = [];
  const add = (fragment: string, value: unknown) => {
    params.push(value);
    conditions.push(fragment.replaceAll("?", `$${params.length}`));
  };

  // Tenant isolation fail-closed — pola list deals sales-funnel
  if (scope?.companyId) add("i.company_id = ?", scope.companyId);
  if (scope?.businessScope === "branch" && scope.branchId) add("i.branch_id = ?", scope.branchId);
  if ((INVOICE_STATUSES as readonly string[]).includes(filters.status)) add("i.status = ?", filters.status);
  if (filters.q) add("(i.invoice_number ILIKE ? OR l.org_name ILIKE ? OR d.title ILIKE ?)", `%${filters.q}%`);

  const rows = await query<InvoiceListRow>(
    `SELECT i.id, i.invoice_number, i.label, i.amount,
            i.due_date::text AS due_date, i.status, i.sent_at, i.note,
            i.created_at, i.deal_id,
            d.title AS deal_title, l.org_name, l.pic_name,
            q.quote_number, u.full_name AS created_by_name,
            ${PAID_SUBQUERY} AS paid
     FROM crm.crm_sales_invoices i
     JOIN crm.crm_sales_deals d ON d.id = i.deal_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     LEFT JOIN crm.crm_sales_quotations q ON q.id = i.quotation_id
     LEFT JOIN configuration.users u ON u.id = i.created_by
     WHERE ${conditions.join(" AND ")}
     ORDER BY (i.status = 'diajukan') DESC, i.created_at DESC
     LIMIT ${MAX_ROWS}`,
    params
  );

  return rows.map((row) => {
    const amount = Number(row.amount);
    const paid = Number(row.paid);
    return { ...row, amount, paid, ...invoicePaymentSummary(amount, paid) };
  });
}

type InvoiceDetailRow = {
  id: string;
  invoice_number: string;
  label: string;
  amount: string;
  due_date: string | null;
  status: string;
  sent_at: string | null;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
  deal_id: string;
  deal_title: string;
  event_type: string;
  event_date: string | null;
  org_name: string;
  pic_name: string;
  pic_phone: string;
  pic_title: string | null;
  quotation_id: string | null;
  quote_number: string | null;
  quotation_status: string | null;
  quotation_total: string | null;
  quotation_use_ppn: boolean | null;
  quotation_ppn_persen: string | null;
  term_id: string | null;
  term_label: string | null;
  term_percent: string | null;
  term_due_date: string | null;
  faktur_pajak_url: string | null;
  paid: string;
};

/** Detail invoice untuk Finance: acuan quotation/termin dan status bayar. */
export async function getFinanceInvoiceDetail(id: string, user: FinanceUser) {
  const row = await queryOne<InvoiceDetailRow>(
    `SELECT i.id, i.invoice_number, i.label, i.amount,
            i.due_date::text AS due_date, i.status, i.sent_at, i.note,
            i.faktur_pajak_url,
            i.created_at, u.full_name AS created_by_name,
            i.deal_id, d.title AS deal_title, d.event_type,
            d.event_date::text AS event_date,
            l.org_name, l.pic_name, l.pic_phone, l.pic_title,
            q.id AS quotation_id, q.quote_number, q.status AS quotation_status,
            q.total AS quotation_total, q.use_ppn AS quotation_use_ppn,
            q.ppn_persen AS quotation_ppn_persen,
            t.id AS term_id, t.label AS term_label, t.percent AS term_percent,
            t.due_date::text AS term_due_date,
            ${PAID_SUBQUERY} AS paid
     FROM crm.crm_sales_invoices i
     JOIN crm.crm_sales_deals d ON d.id = i.deal_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     LEFT JOIN crm.crm_sales_quotations q ON q.id = i.quotation_id
     LEFT JOIN crm.crm_sales_quotation_terms t ON t.id = i.term_id
     LEFT JOIN configuration.users u ON u.id = i.created_by
     WHERE i.id = $1 AND i.deleted_at IS NULL`,
    [id]
  );
  const r = await assertInvoiceAccess(row, user);
  const amount = Number(r.amount);
  const paid = Number(r.paid);

  return {
    id: r.id,
    invoice_number: r.invoice_number,
    label: r.label,
    amount,
    due_date: r.due_date,
    status: r.status,
    sent_at: r.sent_at,
    note: r.note,
    created_at: r.created_at,
    created_by_name: r.created_by_name,
    deal_id: r.deal_id,
    deal_title: r.deal_title,
    event_type: r.event_type,
    event_date: r.event_date,
    org_name: r.org_name,
    pic_name: r.pic_name,
    pic_phone: r.pic_phone,
    pic_title: r.pic_title,
    // Path storage tak diekspos — unduh selalu lewat route ber-auth
    has_faktur_pajak: r.faktur_pajak_url !== null,
    quotation: r.quotation_id
      ? {
          id: r.quotation_id,
          quote_number: r.quote_number,
          status: r.quotation_status,
          total: Number(r.quotation_total),
          use_ppn: r.quotation_use_ppn,
          ppn_persen: Number(r.quotation_ppn_persen),
        }
      : null,
    term: r.term_id
      ? { id: r.term_id, label: r.term_label, percent: Number(r.term_percent), due_date: r.term_due_date }
      : null,
    paid,
    ...invoicePaymentSummary(amount, paid),
  };
}

const ALREADY_CANCELLED = "Invoice sudah dibatalkan — tidak bisa direvisi";

/**
 * Revisi label/nominal/jatuh tempo/catatan. Ditolak bila invoice batal atau
 * sudah menerima pembayaran (nominal jadi tidak sinkron dengan uang masuk).
 */
export async function reviseFinanceInvoice(
  id: string,
  user: FinanceUser,
  body: { label: string; amount: number; due_date?: string | null; note?: string | null }
) {
  const invoice = await assertInvoiceAccess(
    await queryOne<{ id: string; deal_id: string; status: string; paid: string }>(
      `SELECT i.id, i.deal_id, i.status, ${PAID_SUBQUERY} AS paid
       FROM crm.crm_sales_invoices i
       WHERE i.id = $1 AND i.deleted_at IS NULL`,
      [id]
    ),
    user
  );
  if (invoice.status === "batal") throw ApiError.conflict(ALREADY_CANCELLED);
  if (Number(invoice.paid) > 0) {
    throw ApiError.conflict("Invoice sudah menerima pembayaran — tidak bisa direvisi");
  }

  const row = await queryOne<{ id: string; invoice_number: string }>(
    `UPDATE crm.crm_sales_invoices
     SET label = $1, amount = $2, due_date = $3, note = $4, updated_at = now()
     WHERE id = $5 AND deleted_at IS NULL AND status <> 'batal'
     RETURNING id, invoice_number`,
    [body.label, Math.round(body.amount * 100) / 100, body.due_date || null, body.note || null, id]
  );
  if (!row) throw ApiError.conflict(ALREADY_CANCELLED);
  return row;
}

/** Pembayaran tercatat untuk satu invoice, terbaru dulu. */
export async function listInvoicePayments(id: string, user: FinanceUser) {
  await assertInvoiceAccess(
    await queryOne<{ id: string; deal_id: string }>(
      `SELECT id, deal_id FROM crm.crm_sales_invoices WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    ),
    user
  );
  return query(
    `SELECT p.id, p.amount, p.method, p.paid_on::text AS paid_on, p.note,
            u.full_name AS created_by_name, p.created_at
     FROM crm.crm_sales_deal_payments p
     LEFT JOIN configuration.users u ON u.id = p.created_by
     WHERE p.invoice_id = $1 AND p.deleted_at IS NULL
     ORDER BY p.paid_on DESC, p.created_at DESC`,
    [id]
  );
}

/** EPIC-025 — soft delete catatan pembayaran (koreksi salah catat, jejak tetap). */
export async function softDeleteDealPayment(paymentId: string, user: FinanceUser) {
  const payment = await queryOne<{ id: string; deal_id: string }>(
    `SELECT id, deal_id FROM crm.crm_sales_deal_payments
     WHERE id = $1 AND deleted_at IS NULL`,
    [paymentId]
  );
  if (!payment) throw ApiError.notFound("Catatan pembayaran tidak ditemukan");
  const { deal, forbidden } = await findAccessibleDeal(payment.deal_id, user);
  if (forbidden || !deal) throw ApiError.forbidden();

  await queryOne(
    `UPDATE crm.crm_sales_deal_payments
     SET deleted_at = now(), deleted_by = $2, updated_at = now()
     WHERE id = $1 RETURNING id`,
    [paymentId, user.id]
  );
}
