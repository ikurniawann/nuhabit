import { printThermalReceipt, type ReceiptPayload } from "@/components/pos/PrintReceipt";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import { gymCreditsApi, METHOD_LABELS, type PurchaseReceipt } from "./api";

/** Struk POS menyisipkan teks mentah ke jendela cetak: buang karakter HTML dari data member. */
const plain = (value: string | null | undefined) => (value ?? "").replace(/[<>&"]/g, "");

/** Struk paket gym dalam format struk pelanggan POS. */
export function gymReceiptPayload(r: PurchaseReceipt): ReceiptPayload {
  const what = r.kind === "pass" ? `Pass ${formatNumber(r.validity_days)} hari` : `${formatNumber(r.credits)} kredit`;
  const notes = [
    r.paid_at && `Dibayar ${formatDateTime(r.paid_at)}`,
    r.branch_name && `Cabang ${r.branch_name}`,
    r.cashier_name && `Kasir ${r.cashier_name}`,
    r.shift_number && `Shift ${r.shift_number}`,
    r.status === "refunded" &&
      `DIREFUND ${formatRupiah(r.refunded_idr ?? 0)}${r.refunded_at ? ` pada ${formatDateTime(r.refunded_at)}` : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    receiptNumber: r.receipt_number,
    orderType: "Paket gym",
    table: null,
    items: [{ id: r.purchase_id, productId: r.purchase_id, name: plain(`${r.package_name} (${what})`), price: r.price_idr, quantity: 1 }],
    notes: plain(notes),
    subtotal: r.price_idr,
    discountAmount: r.discount_idr,
    taxAmount: 0,
    total: r.total_idr,
    change: 0,
    paymentMethod: r.payment_method ? METHOD_LABELS[r.payment_method] : "-",
    customerName: plain(r.member_name) || undefined,
    // Dikirim server per cabang: struk tidak perlu membaca pengaturan POS.
    receiptHeader: r.header_lines,
    receiptFooter: r.footer_lines,
  };
}

/** Cetak (atau cetak ulang) struk pembelian: printer thermal, RawBT, atau dialog cetak/PDF browser. */
export async function printPurchaseReceipt(purchaseId: string) {
  const receipt = await gymCreditsApi.receipt(purchaseId);
  await printThermalReceipt(gymReceiptPayload(receipt), "CUSTOMER");
}
