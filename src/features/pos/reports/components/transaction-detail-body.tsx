import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { compReceiptLabel } from "@/lib/pos/comp-orders";
import { idrToArk } from "@/lib/pos/loyalty-settings";
import { useLoyaltySettings } from "@/features/pos/loyalty-settings";
import type { TransactionReportRow } from "@/lib/pos/reports/types";
import { orderCustomerLabel, orderCustomerPhone } from "@/lib/pos/order-customer";
import {
  formatKitchenStatusLabel,
  formatOrderTypeLabel,
  formatPaymentMethodLabel,
  formatPaymentStatusLabel,
  formatSoldFromLabel,
  formatXenditPaymentLabel,
  formatXenditSettlementNote,
  isPaidPaymentStatus,
  isQrisPaymentMethod,
  resolveXenditExternalId,
} from "@/lib/pos/reports/transaction-labels";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";

const formatQty = (value: number) => formatNumber(value, 2);

type OrderItemDetail = {
  id: string;
  product_name?: string | null;
  product_sku?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  total_amount?: number | string | null;
  discount_type?: string | null;
  discount_value?: number | string | null;
  discount_amount?: number | string | null;
  variants?: Array<{ name?: string | null }>;
  modifiers?: Array<{ name?: string | null }>;
};

export type TransactionOrderDetail = {
  id: string;
  order_number?: string | null;
  ordered_at?: string | null;
  queue_number?: string | null;
  order_type?: string | null;
  notes?: string | null;
  subtotal?: number | string | null;
  discount_amount?: number | string | null;
  tax_amount?: number | string | null;
  service_charge_amount?: number | string | null;
  total_amount?: number | string | null;
  amount_paid?: number | string | null;
  change_amount?: number | string | null;
  ark_coins_used?: number | string | null;
  payment_method?: string | null;
  payment_method_code?: string | null;
  payment_method_name?: string | null;
  payment_status?: string | null;
  status?: string | null;
  sold_from?: string | null;
  checkout_id?: string | null;
  checkout_number?: string | null;
  xendit_external_id?: string | null;
  xendit_qr_id?: string | null;
  items?: OrderItemDetail[];
  customer?: {
    name?: string | null;
    phone?: string | null;
    membership_tier?: string | null;
  } | null;
  /** Kontak pemesan self-order (tamu). */
  contact_name?: string | null;
  contact_phone?: string | null;
  void_reason?: string | null;
  voided_at?: string | null;
  created_by_name?: string | null;
  voided_by_name?: string | null;
  manual_discount_type?: string | null;
  manual_discount_value?: number | string | null;
  stall_name?: string | null;
  stall_code?: string | null;
  /** EPIC-043 — komplimen + penyetuju (owner comp). */
  comp_type?: string | null;
  comp_approved_name?: string | null;
};

/**
 * Label diskon dengan persennya (EPIC-041 task 5): tipe percent → "Diskon (10%)",
 * selain itu tetap "Diskon". Value persen dari kasir bisa string numerik.
 */
