export const AP_DOCUMENT_STATUSES = ["DRAFT", "POSTED", "VOID"] as const;
export type ApDocumentStatus = (typeof AP_DOCUMENT_STATUSES)[number];

export const AP_PAYMENT_STATUSES = [
  "unpaid",
  "partial",
  "paid",
  "overdue",
] as const;
export type ApPaymentStatus = (typeof AP_PAYMENT_STATUSES)[number];

export const AP_AGING_BUCKETS = [
  "current",
  "1_30",
  "31_60",
  "61_90",
  "90_plus",
] as const;
export type ApAgingBucket = (typeof AP_AGING_BUCKETS)[number];

export const AP_PAYMENT_METHODS = [
  "cash",
  "bank_transfer",
  "giro",
  "qris",
  "other",
] as const;
export type ApPaymentMethod = (typeof AP_PAYMENT_METHODS)[number];

export type ApInvoiceRow = {
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
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status: ApDocumentStatus;
  description: string | null;
  posted_at: string | null;
  posted_by: string | null;
  created_at: string;
  allocated_amount?: number;
  outstanding_amount?: number;
  payment_status?: ApPaymentStatus;
  party_name?: string | null;
  po_number?: string | null;
  grn_number?: string | null;
};

export type ApPaymentRow = {
  id: string;
  company_id: string | null;
  payment_no: string;
  payment_date: string;
  amount: number;
  method: ApPaymentMethod;
  reference_number: string | null;
  notes: string | null;
  status: ApDocumentStatus;
  vendor_id: string | null;
  supplier_id: string | null;
  purchase_order_id: string | null;
  vendor_payment_id: string | null;
  posted_at: string | null;
  posted_by: string | null;
  created_at: string;
  party_name?: string | null;
  invoice_nos?: string[];
};
