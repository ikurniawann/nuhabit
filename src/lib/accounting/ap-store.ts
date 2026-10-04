import { ApiError } from "@/lib/api/auth";
import type { DbClient } from "@/lib/pg/types";
import { query, queryOne } from "@/lib/db";
import {
  bucketAging,
  computeInvoiceOutstanding,
  resolvePaymentStatus,
  round2,
} from "@/lib/accounting/ap-status";
import { postApPaymentJournal } from "@/lib/accounting/ap-posting";
import type {
  ApAgingBucket,
  ApInvoiceRow,
  ApPaymentMethod,
  ApPaymentRow,
} from "@/lib/accounting/ap-types";
import { buildGrnAccountingAmounts } from "@/lib/purchasing/accounting-amounts";
import {
  getPoPayableContext,
  resolvePaymentTermId,
  resolvePoPaymentParty,
} from "@/lib/purchasing/po-payments";
import type { MappingPostResult } from "@/lib/accounting/journal-mapping-posting";

type InvoiceDbRow = {
  id: string;
  company_id: string | null;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  vendor_id: string | null;
  supplier_id: string | null;
  purchase_order_id: string | null;
  grn_id: string | null;
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
  party_name?: string | null;
  po_number?: string | null;
  grn_number?: string | null;
  _total?: number;
};

function mapInvoice(row: InvoiceDbRow): ApInvoiceRow {
  const total = Number(row.total_amount) || 0;
  const allocated = Number(row.allocated_amount || 0);
  const dueDate = row.due_date ? String(row.due_date).slice(0, 10) : null;
  return {
    id: row.id,
    company_id: row.company_id,
    invoice_no: row.invoice_no,
    invoice_date: String(row.invoice_date).slice(0, 10),
    due_date: dueDate,
    vendor_id: row.vendor_id,
    supplier_id: row.supplier_id,
    purchase_order_id: row.purchase_order_id,
    grn_id: row.grn_id,
    currency: row.currency || "IDR",
    subtotal: Number(row.subtotal) || 0,
    tax_amount: Number(row.tax_amount) || 0,
    total_amount: total,
    status: row.status as ApInvoiceRow["status"],
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
    party_name: row.party_name ?? null,
    po_number: row.po_number ?? null,
    grn_number: row.grn_number ?? null,
  };
}

