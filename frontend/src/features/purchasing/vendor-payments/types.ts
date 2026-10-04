export type PurchaseInvoicePaymentStatus = "unpaid" | "partial" | "paid" | "overdue";

/** @deprecated Use PurchaseInvoicePaymentStatus */
export type VendorPaymentStatus = PurchaseInvoicePaymentStatus;

export interface PurchaseInvoiceRow {
  purchase_order_id: string;
  nomor_po: string;
  tanggal_po?: string | null;
  nama_supplier?: string | null;
  po_status?: string | null;
  gross_payable_amount: number;
  return_credit_amount: number;
  reject_credit_amount: number;
  total_credit_amount: number;
  payable_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  payment_term_count: number;
  payment_progress_pct: number;
  received_percentage?: number;
  next_due_date?: string | null;
  payment_status: PurchaseInvoicePaymentStatus;
  can_pay: boolean;
}

/** @deprecated Use PurchaseInvoiceRow */
export type VendorPaymentRow = PurchaseInvoiceRow;

export interface PurchaseInvoiceListParams {
  search?: string;
  status?: PurchaseInvoicePaymentStatus | "all";
  module_type?: "raw_material" | "product" | "general";
}

/** @deprecated Use PurchaseInvoiceListParams */
export type VendorPaymentListParams = PurchaseInvoiceListParams;
