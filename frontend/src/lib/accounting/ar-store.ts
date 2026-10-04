import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import {
  bucketAging,
  computeInvoiceOutstanding,
  resolvePaymentStatus,
  round2,
} from "@/lib/accounting/ap-status";
import {
  postArInvoiceJournal,
  postArReceiptJournal,
} from "@/lib/accounting/ar-posting";
import type {
  ArAgingBucket,
  ArInvoiceRow,
  ArReceiptMethod,
  ArReceiptRow,
} from "@/lib/accounting/ar-types";
import type { MappingPostResult } from "@/lib/accounting/journal-mapping-posting";

type InvoiceDb = {
  id: string;
  company_id: string | null;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  customer_name: string | null;
  sales_invoice_id: string | null;
  deal_id: string | null;
  currency: string;
  subtotal: string | number;
  tax_amount: string | number;
  total_amount: string | number;
  status: string;
  description: string | null;
  posted_at: string | null;
  posted_by: string | null;
  created_at: string;
  allocated_amount?: string | number;
  deal_title?: string | null;
  _total?: number;
};

const ALLOC = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(a.amount), 0) AS allocated
      FROM accounting.ar_receipt_allocations a
      JOIN accounting.ar_receipts r ON r.id = a.receipt_id
     WHERE a.invoice_id = i.id
       AND r.deleted_at IS NULL
       AND r.status = 'POSTED'
  ) alloc ON true`;

function mapInvoice(row: InvoiceDb): ArInvoiceRow {
  const total = Number(row.total_amount) || 0;
  const allocated = Number(row.allocated_amount || 0);
  const dueDate = row.due_date ? String(row.due_date).slice(0, 10) : null;
  return {
    id: row.id,
    company_id: row.company_id,
    invoice_no: row.invoice_no,
    invoice_date: String(row.invoice_date).slice(0, 10),
    due_date: dueDate,
    customer_name: row.customer_name,
    sales_invoice_id: row.sales_invoice_id,
    deal_id: row.deal_id,
    currency: row.currency || "IDR",
    subtotal: Number(row.subtotal) || 0,
    tax_amount: Number(row.tax_amount) || 0,
    total_amount: total,
    status: row.status as ArInvoiceRow["status"],
    description: row.description,
    posted_at: row.posted_at,
    posted_by: row.posted_by,
    created_at: row.created_at,
    allocated_amount: allocated,
    outstanding_amount: computeInvoiceOutstanding(total, allocated),
    payment_status: resolvePaymentStatus({
      totalAmount: total,
      allocatedAmount: allocated,
      dueDate,
    }),
    deal_title: row.deal_title ?? null,
  };
}

async function nextNo(prefix: "AR" | "ARR"): Promise<string> {
  const now = new Date();
  const head = `${prefix}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const col = prefix === "AR" ? "invoice_no" : "receipt_no";
  const table = prefix === "AR" ? "accounting.ar_invoices" : "accounting.ar_receipts";
  const row = await queryOne<{ n: string }>(
    `SELECT ${col} AS n FROM ${table}
      WHERE ${col} ILIKE $1 AND deleted_at IS NULL
      ORDER BY ${col} DESC LIMIT 1`,
    [`${head}-%`]
  );
  const seq = Number(String(row?.n || "").split("-").pop() || 0) + 1;
  return `${head}-${String(seq).padStart(4, "0")}`;
}

