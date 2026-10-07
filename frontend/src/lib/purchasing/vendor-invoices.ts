import { branchScopeOr, companyScopeOr, type UserScope } from "@/lib/api/scope";
import type { DbClient } from "@/lib/pg/types";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { computePoInvoiceAmounts, getReturnCreditsByPoIds } from "@/lib/purchasing/po-payments";
import { getVendorCreditsByPoIds } from "@/lib/purchasing/vendor-credit-service";

/** Tagihan pembelian = PO yang sudah approved sampai diterima, per PO. */
const INVOICE_PO_STATUSES = ["approved", "sent", "partial", "partially_received", "received"];

export type InvoicePoRow = {
  id: string;
  nomor_po: string;
  tanggal_po: string;
  status: string;
  nama_supplier: string | null;
  vendor_name: string | null;
  payable_amount: number | string | null;
  paid_amount: number | string | null;
  payment_term_count: number | string | null;
  next_due_date: string | null;
  received_percentage: number | string | null;
};

/** Baris tagihan: nilai bruto dikurangi kredit retur + kredit vendor, lalu pembayaran. */
export function toPurchaseInvoice(
  row: InvoicePoRow,
  moduleType: PurchasingModuleType,
  credits: { returnCredit: number; rejectCredit: number }
) {
  const amounts = computePoInvoiceAmounts({
    grossPayable: Number(row.payable_amount || 0),
    returnCredit: credits.returnCredit,
    rejectCredit: credits.rejectCredit,
    paidAmount: Number(row.paid_amount || 0),
    nextDueDate: row.next_due_date,
  });

  return {
    purchase_order_id: row.id,
    nomor_po: row.nomor_po,
    tanggal_po: row.tanggal_po,
    // product & general memakai vendors; raw_material memakai suppliers.
    nama_supplier: moduleType !== "raw_material" ? row.vendor_name || row.nama_supplier : row.nama_supplier,
    po_status: row.status,
    gross_payable_amount: amounts.gross_payable_amount,
    return_credit_amount: amounts.return_credit_amount,
    reject_credit_amount: amounts.reject_credit_amount,
    total_credit_amount: amounts.total_credit_amount,
    payable_amount: amounts.payable_amount,
    paid_amount: amounts.paid_amount,
    outstanding_amount: amounts.outstanding_amount,
    payment_term_count: Number(row.payment_term_count || 0),
    payment_progress_pct: amounts.payment_progress_pct,
    received_percentage: Number(row.received_percentage || 0),
    next_due_date: row.next_due_date,
    payment_status: amounts.payment_status,
    can_pay: amounts.outstanding_amount > 0.01,
  };
}

export async function listPurchaseInvoices(
  db: DbClient,
  params: { moduleType: PurchasingModuleType; search?: string; status: string | null },
  scope: UserScope | null
) {
  let query = db
    .from("v_purchase_orders")
    .select(
      `
      id,
      nomor_po,
      tanggal_po,
      status,
      module_type,
      nama_supplier,
      vendor_name,
      payable_amount,
      paid_amount,
      outstanding_amount,
      payment_status,
      payment_progress_pct,
      payment_term_count,
      next_due_date,
      received_percentage
    `
    )
    .eq("module_type", params.moduleType)
    .in("status", INVOICE_PO_STATUSES)
    .gt("payable_amount", 0)
    .order("next_due_date", { ascending: true, nullsFirst: false });

  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);

  if (params.search) {
    const partyColumn = params.moduleType !== "raw_material" ? "vendor_name" : "nama_supplier";
    query = query.or(`nomor_po.ilike.%${params.search}%,${partyColumn}.ilike.%${params.search}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as InvoicePoRow[];
  const poIds = rows.map((row) => row.id).filter(Boolean);
  const [returnCredits, rejectCredits] = await Promise.all([
    getReturnCreditsByPoIds(db, poIds),
    getVendorCreditsByPoIds(db, poIds),
  ]);

  const invoices = rows.map((row) =>
    toPurchaseInvoice(row, params.moduleType, {
      returnCredit: returnCredits.get(row.id) || 0,
      rejectCredit: rejectCredits.get(row.id) || 0,
    })
  );
  return params.status && params.status !== "all"
    ? invoices.filter((invoice) => invoice.payment_status === params.status)
    : invoices;
}

/** Sisa tagihan PO setelah retur, kredit vendor, dan pembayaran (sama dengan daftar tagihan). */
export async function getPoOutstanding(db: DbClient, poId: string): Promise<number | null> {
  const { data: row, error } = await db
    .from("v_purchase_orders")
    .select("payable_amount, paid_amount")
    .eq("id", poId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;

  const [returnCredits, vendorCredits] = await Promise.all([
    getReturnCreditsByPoIds(db, [poId]),
    getVendorCreditsByPoIds(db, [poId]),
  ]);
  return computePoInvoiceAmounts({
    grossPayable: Number(row.payable_amount || 0),
    returnCredit: returnCredits.get(poId) || 0,
    rejectCredit: vendorCredits.get(poId) || 0,
    paidAmount: Number(row.paid_amount || 0),
  }).outstanding_amount;
}