const ALLOC_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(a.amount), 0) AS allocated
      FROM accounting.ap_payment_allocations a
      JOIN accounting.ap_payments p ON p.id = a.payment_id
     WHERE a.invoice_id = i.id
       AND p.deleted_at IS NULL
       AND p.status = 'POSTED'
  ) alloc ON true`;

async function nextDocumentNo(
  db: DbClient,
  table: "ap_invoices" | "ap_payments",
  prefix: "AP" | "APP"
): Promise<string> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const head = `${prefix}-${y}${m}${d}`;
  const col = table === "ap_invoices" ? "invoice_no" : "payment_no";
  const { data, error } = await db
    .from(table)
    .select(col)
    .ilike(col, `${head}-%`)
    .order(col, { ascending: false })
    .limit(1);
  if (error) throw error;
  const last = (data?.[0] as Record<string, string> | undefined)?.[col];
  const seq = Number(String(last || "").split("-").pop() || 0) + 1;
  return `${head}-${String(seq).padStart(4, "0")}`;
}

/** Idempotent: one POSTED AP invoice per GRN. */
export async function createApInvoiceFromGrn(opts: {
  db: DbClient;
  grnId: string;
  userId: string;
}): Promise<ApInvoiceRow> {
  const existing = await queryOne<InvoiceDbRow>(
    `SELECT i.*, COALESCE(alloc.allocated, 0) AS allocated_amount
       FROM accounting.ap_invoices i
       ${ALLOC_LATERAL}
      WHERE i.grn_id = $1 AND i.deleted_at IS NULL
      LIMIT 1`,
    [opts.grnId]
  );
  if (existing) return mapInvoice(existing);

  const built = await buildGrnAccountingAmounts(opts.db, opts.grnId);
  if ((built.amounts.TOTAL || 0) <= 0) {
    throw ApiError.badRequest("Nilai GRN 0 — tidak membuat AP invoice");
  }

  const { data: grn, error: grnError } = await opts.db
    .from("grn")
    .select(
      "id, nomor_grn, company_id, purchase_order_id, tanggal_penerimaan, supplier_id, vendor_id"
    )
    .eq("id", opts.grnId)
    .single();
  if (grnError || !grn) throw ApiError.notFound("GRN tidak ditemukan");

  const poId = (grn.purchase_order_id as string | null) || null;
  let vendorId = (grn.vendor_id as string | null) || null;
  let supplierId = (grn.supplier_id as string | null) || null;
  let dueDate: string | null = null;

  if (poId) {
    const { data: po } = await opts.db
      .from("purchase_orders")
      .select("vendor_id, supplier_id, tanggal_kirim_estimasi, tanggal_dibutuhkan")
      .eq("id", poId)
      .maybeSingle();
    if (po) {
      vendorId = vendorId || (po.vendor_id as string | null) || null;
      supplierId = supplierId || (po.supplier_id as string | null) || null;
      const estimate =
        (po.tanggal_kirim_estimasi as string | null) ||
        (po.tanggal_dibutuhkan as string | null);
      if (estimate) {
        dueDate = String(estimate).slice(0, 10);
      }
    }
  }

  if (!vendorId && !supplierId) {
    throw ApiError.badRequest("GRN/PO tidak punya vendor atau supplier");
  }
  if (vendorId && supplierId) supplierId = null;

  const invoiceNo = await nextDocumentNo(opts.db, "ap_invoices", "AP");
  const subtotal = round2(built.amounts.SUBTOTAL || 0);
  const tax = round2(built.amounts.TAX || 0);
  const total = round2(built.amounts.TOTAL || 0);
  const now = new Date().toISOString();

  const { data: inserted, error } = await opts.db
    .from("ap_invoices")
    .insert({
      company_id: built.companyId,
      invoice_no: invoiceNo,
      invoice_date: built.entryDate,
      due_date: dueDate,
      vendor_id: vendorId,
      supplier_id: supplierId,
      purchase_order_id: poId,
      grn_id: opts.grnId,
      currency: "IDR",
      subtotal,
      tax_amount: tax,
      total_amount: total,
      status: "POSTED",
      description: `AP dari GRN ${built.nomorGrn}`,
      posted_at: now,
      posted_by: opts.userId,
      created_by: opts.userId,
      updated_by: opts.userId,
    })
    .select("*")
    .single();

  if (error) {
    if (/unique|duplicate/i.test(error.message || "")) {
      const again = await queryOne<InvoiceDbRow>(
        `SELECT * FROM accounting.ap_invoices
          WHERE grn_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [opts.grnId]
      );
      if (again) return mapInvoice({ ...again, allocated_amount: 0 });
    }
    throw error;
  }

  return mapInvoice({ ...(inserted as InvoiceDbRow), allocated_amount: 0 });
}