/** Idempotent: one AR invoice per crm sales invoice when issued (terkirim). */
export async function createArInvoiceFromSalesInvoice(opts: {
  salesInvoiceId: string;
  userId: string;
}): Promise<{ invoice: ArInvoiceRow; journal: MappingPostResult; note: string | null }> {
  const existing = await queryOne<InvoiceDb>(
    `SELECT i.*, COALESCE(alloc.allocated, 0) AS allocated_amount
       FROM accounting.ar_invoices i
       ${ALLOC}
      WHERE i.sales_invoice_id = $1 AND i.deleted_at IS NULL
      LIMIT 1`,
    [opts.salesInvoiceId]
  );
  if (existing) {
    return {
      invoice: mapInvoice(existing),
      journal: { status: "skipped", reason: "already_exists" },
      note: null,
    };
  }

  const src = await queryOne<{
    id: string;
    company_id: string;
    invoice_number: string;
    amount: string;
    due_date: string | null;
    deal_id: string;
    sent_at: string | null;
    created_at: string;
    org_name: string | null;
    deal_title: string | null;
    status: string;
  }>(
    `SELECT i.id, i.company_id, i.invoice_number, i.amount,
            i.due_date::text AS due_date, i.deal_id, i.sent_at, i.created_at,
            i.status, l.org_name, d.title AS deal_title
       FROM crm.crm_sales_invoices i
       JOIN crm.crm_sales_deals d ON d.id = i.deal_id
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
      WHERE i.id = $1 AND i.deleted_at IS NULL`,
    [opts.salesInvoiceId]
  );
  if (!src) throw ApiError.notFound("Sales invoice tidak ditemukan");
  if (src.status === "batal") throw ApiError.badRequest("Invoice batal — tidak membuat AR");

  const total = round2(Number(src.amount) || 0);
  if (total <= 0) throw ApiError.badRequest("Nilai invoice 0");

  const invoiceNo = await nextNo("AR");
  const invoiceDate = src.sent_at
    ? String(src.sent_at).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  const inserted = await queryOne<InvoiceDb>(
    `INSERT INTO accounting.ar_invoices (
       company_id, invoice_no, invoice_date, due_date, customer_name,
       sales_invoice_id, deal_id, currency, subtotal, tax_amount, total_amount,
       status, description, posted_at, posted_by, created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,'IDR',$8,0,$8,'POSTED',$9,$10,$11,$11,$11
     )
     RETURNING *`,
    [
      src.company_id,
      invoiceNo,
      invoiceDate,
      src.due_date,
      src.org_name || src.deal_title || "Customer",
      src.id,
      src.deal_id,
      total,
      `AR dari B2B ${src.invoice_number}`,
      now,
      opts.userId,
    ]
  );
  if (!inserted) throw new Error("Gagal membuat AR invoice");

  const invoice = mapInvoice({ ...inserted, allocated_amount: 0 });
  const journal = await postArInvoiceJournal({
    companyId: src.company_id,
    userId: opts.userId,
    invoice,
    description: `B2B ${src.invoice_number} / ${invoice.invoice_no} — piutang`,
  });
  return { invoice, journal: journal.result, note: journal.note };
}

