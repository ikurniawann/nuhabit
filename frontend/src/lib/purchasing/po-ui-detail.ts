/** Perhitungan tampilan halaman detail PO bahan baku: progres, tagihan, termin, pembayaran. */
import type { ApInvoiceRow } from "@/lib/accounting/ap-types";
import { formatRupiah } from "@/lib/format";
import type {
  PurchaseOrderPaymentTerm,
  PurchaseOrderWithStats,
  VendorPayment,
} from "@/types/purchasing";

/** Selisih pembulatan rupiah yang masih dianggap lunas. */
const PAID_TOLERANCE = 0.01;

const num = (value: unknown) => Number(value ?? 0) || 0;

export interface PODetailFigures {
  orderProgress: number;
  receiptProgress: number;
  qcProgress: number;
  returnProgress: number;
  overallProgress: number;
  paymentProgress: number;
  payableAmount: number;
  grossPayableAmount: number;
  returnCreditAmount: number;
  rejectCreditAmount: number;
  outstandingAmount: number;
}

/** Angka progres & tagihan PO; fallback dipakai bila API lama belum mengirim kolom turunan. */
export function poDetailFigures(po: PurchaseOrderWithStats): PODetailFigures {
  const receivingProgress = num(po.received_percentage ?? po.receive_percentage ?? po.progress_pct);
  const orderProgress = num(po.order_progress_pct);
  const receiptProgress = num(po.receipt_progress_pct ?? receivingProgress);
  const qcProgress = num(po.qc_progress_pct);
  const returnProgress = num(po.return_progress_pct);
  const overallProgress = num(
    po.fulfillment_progress_pct ?? (orderProgress + receiptProgress + qcProgress + returnProgress) / 4
  );
  const payableAmount = num(po.payable_amount ?? po.gross_payable_amount ?? po.grand_total);
  const returnCreditAmount = num(po.return_credit_amount);
  const rejectCreditAmount = num(po.reject_credit_amount);
  const grossPayableAmount = num(
    po.gross_payable_amount ?? payableAmount + returnCreditAmount + rejectCreditAmount
  );
  const outstandingAmount = Math.max(0, num(po.outstanding_amount ?? payableAmount - num(po.paid_amount)));

  return {
    orderProgress,
    receiptProgress,
    qcProgress,
    returnProgress,
    overallProgress,
    paymentProgress: num(po.payment_progress_pct),
    payableAmount,
    grossPayableAmount,
    returnCreditAmount,
    rejectCreditAmount,
    outstandingAmount,
  };
}

export interface POFinancialBreakdown {
  subtotal: number;
  discount: number;
  ppnPercent: number;
  ppnAmount: number;
  total: number;
}

type BreakdownItem = { subtotal?: number | null; qty_ordered: number; harga_satuan: number; diskon_item?: number | null };

/** Ringkasan subtotal/diskon/PPN/total; dihitung dari item bila header PO masih 0. */
export function poFinancialBreakdown(po: {
  subtotal?: number;
  diskon_nominal?: number;
  ppn_persen?: number;
  ppn_nominal?: number;
  grand_total?: number;
  items?: BreakdownItem[];
}): POFinancialBreakdown {
  const subtotalFromItems = (po.items ?? []).reduce(
    (sum, item) => sum + (item.subtotal || item.qty_ordered * item.harga_satuan - (item.diskon_item || 0)),
    0
  );
  const subtotal = po.subtotal && po.subtotal > 0 ? po.subtotal : subtotalFromItems;
  const discount = po.diskon_nominal || 0;
  const ppnPercent = po.ppn_persen || 0;
  const ppnAmount =
    po.ppn_nominal && po.ppn_nominal > 0 ? po.ppn_nominal : Math.round(((subtotal - discount) * ppnPercent) / 100);
  const total = po.grand_total && po.grand_total > 0 ? po.grand_total : subtotal - discount + ppnAmount;
  return { subtotal, discount, ppnPercent, ppnAmount, total };
}

export function orderProgressDetail(status: string | undefined): string {
  if (status === "draft") return "Draf, menunggu persetujuan";
  if (status === "approved") return "Disetujui, belum dikirim";
  if (status === "cancelled") return "Dibatalkan";
  return "Pesanan dikonfirmasi dan dikirim";
}

