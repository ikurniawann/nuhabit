"use client";

import { useState, type ReactNode } from "react";
import { WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatRupiah } from "@/lib/format";
import { receiptHref, termDisplayLabel, type PODetailFigures } from "@/lib/purchasing/po-ui-detail";
import { paymentStatusBadge } from "@/lib/purchasing/po-ui-status";
import type { PurchaseOrderWithStats } from "@/types/purchasing";
import { usePurchaseOrderPayments } from "../../queries";
import { ToneBadge } from "../po-dialogs";
import { POPaymentDialog } from "./po-payment-dialog";

function InfoTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200/70 bg-gray-50/60 p-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      {children}
    </div>
  );
}

interface POPaymentCardProps {
  po: PurchaseOrderWithStats;
  figures: PODetailFigures;
}

/** Pembayaran invoice PO (konteks Account Payable): status, termin, riwayat, dan dialog bayar. */
export function POPaymentCard({ po, figures }: POPaymentCardProps) {
  const [payOpen, setPayOpen] = useState(false);
  const paymentsQuery = usePurchaseOrderPayments(po.id);
  const terms = paymentsQuery.data?.terms ?? [];
  const payments = paymentsQuery.data?.payments ?? [];
  const termById = new Map(terms.map((term) => [term.id, term]));
  const termLabel = (term: (typeof terms)[number]) => termDisplayLabel(term, figures.payableAmount);
  const hasCredits = figures.returnCreditAmount > 0 || figures.rejectCreditAmount > 0;

  return (
    <Card className="border-gray-200/70 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-gray-100 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <WalletCards className="h-5 w-5" />
          Pembayaran Invoice
        </CardTitle>
        <Button
          onClick={() => setPayOpen(true)}
          disabled={figures.outstandingAmount <= 0}
          className="purchasing-main-button no-print"
        >
          Bayar
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <InfoTile label="Status Pembayaran">
            <div className="mt-2">
              <ToneBadge tone={paymentStatusBadge(po.payment_status)} />
            </div>
          </InfoTile>
          <InfoTile label="Tagihan Bersih">
            <p className="mt-1 font-semibold text-gray-900">{formatRupiah(figures.payableAmount)}</p>
            {hasCredits && (
              <p className="mt-1 text-xs text-red-600">
                {figures.returnCreditAmount > 0 && <>Retur -{formatRupiah(figures.returnCreditAmount)}</>}
                {figures.returnCreditAmount > 0 && figures.rejectCreditAmount > 0 && " · "}
                {figures.rejectCreditAmount > 0 && <>Nota kredit reject -{formatRupiah(figures.rejectCreditAmount)}</>}
                {" dari "}Total PO {formatRupiah(figures.grossPayableAmount)}
              </p>
            )}
          </InfoTile>
          <InfoTile label="Dibayar">
            <p className="mt-1 font-semibold text-emerald-600">{formatRupiah(po.paid_amount)}</p>
          </InfoTile>
          <InfoTile label="Jatuh Tempo Berikutnya">
            <p className="mt-1 font-semibold text-gray-900">{formatDate(po.next_due_date)}</p>
          </InfoTile>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200/70">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Termin Pembayaran</th>
                <th className="px-4 py-3 text-left font-semibold">Jatuh Tempo</th>
                <th className="px-4 py-3 text-right font-semibold">Nominal</th>
                <th className="px-4 py-3 text-right font-semibold">Dibayar</th>
                <th className="px-4 py-3 text-center font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {terms.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                    Belum ada jadwal pembayaran. Gunakan <span className="font-medium text-gray-700">Bayar</span> untuk
                    mencatat pelunasan atau pembayaran sebagian, jadwal akan dibuat otomatis.
                  </td>
                </tr>
              ) : (
                terms.map((term) => {
                  const label = termLabel(term);
                  return (
                    <tr key={term.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900">{label}</div>
                        <div className="text-xs text-gray-500">
                          {label === "Lunas" ? "Pelunasan penuh" : `Cicilan ${term.term_no}`}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{formatDate(term.due_date)}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{formatRupiah(term.amount)}</td>
                      <td className="px-4 py-3 text-right text-emerald-700">{formatRupiah(term.paid_amount)}</td>
                      <td className="px-4 py-3 text-center">
                        <ToneBadge tone={paymentStatusBadge(term.status)} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {payments.length > 0 && (
          <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
            <h4 className="mb-3 font-semibold text-gray-900">Riwayat Pembayaran</h4>
            <div className="space-y-2">
              {payments.map((payment) => {
                const linkedTerm = termById.get(payment.payment_term_id || "");
                return (
                  <div
                    key={payment.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="font-semibold text-gray-900">
                        {linkedTerm ? termLabel(linkedTerm) : "Pembayaran"}
                      </span>
                      <div className="text-xs text-gray-500">
                        {payment.payment_number} · {formatDate(payment.payment_date)}
                        {payment.receipt_path && (
                          <>
                            {" · "}
                            <a
                              href={receiptHref(payment.receipt_path)}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-pink-600 hover:underline"
                            >
                              Lihat Nota
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="font-semibold text-emerald-700">{formatRupiah(payment.amount)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>

      <POPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        poId={po.id}
        paidAmount={Number(po.paid_amount || 0)}
        terms={terms}
        figures={figures}
      />
    </Card>
  );
}