export async function listArInvoices(opts: {
  companyId?: string | null;
  status?: string;
  paymentStatus?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: ArInvoiceRow[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const params: unknown[] = [];
  const where = [`i.deleted_at IS NULL`];

  if (opts.companyId) {
    params.push(opts.companyId);
    where.push(`i.company_id = $${params.length}`);
  }
  if (opts.status) {
    params.push(opts.status);
    where.push(`i.status = $${params.length}`);
  }
  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim()}%`);
    const i = params.length;
    where.push(
      `(i.invoice_no ILIKE $${i} OR COALESCE(i.customer_name,'') ILIKE $${i} OR COALESCE(d.title,'') ILIKE $${i})`
    );
  }
  params.push(limit);
  const lim = `$${params.length}`;
  params.push(offset);
  const off = `$${params.length}`;

  const rows = await query<InvoiceDb>(
    `SELECT i.*, COALESCE(alloc.allocated, 0) AS allocated_amount,
            d.title AS deal_title, COUNT(*) OVER()::int AS _total
       FROM accounting.ar_invoices i
       LEFT JOIN crm.crm_sales_deals d ON d.id = i.deal_id
       ${ALLOC}
      WHERE ${where.join(" AND ")}
      ORDER BY i.invoice_date DESC, i.created_at DESC
      LIMIT ${lim} OFFSET ${off}`,
    params
  );

  let mapped = rows.map(mapInvoice);
  if (opts.paymentStatus && opts.paymentStatus !== "all") {
    mapped = mapped.filter((r) => r.payment_status === opts.paymentStatus);
  }
  return {
    rows: mapped,
    total:
      opts.paymentStatus && opts.paymentStatus !== "all"
        ? mapped.length
        : Number(rows[0]?._total ?? mapped.length),
  };
}

export async function getArInvoiceById(id: string): Promise<ArInvoiceRow | null> {
  const row = await queryOne<InvoiceDb>(
    `SELECT i.*, COALESCE(alloc.allocated, 0) AS allocated_amount, d.title AS deal_title
       FROM accounting.ar_invoices i
       LEFT JOIN crm.crm_sales_deals d ON d.id = i.deal_id
       ${ALLOC}
      WHERE i.id = $1 AND i.deleted_at IS NULL`,
    [id]
  );
  return row ? mapInvoice(row) : null;
}

export async function getArInvoiceBySalesInvoiceId(
  salesInvoiceId: string
): Promise<ArInvoiceRow | null> {
  const row = await queryOne<InvoiceDb>(
    `SELECT i.*, COALESCE(alloc.allocated, 0) AS allocated_amount, d.title AS deal_title
       FROM accounting.ar_invoices i
       LEFT JOIN crm.crm_sales_deals d ON d.id = i.deal_id
       ${ALLOC}
      WHERE i.sales_invoice_id = $1 AND i.deleted_at IS NULL`,
    [salesInvoiceId]
  );
  return row ? mapInvoice(row) : null;
}

export async function recordArReceipt(opts: {
  userId: string;
  invoiceId: string;
  amount: number;
  receiptDate?: string;
  method?: ArReceiptMethod;
  referenceNumber?: string | null;
  notes?: string | null;
}): Promise<{
  receipt: ArReceiptRow;
  invoice: ArInvoiceRow;
  journal: MappingPostResult;
  note: string | null;
}> {
  const invoice = await getArInvoiceById(opts.invoiceId);
  if (!invoice) throw ApiError.notFound("AR invoice tidak ditemukan");
  if (invoice.status !== "POSTED") throw ApiError.badRequest("Hanya invoice POSTED yang bisa diterima");

  const amount = round2(opts.amount);
  if (amount <= 0) throw ApiError.badRequest("Amount harus > 0");
  const outstanding = invoice.outstanding_amount ?? invoice.total_amount;
  if (amount > outstanding + 0.01) {
    throw ApiError.badRequest("Amount tidak boleh melebihi outstanding");
  }

  const receiptDate = opts.receiptDate || new Date().toISOString().slice(0, 10);
  const method = opts.method || "transfer";
  const receiptNo = await nextNo("ARR");
  const now = new Date().toISOString();

  let dealPaymentId: string | null = null;
  if (invoice.sales_invoice_id && invoice.deal_id) {
    const sales = await queryOne<{
      company_id: string;
      branch_id: string;
      deal_id: string;
    }>(
      `SELECT company_id, branch_id, deal_id FROM crm.crm_sales_invoices
        WHERE id = $1 AND deleted_at IS NULL`,
      [invoice.sales_invoice_id]
    );
    if (sales) {
      const pay = await queryOne<{ id: string }>(
        `INSERT INTO crm.crm_sales_deal_payments
           (company_id, branch_id, deal_id, invoice_id, amount, method,
            paid_on, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          sales.company_id,
          sales.branch_id,
          sales.deal_id,
          invoice.sales_invoice_id,
          amount,
          method,
          receiptDate,
          opts.notes
            ? `${opts.notes} (via Accounting AR ${receiptNo})`
            : `via Accounting AR ${receiptNo}`,
          opts.userId,
        ]
      );
      dealPaymentId = pay?.id ?? null;
    }
  }

  const receipt = await queryOne<{
    id: string;
    company_id: string | null;
    created_at: string;
  }>(
    `INSERT INTO accounting.ar_receipts (
       company_id, receipt_no, receipt_date, amount, method,
       reference_number, notes, status, deal_payment_id,
       posted_at, posted_by, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'POSTED',$8,$9,$10,$10,$10)
     RETURNING id, company_id, created_at`,
    [
      invoice.company_id,
      receiptNo,
      receiptDate,
      amount,
      method,
      opts.referenceNumber || null,
      opts.notes || null,
      dealPaymentId,
      now,
      opts.userId,
    ]
  );
  if (!receipt) throw new Error("Gagal membuat AR receipt");

  await query(
    `INSERT INTO accounting.ar_receipt_allocations (receipt_id, invoice_id, amount)
     VALUES ($1,$2,$3)`,
    [receipt.id, invoice.id, amount]
  );

  const journal = await postArReceiptJournal({
    companyId: invoice.company_id,
    userId: opts.userId,
    receiptId: receipt.id,
    receiptNo,
    receiptDate,
    amount,
  });

  const refreshed = await getArInvoiceById(invoice.id);
  return {
    receipt: {
      id: receipt.id,
      company_id: receipt.company_id,
      receipt_no: receiptNo,
      receipt_date: receiptDate,
      amount,
      method,
      reference_number: opts.referenceNumber || null,
      notes: opts.notes || null,
      status: "POSTED",
      deal_payment_id: dealPaymentId,
      posted_at: now,
      posted_by: opts.userId,
      created_at: receipt.created_at,
      customer_name: invoice.customer_name,
      invoice_nos: [invoice.invoice_no],
    },
    invoice: refreshed || invoice,
    journal: journal.result,
    note: journal.note,
  };
}

