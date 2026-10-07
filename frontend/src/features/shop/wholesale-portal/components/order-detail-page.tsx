"use client";

import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { formatDate, formatDateTime, formatRupiah } from "@/lib/format";
import { useWholesaleOrder } from "../queries";
import { statusOf, TERMS_LABEL } from "./order-status";
import { orderStatusLabel } from "./orders-page";
import { useRequireAccount } from "./use-require-account";

/** /wholesale/orders/[id]: rincian satu pesanan mitra. */
export function WholesaleOrderDetailPage({ id }: { id: string }) {
  const { account, loading } = useRequireAccount();
  const order = useWholesaleOrder(id, account !== null);

  if (loading || !account || order.isPending) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-forest" />
      </div>
    );
  }
  if (order.isError || !order.data) {
    return (
      <div className="space-y-3">
        <BackLink />
        <p className="rounded-card bg-danger-soft px-4 py-3 text-sm text-danger">
          {order.error?.message || "Pesanan tidak ditemukan"}
        </p>
      </div>
    );
  }

  const detail = order.data;
  const status = statusOf(detail.status);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink />
      <section className="rounded-card bg-card p-5 shadow-card">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pesanan</p>
            <h1 className="text-xl font-bold">{detail.order_number}</h1>
            <p className="text-xs text-muted-foreground">{formatDateTime(detail.created_at)}</p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-medium ${status.tone}`}>{orderStatusLabel(detail)}</span>
        </div>

        {detail.status === "pending" && detail.invoice_url ? (
          <a
            href={detail.invoice_url}
            className="mb-4 block rounded-full bg-accent-strong px-4 py-3 text-center text-sm font-semibold text-accent-foreground hover:bg-accent-dark"
          >
            Lanjutkan Pembayaran
          </a>
        ) : null}

        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Pembayaran</dt>
            <dd>
              {TERMS_LABEL[detail.payment_terms]}
              {detail.due_at && detail.payment_terms === "pay_later" ? ` · jatuh tempo ${formatDate(detail.due_at)}` : ""}
              {detail.paid_at ? ` · dibayar ${formatDate(detail.paid_at)}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Resi</dt>
            <dd>{detail.waybill || "Belum ada"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Alamat pengiriman</dt>
            <dd className="whitespace-pre-line">{detail.shipping_address}</dd>
          </div>
          {detail.notes ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Catatan</dt>
              <dd className="whitespace-pre-line">{detail.notes}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="rounded-card bg-card p-5 shadow-card">
        <h2 className="mb-3 text-base font-semibold">Rincian</h2>
        <ul className="divide-y divide-border text-sm">
          {detail.items.map((item, index) => (
            <li key={index} className="flex items-center justify-between gap-3 py-2">
              <span>
                {item.product_name}
                {item.sku_name ? ` (${item.sku_name})` : ""}{" "}
                <span className="text-muted-foreground">× {Number(item.quantity)}</span>
                {item.is_preorder ? (
                  <span className="ml-2 rounded-full bg-accent-strong px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">
                    Pre-order
                  </span>
                ) : null}
              </span>
              <span>{formatRupiah(item.total)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span>{formatRupiah(detail.subtotal)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Ongkir</span>
            <span>{Number(detail.shipping_cost) > 0 ? formatRupiah(detail.shipping_cost) : "Diatur tim NüHabit"}</span>
          </div>
          <div className="flex justify-between text-base font-semibold">
            <span>Total</span>
            <span>{formatRupiah(detail.total)}</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/wholesale/orders" className="inline-flex items-center gap-1.5 text-sm font-medium text-forest">
      <ArrowLeft className="h-4 w-4" />
      Semua pesanan
    </Link>
  );
}