export function discountLabel(
  type?: string | null,
  value?: number | string | null
): string {
  const pct = Number(value);
  if (type === "percent" && Number.isFinite(pct) && pct > 0) {
    const rounded = Number.isInteger(pct) ? pct : Math.round(pct * 100) / 100;
    return `Diskon (${rounded}%)`;
  }
  return "Diskon";
}

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function DetailField({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200/70 bg-card">
      <h3 className="border-b border-gray-200/70 px-3 py-2 text-sm font-semibold text-foreground">
        {title}
      </h3>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function TransactionDetailBody({
  row,
  detail,
  items,
}: {
  row: TransactionReportRow | null;
  detail: TransactionOrderDetail | null;
  items: OrderItemDetail[];
}) {
  const paymentStatus = detail?.payment_status ?? row?.payment_status;
  const kitchenStatus = detail?.status ?? row?.status;
  const paymentMethod = detail?.payment_method || row?.payment_method;
  const paymentMethodLabel = formatPaymentMethodLabel(paymentMethod, {
    code: detail?.payment_method_code || row?.payment_method_code,
    name: detail?.payment_method_name || row?.payment_method_name,
  });
  const paid = isPaidPaymentStatus(paymentStatus, kitchenStatus);
  // Pembayaran ARK Coin (owner 2026-09-04): tampilkan juga nilai ARK-nya —
  // kurs dari pengaturan loyalitas (1 ARK = Rp ark_rate).
  const arkUsed = toNumber(detail?.ark_coins_used ?? row?.ark_coins_used);
  const isArkPayment =
    String(paymentMethod || "").toLowerCase() === "ark_coin" || arkUsed > 0;
  const { data: loyaltySettings } = useLoyaltySettings(isArkPayment);
  const arkRate = loyaltySettings?.ark_rate || 1000;
  const arkText = (idr: number) =>
    `${formatNumber(idrToArk(idr, arkRate), 2)} ARK`;
  const showXendit = isQrisPaymentMethod(paymentMethod);
  const externalId = resolveXenditExternalId({
    storedExternalId: detail?.xendit_external_id || row?.xendit_external_id,
  });
  const qrId = detail?.xendit_qr_id || row?.xendit_qr_id || null;

  return (
    <div className="space-y-4">
      <SectionCard title="Transaksi">
        <dl className="grid gap-3 sm:grid-cols-3">
          <DetailField
            label="Nomor order"
            value={detail?.order_number || row?.order_number || row?.id.slice(0, 8) || "—"}
          />
          <DetailField
            label="Waktu"
            value={formatDateTime(detail?.ordered_at ?? row?.ordered_at)}
          />
          <DetailField
            label="Stall"
            value={
              detail?.stall_name?.trim() ||
              detail?.stall_code?.trim() ||
              (row ? formatStallName(row) : "—")
            }
          />
          <DetailField
            label="Tipe"
            value={formatOrderTypeLabel(detail?.order_type)}
          />
          <DetailField label="Antrian" value={detail?.queue_number || "—"} />
          <DetailField
            label="Pelanggan"
            value={orderCustomerLabel(detail)}
          />
          <DetailField label="Kasir" value={detail?.created_by_name || "—"} />
          {(detail?.comp_type ?? row?.comp_type) ? (
            <DetailField
              label="Komplimen"
              value={
                <span className="font-semibold text-amber-700">
                  {compReceiptLabel(
                    detail?.comp_type ?? row?.comp_type,
                    detail?.comp_approved_name ?? row?.comp_approved_name
                  )}
                </span>
              }
            />
          ) : null}
          {orderCustomerPhone(detail) ? (
            <DetailField label="Telepon" value={orderCustomerPhone(detail) ?? ""} />
          ) : null}
          {detail?.customer?.membership_tier ? (
            <DetailField
              label="Tier"
              value={detail.customer.membership_tier}
            />
          ) : null}
          <DetailField
            label="Sumber jual"
            value={formatSoldFromLabel(detail?.sold_from ?? row?.sold_from)}
          />
          <DetailField
            label="Checkout"
            value={detail?.checkout_number || row?.checkout_number || "—"}
          />
          <DetailField
            label="Status dapur"
            value={formatKitchenStatusLabel(kitchenStatus)}
          />
          {detail?.notes ? (
            <DetailField label="Catatan" value={detail.notes} className="sm:col-span-3" />
          ) : null}
        </dl>
      </SectionCard>

      {detail?.void_reason || detail?.voided_at || detail?.voided_by_name ? (
        <SectionCard title="Void">
          <dl className="grid gap-3 sm:grid-cols-3">
            <DetailField
              label="Waktu void"
              value={formatDateTime(detail?.voided_at)}
            />
            <DetailField
              label="Dibuat oleh"
              value={detail?.created_by_name || "—"}
            />
            <DetailField
              label="Divoid oleh"
              value={detail?.voided_by_name || "—"}
            />
            <DetailField
              label="Alasan"
              value={detail?.void_reason || "—"}
              className="sm:col-span-3"
            />
          </dl>
        </SectionCard>
      ) : null}

      <SectionCard title="Pembayaran">
        <dl className="grid gap-3 sm:grid-cols-3">
          <DetailField
            label="Status"
            value={
              <Badge
                variant="outline"
                className={
                  paid
                    ? "border-emerald-200/80 bg-emerald-50 text-emerald-800"
                    : "border-amber-200/80 bg-amber-50 text-amber-800"
                }
              >
                {formatPaymentStatusLabel(paymentStatus, kitchenStatus)}
              </Badge>
            }
          />
          <DetailField label="Metode" value={paymentMethodLabel} />
          <DetailField
            label="Total"
            value={
              isArkPayment ? (
                <span>
                  {formatRupiah(toNumber(detail?.total_amount ?? row?.total_amount))}
                  <span className="ml-2 text-xs font-semibold text-amber-700">
                    {arkText(toNumber(detail?.total_amount ?? row?.total_amount))}
                  </span>
                </span>
              ) : (
                formatRupiah(toNumber(detail?.total_amount ?? row?.total_amount))
              )
            }
          />
          <DetailField
            label="Subtotal"
            value={formatRupiah(toNumber(detail?.subtotal))}
          />
          <DetailField
            label={discountLabel(detail?.manual_discount_type, detail?.manual_discount_value)}
            value={formatRupiah(toNumber(detail?.discount_amount))}
          />
          <DetailField
            label="Pajak"
            value={formatRupiah(toNumber(detail?.tax_amount))}
          />
          <DetailField
            label="Service"
            value={formatRupiah(toNumber(detail?.service_charge_amount))}
          />
          <DetailField
            label="Dibayar"
            value={formatRupiah(toNumber(detail?.amount_paid))}
          />
          <DetailField
            label="Kembalian"
            value={formatRupiah(toNumber(detail?.change_amount))}
          />
          <DetailField
            label="ARK digunakan"
            value={
              arkUsed > 0 ? (
                <span>
                  {formatRupiah(arkUsed)}
                  <span className="ml-2 text-xs font-semibold text-amber-700">{arkText(arkUsed)}</span>
                </span>
              ) : (
                formatRupiah(arkUsed)
              )
            }
            className="sm:col-span-3"
          />
        </dl>
      </SectionCard>

      {showXendit ? (
        <SectionCard title="Xendit (QRIS)">
          <dl className="grid gap-3 sm:grid-cols-2">
            <DetailField
              label="Status pembayaran"
              value={
                <Badge
                  variant="outline"
                  className={
                    paid
                      ? "border-emerald-200/80 bg-emerald-50 text-emerald-800"
                      : "border-amber-200/80 bg-amber-50 text-amber-800"
                  }
                >
                  {formatXenditPaymentLabel(paymentStatus, kitchenStatus)}
                </Badge>
              }
            />
            <DetailField
              label="Cair ke rekening"
              value={formatXenditSettlementNote()}
            />
            <DetailField
              label="External ID"
              value={
                <span className="break-all font-mono text-xs">
                  {externalId || "Tidak tersimpan"}
                </span>
              }
            />
            <DetailField
              label="QR ID"
              value={
                <span className="break-all font-mono text-xs">
                  {qrId || "Tidak tersimpan"}
                </span>
              }
            />
          </dl>
        </SectionCard>
      ) : null}

      <SectionCard title="Item terjual">
        <div className="overflow-x-auto rounded-lg border border-gray-200/70">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-200/70 bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">Produk</th>
                <th className="px-3 py-2.5 text-left font-semibold">SKU</th>
                <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                <th className="px-3 py-2.5 text-right font-semibold">Harga</th>
                <th className="px-3 py-2.5 text-right font-semibold">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200/70">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    Tidak ada item
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2.5 font-medium text-foreground">
                      <div>{item.product_name || "—"}</div>
                      {item.variants?.length || item.modifiers?.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(item.variants || []).map((variant, index) =>
                            variant.name ? (
                              <Badge
                                key={`v-${index}`}
                                variant="secondary"
                                className="bg-primary/10 text-xs text-brand-text"
                              >
                                {variant.name}
                              </Badge>
                            ) : null
                          )}
                          {(item.modifiers || []).map((modifier, index) =>
                            modifier.name ? (
                              <Badge
                                key={`m-${index}`}
                                variant="secondary"
                                className="bg-amber-50 text-xs text-amber-800"
                              >
                                {modifier.name}
                              </Badge>
                            ) : null
                          )}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {item.product_sku || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right">{formatQty(toNumber(item.quantity))}</td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground">
                      <div>{formatRupiah(toNumber(item.unit_price))}</div>
                      {isArkPayment ? (
                        <div className="text-xs text-amber-700">{arkText(toNumber(item.unit_price))}</div>
                      ) : null}
                      {toNumber(item.discount_amount) > 0 ? (
                        <div className="text-xs text-rose-600">
                          {item.discount_type === "percent" &&
                          toNumber(item.discount_value) > 0
                            ? `diskon ${toNumber(item.discount_value)}%`
                            : `diskon ${formatRupiah(toNumber(item.discount_amount))}`}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      <div>{formatRupiah(toNumber(item.total_amount))}</div>
                      {isArkPayment ? (
                        <div className="text-xs font-normal text-amber-700">{arkText(toNumber(item.total_amount))}</div>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatStallName(row: Pick<TransactionReportRow, "stall_name" | "stall_code">) {
  const name = row.stall_name?.trim();
  if (name && !UUID_RE.test(name)) return name;
  const code = row.stall_code?.trim();
  if (code && !UUID_RE.test(code)) return code;
  return "—";
}
