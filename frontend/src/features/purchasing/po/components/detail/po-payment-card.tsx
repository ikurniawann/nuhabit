"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarPlus, Trash2, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useApInvoiceList } from "@/features/accounting/ap/queries";
import { formatDate, formatRupiah } from "@/lib/format";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";
import {
  canRemoveTerm,
  openApInvoices,
  receiptHref,
  schedulableAmount,
  termDisplayLabel,
  type PODetailFigures,
} from "@/lib/purchasing/po-ui-detail";
import { paymentStatusBadge } from "@/lib/purchasing/po-ui-status";
import type { PurchaseOrderPaymentTerm, PurchaseOrderWithStats } from "@/types/purchasing";
import { useDeletePaymentTerm } from "../../mutations";
import { usePurchaseOrderPayments } from "../../queries";
import { ToneBadge } from "../po-dialogs";
import { POPaymentDialog } from "./po-payment-dialog";
import { POTermDialog } from "./po-term-dialog";

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
  const [termOpen, setTermOpen] = useState(false);
  const [removingTerm, setRemovingTerm] = useState<PurchaseOrderPaymentTerm | null>(null);
  const paymentsQuery = usePurchaseOrderPayments(po.id);
  const deleteTerm = useDeletePaymentTerm();
  const terms = paymentsQuery.data?.terms ?? [];
  const payments = paymentsQuery.data?.payments ?? [];
  const termById = new Map(terms.map((term) => [term.id, term]));
  const termLabel = (term: (typeof terms)[number]) => termDisplayLabel(term, figures.payableAmount);
  const hasCredits = figures.returnCreditAmount > 0 || figures.rejectCreditAmount > 0;
  const schedulable = schedulableAmount(figures.payableAmount, terms);
  const nextTermNo = Math.max(0, ...terms.map((term) => term.term_no)) + 1;
  // Pembayaran masuk lewat invoice AP yang dibuat saat GRN PO ini diposting.
  const invoicesQuery = useApInvoiceList({ purchase_order_id: po.id, status: "POSTED", limit: 100 });
  const allInvoices = invoicesQuery.data?.data ?? [];
  const payableInvoices = openApInvoices(allInvoices);
  const missingInvoice = invoicesQuery.isSuccess && payableInvoices.length === 0 && figures.outstandingAmount > 0;

  const handleRemoveTerm = async () => {
    if (!removingTerm) return;
    try {
      await deleteTerm.mutateAsync({ poId: po.id, termId: removingTerm.id });
      toast.success("Termin pembayaran dihapus");
      setRemovingTerm(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus termin pembayaran");
    }
  };

  return (
    <Card className="border-gray-200/70 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-gray-100 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <WalletCards className="h-5 w-5" />
          Pembayaran Invoice
        </CardTitle>
        <div className="no-print flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setTermOpen(true)}
            disabled={schedulable <= 0}
            className="purchasing-secondary-button"
          >
            <CalendarPlus className="mr-2 h-4 w-4" />
            Tambah Termin
          </Button>
          <Button
            onClick={() => setPayOpen(true)}
            disabled={payableInvoices.length === 0}
            className="purchasing-main-button"
          >
            Bayar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {missingInvoice && (
          <div className="no-print rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {allInvoices.length === 0
              ? "Belum ada invoice AP untuk PO ini. Invoice dibuat otomatis saat GRN PO ini diposting."
              : "Invoice AP yang ada sudah lunas. Sisa tagihan bisa dibayar setelah GRN berikutnya diposting."}{" "}
            <Link href={RM_ROUTES.purchasingGrn} className="font-medium underline">
              Buka Penerimaan Barang (GRN)
            </Link>
          </div>
        )}
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
                <th className="no-print px-4 py-3">
                  <span className="sr-only">Aksi</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {terms.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
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
                      <td className="no-print px-4 py-3 text-right">
                        {canRemoveTerm(term) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setRemovingTerm(term)}
                            aria-label={`Hapus termin ${label}`}
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
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

      <POPaymentDialog open={payOpen} onOpenChange={setPayOpen} invoices={payableInvoices} />
      <POTermDialog
        key={termOpen ? `term-${nextTermNo}` : "term-closed"}
        open={termOpen}
        onOpenChange={setTermOpen}
        poId={po.id}
        nextTermNo={nextTermNo}
        schedulable={schedulable}
      />
      <ConfirmDialog
        open={removingTerm !== null}
        onOpenChange={(open) => !open && setRemovingTerm(null)}
        title="Hapus termin pembayaran?"
        description={
          removingTerm &&
          `${termLabel(removingTerm)} sebesar ${formatRupiah(removingTerm.amount)} dihapus dari jadwal pembayaran PO ini.`
        }
        confirmLabel="Hapus"
        loadingLabel="Menghapus..."
        loading={deleteTerm.isPending}
        onConfirm={handleRemoveTerm}
        variant="danger"
      />
    </Card>
  );
}
