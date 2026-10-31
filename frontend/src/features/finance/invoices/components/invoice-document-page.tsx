"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileDown, FileText, Loader2, Paperclip, Pencil, Send, Trash2, Upload, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { DocumentFooterBar, useLetterhead } from "@/features/documents";
import { AR_ROUTES } from "@/features/accounting/ar/api";
import { EVENT_TYPE_LABELS, type DealEventType } from "@/features/sales-funnel/pipeline/types";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import type { InvoiceDetail } from "../api";
import {
  useDeleteFakturPajak,
  useInvoiceDetail,
  useInvoicePayments,
  useReviseInvoice,
  useUpdateInvoiceStatus,
  useUploadFakturPajak,
} from "../queries";
import { INVOICE_PAYMENT_BADGES, INVOICE_STATUS_BADGES, PAYMENT_METHOD_LABELS } from "../status";
import { InvoiceSheet, type InvoiceSheetValues } from "./invoice-sheet";

const FAKTUR_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const FAKTUR_MAX_BYTES = 10 * 1024 * 1024;

const valuesOf = (detail: InvoiceDetail): InvoiceSheetValues => ({
  label: detail.label,
  amount: String(Math.round(detail.amount)),
  dueDate: detail.due_date ?? "",
  note: detail.note ?? "",
});

/**
 * Detail invoice untuk Finance sebagai lembar INVOICE. Mode Revisi
 * (label/nominal/jatuh tempo/catatan) ditutup begitu invoice batal atau
 * sudah menerima pembayaran; guard yang sama berlaku di server.
 */
export function FinanceInvoiceDocumentPage({ invoiceId }: { invoiceId: string }) {
  const detailQuery = useInvoiceDetail(invoiceId, true);
  const detail = detailQuery.data;
  if (!detail) {
    return (
      <div className="py-16 text-center">
        {detailQuery.isError ? (
          <>
            <p className="text-sm text-muted-foreground">{detailQuery.error.message}</p>
            <Button asChild variant="outline" className="mt-4">
              <Link href={AR_ROUTES.invoicesB2b}>Kembali ke daftar invoice</Link>
            </Button>
          </>
        ) : (
          <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-label="Memuat invoice" />
        )}
      </div>
    );
  }
  return <InvoiceDocument detail={detail} />;
}

function InvoiceDocument({ detail }: { detail: InvoiceDetail }) {
  const router = useRouter();
  const [draft, setDraft] = useState<InvoiceSheetValues | null>(null);
  const letterhead = useLetterhead(detail.company_id).data;
  const reviseMutation = useReviseInvoice(() => setDraft(null));
  const statusMutation = useUpdateInvoiceStatus();

  const canRevise = detail.status !== "batal" && detail.paid === 0;
  const values = draft ?? valuesOf(detail);
  const quotation = detail.quotation;
  const eventLabel = EVENT_TYPE_LABELS[detail.event_type as DealEventType] ?? detail.event_type;

  const save = () => {
    if (!draft) return;
    const amount = Number(draft.amount) || 0;
    if (!draft.label.trim() || amount <= 0 || reviseMutation.isPending) return;
    reviseMutation.mutate({
      invoiceId: detail.id,
      values: {
        label: draft.label.trim(),
        amount,
        due_date: draft.dueDate || null,
        note: draft.note.trim() || null,
      },
    });
  };

  return (
    <div>
      <PageHeader
        title={`Invoice ${detail.invoice_number}`}
        description={`${detail.org_name} · ${detail.deal_title}`}
        actions={
          <>
            <Badge className={`border-0 font-normal ${INVOICE_STATUS_BADGES[detail.status]}`}>{detail.status}</Badge>
            {detail.status !== "batal" ? (
              <Badge className={`border-0 font-normal ${INVOICE_PAYMENT_BADGES[detail.payment_status]}`}>
                {detail.payment_status}
              </Badge>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href={AR_ROUTES.invoicesB2b}>
                <ArrowLeft /> Daftar invoice
              </Link>
            </Button>
          </>
        }
      />

      <InvoiceSheet
        letterhead={letterhead}
        number={detail.invoice_number}
        numberPlaceholder=""
        info={{
          org: detail.org_name,
          pic: [detail.pic_name, detail.pic_title].filter(Boolean).join(", "),
          event: `${detail.deal_title} (${eventLabel})`,
          reference: quotation?.quote_number ?? null,
          term: detail.term
            ? `${detail.term.label ?? "Termin"} (${formatNumber(detail.term.percent, 2)}%)`
            : "Nominal bebas",
          invoiceDate: detail.created_at,
          eventDate: detail.event_date,
        }}
        values={values}
        onChange={draft ? (patch) => setDraft({ ...draft, ...patch }) : undefined}
        ppnPercent={quotation?.use_ppn ? quotation.ppn_persen : 0}
        paid={detail.paid}
      />

      <div className="mx-auto mt-4 grid w-full max-w-[1100px] grid-cols-1 gap-4 md:grid-cols-2">
        <FakturPajakCard detail={detail} />
        <PaymentHistoryCard invoiceId={detail.id} />
      </div>

      <DocumentFooterBar
        hint={!canRevise && detail.status !== "batal" ? "Sudah menerima pembayaran, tidak bisa direvisi." : null}
      >
        <Button asChild variant="outline">
          <a href={`/api/sales-funnel/invoices/${detail.id}/pdf`} target="_blank" rel="noopener noreferrer">
            <FileDown /> Lihat PDF
          </a>
        </Button>
        {draft ? (
          <>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
              Batal
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={reviseMutation.isPending || !draft.label.trim() || !(Number(draft.amount) > 0)}
            >
              {reviseMutation.isPending ? "Menyimpan…" : "Simpan revisi"}
            </Button>
          </>
        ) : (
          <>
            {canRevise ? (
              <Button type="button" variant="outline" onClick={() => setDraft(valuesOf(detail))}>
                <Pencil /> Revisi
              </Button>
            ) : null}
            {detail.status === "terkirim" && detail.payment_status !== "lunas" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`${AR_ROUTES.receipts}?sales_invoice=${detail.id}`)}
              >
                <Wallet /> Terima di Accounting
              </Button>
            ) : null}
            {detail.status === "diajukan" || detail.status === "draft" ? (
              <Button
                type="button"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate({ invoiceId: detail.id, status: "terkirim" })}
              >
                <Send /> Terbitkan
              </Button>
            ) : null}
          </>
        )}
      </DocumentFooterBar>
    </div>
  );
}

