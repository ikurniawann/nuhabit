import type { ApAgingBucket, ApPaymentStatus } from "@/lib/accounting/ap-types";

export type ArInvoiceRow = {
  id: string;
  company_id: string | null;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  customer_name: string | null;
  sales_invoice_id: string | null;
  deal_id: string | null;
  currency: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status: "DRAFT" | "POSTED" | "VOID";
  description: string | null;
  posted_at: string | null;
  posted_by: string | null;
  created_at: string;
  allocated_amount?: number;
  outstanding_amount?: number;
  payment_status?: ApPaymentStatus;
  deal_title?: string | null;
};

export type ArReceiptRow = {
  id: string;
  company_id: string | null;
  receipt_no: string;
  receipt_date: string;
  amount: number;
  method: string;
  reference_number: string | null;
  notes: string | null;
  status: "DRAFT" | "POSTED" | "VOID";
  deal_payment_id: string | null;
  posted_at: string | null;
  posted_by: string | null;
  created_at: string;
  customer_name?: string | null;
  invoice_nos?: string[];
};

export type ArAgingBucket = ApAgingBucket;
export type ArPaymentStatus = ApPaymentStatus;

export const AR_RECEIPT_METHODS = [
  "cash",
  "transfer",
  "qris",
  "edc",
  "lainnya",
] as const;
export type ArReceiptMethod = (typeof AR_RECEIPT_METHODS)[number];
