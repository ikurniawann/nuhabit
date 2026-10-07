"use client";

import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import { Loader2, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useDealPayments } from "../queries";

/**
 * Pembayaran deal — READ-ONLY di pipeline (EPIC-025 Opsi B): pencatatan
 * dilakukan modul Finance per invoice; sales memantau progress pelunasan
 * vs termin quotation (waterfall) + riwayat di sini.
 */

const METHOD_LABELS: Record<string, string> = {
  cash: "Tunai",
  transfer: "Transfer",
  qris: "QRIS",
  edc: "Kartu / EDC",
  lainnya: "Lainnya",
};

const TERM_BADGES: Record<string, string> = {
  lunas: "bg-emerald-100 text-emerald-700",
  sebagian: "bg-amber-100 text-amber-700",
  belum: "bg-gray-100 text-gray-500",
};

export function PaymentSection({
  dealId,
  enabled,
}: {
  dealId: string;
  enabled: boolean;
}) {
  const paymentsQuery = useDealPayments(dealId, enabled);
  const data = paymentsQuery.data;
  const progressPct =
    data && data.summary.reference_total > 0
      ? Math.min(
          100,
          Math.round((data.summary.total_paid / data.summary.reference_total) * 100)
        )
      : 0;

  return (
    <div className="space-y-3 border-b border-gray-100 px-6 py-4">
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Wallet className="h-4 w-4 text-pink-500" />
          Pembayaran
        </p>
        <span className="text-xs text-gray-400">dicatat oleh Finance</span>
      </div>

      {paymentsQuery.isLoading || !data ? (
        <div className="py-4 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-pink-600" />
        </div>
      ) : (
        <>
          {/* Progress pelunasan */}
          <div className="rounded-xl border border-gray-200/80 p-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-gray-600">
                Terbayar{" "}
                <span className="font-semibold text-gray-900">
                  {formatRupiah(data.summary.total_paid)}
                </span>{" "}
                dari {formatRupiah(data.summary.reference_total)}
                {data.summary.reference_quote_number ? (
                  <span className="ml-1 text-xs text-gray-400">
                    ({data.summary.reference_quote_number}
                    {data.summary.reference_is_accepted ? " · diterima" : ""})
                  </span>
                ) : null}
              </span>
              <span className="text-sm font-bold text-gray-900">{progressPct}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full ${
                  progressPct >= 100 ? "bg-emerald-500" : "bg-pink-500"
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {data.summary.outstanding > 0 ? (
              <p className="mt-1.5 text-xs text-gray-500">
                Sisa tagihan:{" "}
                <span className="font-semibold text-gray-800">
                  {formatRupiah(data.summary.outstanding)}
                </span>
              </p>
            ) : data.summary.reference_total > 0 ? (
              <p className="mt-1.5 text-xs font-medium text-emerald-600">
                Lunas ✓
              </p>
            ) : null}

            {/* Status per termin (waterfall dari total pembayaran) */}
            {data.terms.length > 0 ? (
              <div className="mt-2.5 space-y-1.5">
                {data.terms.map((term, index) => (
                  <div
                    key={index}
                    className="flex flex-wrap items-center gap-2 text-xs"
                  >
                    <Badge className={`border-0 font-normal ${TERM_BADGES[term.status]}`}>
                      {term.status}
                    </Badge>
                    <span className="font-medium text-gray-800">
                      {term.label} ({formatNumber(term.percent, 3)}%)
                    </span>
                    <span className="text-gray-500">
                      {formatRupiah(term.paid)} / {formatRupiah(term.amount)}
                    </span>
                    {term.due_date ? (
                      <span className="ml-auto text-gray-400">
                        jatuh tempo {formatDate(term.due_date, "")}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Riwayat */}
          {data.payments.length > 0 ? (
            <ul className="space-y-1.5">
              {data.payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex items-center gap-2 rounded-lg border border-gray-200/70 px-3 py-2 text-sm"
                >
                  <span className="font-semibold text-gray-900">
                    {formatRupiah(payment.amount)}
                  </span>
                  <Badge className="border-0 bg-gray-100 font-normal text-gray-600">
                    {METHOD_LABELS[payment.method] ?? payment.method}
                  </Badge>
                  {payment.invoice_number ? (
                    <Badge className="border-0 bg-blue-50 font-normal text-blue-700">
                      {payment.invoice_number}
                    </Badge>
                  ) : null}
                  <span className="text-xs text-gray-500">
                    {formatDate(payment.paid_on, "")}
                    {payment.note ? ` · ${payment.note}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">
              Belum ada pembayaran tercatat oleh Finance.
            </p>
          )}
        </>
      )}
    </div>
  );
}