/** Lampiran faktur pajak resmi, terpisah dari PDF invoice internal. */
function FakturPajakCard({ detail }: { detail: InvoiceDetail }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useUploadFakturPajak();
  const deleteMutation = useDeleteFakturPajak();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset agar file yang sama bisa dipilih ulang
    if (!file) return;
    if (file.size > FAKTUR_MAX_BYTES) {
      toast.error("Ukuran dokumen maksimal 10 MB");
      return;
    }
    uploadMutation.mutate({ invoiceId: detail.id, file });
  };

  return (
    <section aria-labelledby="faktur-title" className="rounded-card bg-card p-4 text-sm shadow-card">
      <h2
        id="faktur-title"
        className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        <Paperclip className="size-3.5" /> Faktur Pajak
      </h2>
      {detail.has_faktur_pajak ? (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/finance/invoices/${detail.id}/faktur-pajak`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-forest underline-offset-2 hover:underline"
          >
            <FileText className="size-4" /> Lihat lampiran
          </a>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
          >
            Ganti
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => deleteMutation.mutate(detail.id)}
            disabled={deleteMutation.isPending}
            aria-label="Hapus lampiran faktur pajak"
            className="ml-auto text-muted-foreground hover:text-danger"
          >
            <Trash2 />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
        >
          {uploadMutation.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
          Unggah Faktur Pajak
        </Button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={FAKTUR_ACCEPT}
        onChange={handleFileChange}
        className="hidden"
        aria-label="Berkas faktur pajak"
      />
      <p className="mt-2 text-xs text-muted-foreground">PDF/JPG/PNG/WebP, maksimal 10 MB.</p>
    </section>
  );
}

function PaymentHistoryCard({ invoiceId }: { invoiceId: string }) {
  const paymentsQuery = useInvoicePayments(invoiceId, true);
  const payments = paymentsQuery.data ?? [];
  return (
    <section aria-labelledby="payments-title" className="rounded-card bg-card p-4 text-sm shadow-card">
      <h2 id="payments-title" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Riwayat pembayaran
      </h2>
      {paymentsQuery.isLoading ? (
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" aria-label="Memuat pembayaran" />
      ) : payments.length === 0 ? (
        <p className="text-xs text-muted-foreground">Belum ada pembayaran.</p>
      ) : (
        <ul className="space-y-1.5">
          {payments.map((payment) => (
            <li key={payment.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
              <span className="font-semibold tabular-nums">{formatRupiah(payment.amount)}</span>
              <Badge variant="muted">{PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}</Badge>
              <span className="text-xs text-muted-foreground">
                {formatDate(payment.paid_on, "—")}
                {payment.note ? ` · ${payment.note}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