export async function listApInvoices(opts: {
  companyId?: string | null;
  status?: string;
  paymentStatus?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: ApInvoiceRow[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const params: unknown[] = [];
  const where: string[] = [`i.deleted_at IS NULL`];

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
      `(i.invoice_no ILIKE $${i} OR po.nomor_po ILIKE $${i} OR g.nomor_grn ILIKE $${i} OR COALESCE(v.name, s.nama_supplier, '') ILIKE $${i})`
    );
  }

  params.push(limit);
  const limitPh = `$${params.length}`;
  params.push(offset);
  const offsetPh = `$${params.length}`;

  const rows = await query<InvoiceDbRow>(
    `SELECT i.*,
            COALESCE(alloc.allocated, 0) AS allocated_amount,
            COALESCE(v.name, s.nama_supplier) AS party_name,
            po.nomor_po AS po_number,
            g.nomor_grn AS grn_number,
            COUNT(*) OVER()::int AS _total
       FROM accounting.ap_invoices i
       LEFT JOIN purchasing.purchase_orders po ON po.id = i.purchase_order_id
       LEFT JOIN purchasing.grn g ON g.id = i.grn_id
       LEFT JOIN purchasing.vendors v ON v.id = i.vendor_id
       LEFT JOIN purchasing.suppliers s ON s.id = i.supplier_id
       ${ALLOC_LATERAL}
      WHERE ${where.join(" AND ")}
      ORDER BY i.invoice_date DESC, i.created_at DESC
      LIMIT ${limitPh} OFFSET ${offsetPh}`,
    params
  );

  let mapped = rows.map((r) => mapInvoice(r));
  if (opts.paymentStatus && opts.paymentStatus !== "all") {
    mapped = mapped.filter((r) => r.payment_status === opts.paymentStatus);
  }

  const total =
    opts.paymentStatus && opts.paymentStatus !== "all"
      ? mapped.length
      : Number(rows[0]?._total ?? mapped.length);

  return { rows: mapped, total };
}

export async function getApInvoiceById(id: string): Promise<ApInvoiceRow | null> {
  const row = await queryOne<InvoiceDbRow>(
    `SELECT i.*,
            COALESCE(alloc.allocated, 0) AS allocated_amount,
            COALESCE(v.name, s.nama_supplier) AS party_name,
            po.nomor_po AS po_number,
            g.nomor_grn AS grn_number
       FROM accounting.ap_invoices i
       LEFT JOIN purchasing.purchase_orders po ON po.id = i.purchase_order_id
       LEFT JOIN purchasing.grn g ON g.id = i.grn_id
       LEFT JOIN purchasing.vendors v ON v.id = i.vendor_id
       LEFT JOIN purchasing.suppliers s ON s.id = i.supplier_id
       ${ALLOC_LATERAL}
      WHERE i.id = $1 AND i.deleted_at IS NULL`,
    [id]
  );
  return row ? mapInvoice(row) : null;
}