// Deskripsi termin disimpan apa adanya dan sebagian dibuat server dalam bahasa Inggris,
// jadi label default diterjemahkan saat ditampilkan saja.
export function localizeTermDescription(description: string): string {
  if (/^paid in full$/i.test(description)) return "Lunas";
  if (/^down payment$/i.test(description)) return "Uang Muka";
  const installment = description.match(/^(?:installment|payment term)\s*(\d+)$/i);
  if (installment) return `Cicilan ${installment[1]}`;
  return description;
}

export function termDisplayLabel(
  term: Pick<PurchaseOrderPaymentTerm, "description" | "amount" | "term_no">,
  payableAmount: number
): string {
  const description = term.description?.trim();
  if (!description) return `Cicilan ${term.term_no}`;
  if (/^down payment$/i.test(description) && num(term.amount) >= payableAmount - PAID_TOLERANCE) return "Lunas";
  return localizeTermDescription(description);
}

/** Sisa tagihan bersih yang belum masuk jadwal termin mana pun. */
export function schedulableAmount(payableAmount: number, terms: Pick<PurchaseOrderPaymentTerm, "amount">[]): number {
  const scheduled = terms.reduce((sum, term) => sum + num(term.amount), 0);
  return Math.max(0, num(payableAmount) - scheduled);
}

/** Termin yang belum dibayar sama sekali boleh dihapus dari jadwal. */
export function canRemoveTerm(term: Pick<PurchaseOrderPaymentTerm, "paid_amount" | "status">): boolean {
  return num(term.paid_amount) <= 0 && (term.status === "unpaid" || term.status === "overdue");
}

export interface TermFormValues {
  description: string;
  due_date: string;
  amount: number | undefined;
  notes: string;
}

export function validateTermForm(form: TermFormValues, schedulable: number): string | null {
  const amount = num(form.amount);
  if (!form.due_date || amount <= 0) return "Masukkan jatuh tempo dan nominal termin";
  if (amount > schedulable + PAID_TOLERANCE) {
    return `Nominal termin tidak boleh melebihi sisa yang belum dijadwalkan (${formatRupiah(schedulable)})`;
  }
  return null;
}

/** Invoice AP PO (satu per GRN) yang masih punya sisa tagihan, terlama dulu; hanya ini yang bisa dibayar. */
export function openApInvoices<T extends Pick<ApInvoiceRow, "outstanding_amount" | "invoice_date">>(invoices: T[]): T[] {
  return invoices
    .filter((invoice) => num(invoice.outstanding_amount) > PAID_TOLERANCE)
    .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date));
}

export interface PaymentFormValues {
  invoice_id: string;
  payment_date: string;
  amount: number | undefined;
  method: VendorPayment["method"];
  reference_number: string;
  notes: string;
}

/** Nilai awal dialog bayar: invoice AP terlama yang terbuka, nominal = sisa tagihannya. */
export function defaultPaymentForm(
  invoices: Pick<ApInvoiceRow, "id" | "outstanding_amount">[],
  today: string
): PaymentFormValues {
  const first = invoices[0];
  const outstanding = num(first?.outstanding_amount);
  return {
    invoice_id: first?.id ?? "",
    payment_date: today,
    amount: outstanding > 0 ? outstanding : undefined,
    method: "bank_transfer",
    reference_number: "",
    notes: "",
  };
}

export function validatePaymentForm(form: PaymentFormValues, outstandingAmount: number): string | null {
  const amount = num(form.amount);
  if (!form.payment_date || amount <= 0) return "Masukkan tanggal dan nominal pembayaran";
  if (amount > outstandingAmount + PAID_TOLERANCE) {
    return `Nominal pembayaran tidak boleh melebihi sisa tagihan (${formatRupiah(outstandingAmount)})`;
  }
  return null;
}

/** "full" bila nominal menutup sisa tagihan, "installment" bila sebagian, null bila kosong. */
export function paymentKind(amount: number | undefined, outstandingAmount: number): "full" | "installment" | null {
  const value = num(amount);
  if (value <= 0) return null;
  return value >= outstandingAmount - PAID_TOLERANCE ? "full" : "installment";
}

/** URL arsip nota pembayaran di bucket privat. */
export function receiptHref(receiptPath: string): string {
  const path = receiptPath
    .replace(/^purchasing-receipts\//, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `/api/purchasing/receipts/${path}`;
}

/** Tanggal hari ini "YYYY-MM-DD" untuk nilai awal input tanggal (UTC, sama seperti sebelumnya). */
export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