export async function listArReceipts(opts: {
  companyId?: string | null;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: ArReceiptRow[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const params: unknown[] = [];
  const where = [`r.deleted_at IS NULL`];
  if (opts.companyId) {
    params.push(opts.companyId);
    where.push(`r.company_id = $${params.length}`);
  }
  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim()}%`);
    where.push(`r.receipt_no ILIKE $${params.length}`);
  }
  params.push(limit);
  const lim = `$${params.length}`;
  params.push(offset);
  const off = `$${params.length}`;

  type R = {
    id: string;
    company_id: string | null;
    receipt_no: string;
    receipt_date: string;
    amount: string | number;
    method: string;
    reference_number: string | null;
    notes: string | null;
    status: string;
    deal_payment_id: string | null;
    posted_at: string | null;
    posted_by: string | null;
    created_at: string;
    customer_name: string | null;
    invoice_nos: string | null;
    _total: number;
  };

  const rows = await query<R>(
    `SELECT r.*,
            (
              SELECT i.customer_name FROM accounting.ar_receipt_allocations a
              JOIN accounting.ar_invoices i ON i.id = a.invoice_id
              WHERE a.receipt_id = r.id LIMIT 1
            ) AS customer_name,
            (
              SELECT string_agg(i.invoice_no, ', ' ORDER BY i.invoice_no)
                FROM accounting.ar_receipt_allocations a
                JOIN accounting.ar_invoices i ON i.id = a.invoice_id
               WHERE a.receipt_id = r.id
            ) AS invoice_nos,
            COUNT(*) OVER()::int AS _total
       FROM accounting.ar_receipts r
      WHERE ${where.join(" AND ")}
      ORDER BY r.receipt_date DESC, r.created_at DESC
      LIMIT ${lim} OFFSET ${off}`,
    params
  );

  return {
    rows: rows.map((r) => ({
      id: r.id,
      company_id: r.company_id,
      receipt_no: r.receipt_no,
      receipt_date: String(r.receipt_date).slice(0, 10),
      amount: Number(r.amount) || 0,
      method: r.method,
      reference_number: r.reference_number,
      notes: r.notes,
      status: r.status as ArReceiptRow["status"],
      deal_payment_id: r.deal_payment_id,
      posted_at: r.posted_at,
      posted_by: r.posted_by,
      created_at: r.created_at,
      customer_name: r.customer_name,
      invoice_nos: r.invoice_nos ? r.invoice_nos.split(", ") : [],
    })),
    total: Number(rows[0]?._total ?? 0),
  };
}

export async function listArReceivable(opts: {
  companyId?: string | null;
}): Promise<ArInvoiceRow[]> {
  const { rows } = await listArInvoices({
    companyId: opts.companyId,
    status: "POSTED",
    limit: 100,
  });
  return rows.filter((r) => (r.outstanding_amount ?? 0) > 0.009);
}

export type ArAgingRow = {
  bucket: ArAgingBucket;
  invoice_count: number;
  amount: number;
};

export async function listArAging(opts: {
  companyId?: string | null;
  asOf?: string;
}): Promise<{ asOf: string; buckets: ArAgingRow[]; invoices: ArInvoiceRow[] }> {
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const open = await listArReceivable({ companyId: opts.companyId });
  const map = new Map<ArAgingBucket, ArAgingRow>();
  for (const b of [
    "current",
    "1_30",
    "31_60",
    "61_90",
    "90_plus",
  ] as ArAgingBucket[]) {
    map.set(b, { bucket: b, invoice_count: 0, amount: 0 });
  }
  for (const inv of open) {
    const bucket = bucketAging(inv.outstanding_amount || 0, inv.due_date, asOf);
    if (!bucket) continue;
    const row = map.get(bucket)!;
    row.invoice_count += 1;
    row.amount = round2(row.amount + (inv.outstanding_amount || 0));
  }
  return { asOf, buckets: [...map.values()], invoices: open };
}

/** Ensure existing terkirim B2B invoices have AR rows (lazy sync). */
export async function syncArFromOpenSalesInvoices(opts: {
  companyId: string;
  userId: string;
  limit?: number;
}): Promise<number> {
  const rows = await query<{ id: string }>(
    `SELECT i.id
       FROM crm.crm_sales_invoices i
      WHERE i.company_id = $1
        AND i.deleted_at IS NULL
        AND i.status = 'terkirim'
        AND NOT EXISTS (
          SELECT 1 FROM accounting.ar_invoices a
           WHERE a.sales_invoice_id = i.id AND a.deleted_at IS NULL
        )
      ORDER BY i.sent_at NULLS LAST
      LIMIT $2`,
    [opts.companyId, opts.limit ?? 50]
  );
  let n = 0;
  for (const r of rows) {
    try {
      await createArInvoiceFromSalesInvoice({
        salesInvoiceId: r.id,
        userId: opts.userId,
      });
      n += 1;
    } catch {
      // skip individual failures
    }
  }
  return n;
}