async function recalculateTerm(db: DbClient, termId: string) {
  const { data: term, error: termError } = await db
    .from("purchase_order_payment_terms")
    .select("id, amount, due_date")
    .eq("id", termId)
    .single();
  if (termError || !term) return;

  const { data: payments, error: paymentsError } = await db
    .from("vendor_payments")
    .select("amount")
    .eq("payment_term_id", termId)
    .eq("status", "posted");
  if (paymentsError) throw paymentsError;

  const paidAmount = (payments || []).reduce(
    (sum: number, payment: { amount?: number | string | null }) =>
      sum + Number(payment.amount || 0),
    0
  );
  const termAmount = Number(term.amount || 0);
  const dueDate = term.due_date ? new Date(`${term.due_date}T00:00:00`) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const status =
    paidAmount >= termAmount
      ? "paid"
      : paidAmount > 0
        ? "partial"
        : dueDate && dueDate < today
          ? "overdue"
          : "unpaid";

  const { error } = await db
    .from("purchase_order_payment_terms")
    .update({
      paid_amount: paidAmount,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", termId);
  if (error) throw error;
}

export async function recordApPayment(opts: {
  db: DbClient;
  userId: string;
  invoiceId: string;
  amount: number;
  paymentDate?: string;
  method?: ApPaymentMethod;
  referenceNumber?: string | null;
  notes?: string | null;
}): Promise<{
  payment: ApPaymentRow;
  invoice: ApInvoiceRow;
  journal: MappingPostResult;
  note: string | null;
}> {
  const invoice = await getApInvoiceById(opts.invoiceId);
  if (!invoice) throw ApiError.notFound("AP invoice tidak ditemukan");
  if (invoice.status !== "POSTED") {
    throw ApiError.badRequest("Hanya invoice POSTED yang bisa dibayar");
  }

  const amount = round2(opts.amount);
  if (amount <= 0) throw ApiError.badRequest("Amount pembayaran harus > 0");
  const outstanding = invoice.outstanding_amount ?? invoice.total_amount;
  if (amount > outstanding + 0.01) {
    throw ApiError.badRequest("Amount pembayaran tidak boleh melebihi outstanding");
  }

  const paymentDate = opts.paymentDate || new Date().toISOString().slice(0, 10);
  const method = opts.method || "bank_transfer";
  const paymentNo = await nextDocumentNo(opts.db, "ap_payments", "APP");
  const now = new Date().toISOString();

  let vendorPaymentId: string | null = null;
  if (invoice.purchase_order_id) {
    const ctx = await getPoPayableContext(opts.db, invoice.purchase_order_id);
    if (ctx) {
      const party = resolvePoPaymentParty(ctx);
      const termId = await resolvePaymentTermId(
        opts.db,
        invoice.purchase_order_id,
        amount,
        paymentDate
      );
      const vpNo = paymentNo.replace(/^APP-/, "VP-");
      const { data: vp, error: vpError } = await opts.db
        .from("vendor_payments")
        .insert({
          payment_number: vpNo,
          purchase_order_id: invoice.purchase_order_id,
          payment_term_id: termId,
          supplier_id: party.supplier_id,
          vendor_id: party.vendor_id,
          payment_date: paymentDate,
          amount,
          method,
          reference_number: opts.referenceNumber || null,
          notes: opts.notes
            ? `${opts.notes} (via Accounting AP ${paymentNo})`
            : `via Accounting AP ${paymentNo}`,
          status: "posted",
          created_by: opts.userId,
          updated_by: opts.userId,
        })
        .select("id")
        .single();
      if (vpError) throw vpError;
      vendorPaymentId = vp.id as string;
      await recalculateTerm(opts.db, termId);
    }
  }

  const { data: payment, error: payError } = await opts.db
    .from("ap_payments")
    .insert({
      company_id: invoice.company_id,
      payment_no: paymentNo,
      payment_date: paymentDate,
      amount,
      method,
      reference_number: opts.referenceNumber || null,
      notes: opts.notes || null,
      status: "POSTED",
      vendor_id: invoice.vendor_id,
      supplier_id: invoice.supplier_id,
      purchase_order_id: invoice.purchase_order_id,
      vendor_payment_id: vendorPaymentId,
      posted_at: now,
      posted_by: opts.userId,
      created_by: opts.userId,
      updated_by: opts.userId,
    })
    .select("*")
    .single();
  if (payError) throw payError;

  const { error: allocError } = await opts.db.from("ap_payment_allocations").insert({
    payment_id: payment.id,
    invoice_id: invoice.id,
    amount,
  });
  if (allocError) throw allocError;

  const journal = await postApPaymentJournal({
    companyId: invoice.company_id,
    userId: opts.userId,
    paymentId: payment.id as string,
    paymentNo,
    paymentDate,
    amount,
  });

  const refreshed = await getApInvoiceById(invoice.id);
  return {
    payment: {
      id: payment.id as string,
      company_id: payment.company_id as string | null,
      payment_no: paymentNo,
      payment_date: paymentDate,
      amount,
      method,
      reference_number: opts.referenceNumber || null,
      notes: opts.notes || null,
      status: "POSTED",
      vendor_id: invoice.vendor_id,
      supplier_id: invoice.supplier_id,
      purchase_order_id: invoice.purchase_order_id,
      vendor_payment_id: vendorPaymentId,
      posted_at: now,
      posted_by: opts.userId,
      created_at: payment.created_at as string,
    },
    invoice: refreshed || invoice,
    journal: journal.result,
    note: journal.note,
  };
}

export async function listApPayments(opts: {
  companyId?: string | null;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: ApPaymentRow[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const params: unknown[] = [];
  const where: string[] = [`p.deleted_at IS NULL`];

  if (opts.companyId) {
    params.push(opts.companyId);
    where.push(`p.company_id = $${params.length}`);
  }
  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim()}%`);
    const i = params.length;
    where.push(
      `(p.payment_no ILIKE $${i} OR COALESCE(v.name, s.nama_supplier, '') ILIKE $${i})`
    );
  }

  params.push(limit);
  const limitPh = `$${params.length}`;
  params.push(offset);
  const offsetPh = `$${params.length}`;

  type PayRow = {
    id: string;
    company_id: string | null;
    payment_no: string;
    payment_date: string;
    amount: string | number;
    method: string;
    reference_number: string | null;
    notes: string | null;
    status: string;
    vendor_id: string | null;
    supplier_id: string | null;
    purchase_order_id: string | null;
    vendor_payment_id: string | null;
    posted_at: string | null;
    posted_by: string | null;
    created_at: string;
    party_name: string | null;
    invoice_nos: string | null;
    _total: number;
  };

  const rows = await query<PayRow>(
    `SELECT p.*,
            COALESCE(v.name, s.nama_supplier) AS party_name,
            (
              SELECT string_agg(i.invoice_no, ', ' ORDER BY i.invoice_no)
                FROM accounting.ap_payment_allocations a
                JOIN accounting.ap_invoices i ON i.id = a.invoice_id
               WHERE a.payment_id = p.id
            ) AS invoice_nos,
            COUNT(*) OVER()::int AS _total
       FROM accounting.ap_payments p
       LEFT JOIN purchasing.vendors v ON v.id = p.vendor_id
       LEFT JOIN purchasing.suppliers s ON s.id = p.supplier_id
      WHERE ${where.join(" AND ")}
      ORDER BY p.payment_date DESC, p.created_at DESC
      LIMIT ${limitPh} OFFSET ${offsetPh}`,
    params
  );

  return {
    rows: rows.map((r) => ({
      id: r.id,
      company_id: r.company_id,
      payment_no: r.payment_no,
      payment_date: String(r.payment_date).slice(0, 10),
      amount: Number(r.amount) || 0,
      method: r.method as ApPaymentMethod,
      reference_number: r.reference_number,
      notes: r.notes,
      status: r.status as ApPaymentRow["status"],
      vendor_id: r.vendor_id,
      supplier_id: r.supplier_id,
      purchase_order_id: r.purchase_order_id,
      vendor_payment_id: r.vendor_payment_id,
      posted_at: r.posted_at,
      posted_by: r.posted_by,
      created_at: r.created_at,
      party_name: r.party_name,
      invoice_nos: r.invoice_nos ? r.invoice_nos.split(", ") : [],
    })),
    total: Number(rows[0]?._total ?? 0),
  };
}

export async function listApPayableRegister(opts: {
  companyId?: string | null;
}): Promise<ApInvoiceRow[]> {
  const { rows } = await listApInvoices({
    companyId: opts.companyId,
    status: "POSTED",
    limit: 100,
    offset: 0,
  });
  return rows.filter((r) => (r.outstanding_amount ?? 0) > 0.009);
}

export type ApAgingRow = {
  bucket: ApAgingBucket;
  invoice_count: number;
  amount: number;
};

export async function listApAging(opts: {
  companyId?: string | null;
  asOf?: string;
}): Promise<{ asOf: string; buckets: ApAgingRow[]; invoices: ApInvoiceRow[] }> {
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const open = await listApPayableRegister({ companyId: opts.companyId });
  const bucketMap = new Map<ApAgingBucket, ApAgingRow>();
  for (const b of [
    "current",
    "1_30",
    "31_60",
    "61_90",
    "90_plus",
  ] as ApAgingBucket[]) {
    bucketMap.set(b, { bucket: b, invoice_count: 0, amount: 0 });
  }
  for (const inv of open) {
    const bucket = bucketAging(
      inv.outstanding_amount || 0,
      inv.due_date,
      asOf
    );
    if (!bucket) continue;
    const row = bucketMap.get(bucket)!;
    row.invoice_count += 1;
    row.amount = round2(row.amount + (inv.outstanding_amount || 0));
  }
  return { asOf, buckets: [...bucketMap.values()], invoices: open };
}
