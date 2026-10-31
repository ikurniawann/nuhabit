"use client";

import type { ReactNode } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  DocumentInfoGrid,
  DocumentInfoRow,
  DocumentItemsTable,
  DocumentLetterhead,
  DocumentLineInput,
  DocumentLineText,
  DocumentSheet,
  DocumentSummary,
  DocumentSummaryRow,
  DocumentTitleBand,
  documentLineClass,
  type DocumentColumn,
  type Letterhead,
} from "@/features/documents";
import { RupiahInput } from "@/features/sales-funnel/pipeline/components/rupiah-input";
import { formatDate, formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Isian invoice: nominal string digit (RupiahInput), tanggal "YYYY-MM-DD". */
export interface InvoiceSheetValues {
  label: string;
  amount: string;
  dueDate: string;
  note: string;
}

export interface InvoiceSheetInfo {
  org: string;
  pic: string;
  event: string;
  reference: string | null;
  term: string;
  invoiceDate: string | Date;
  eventDate: string | null;
}

const columns = (editing: boolean): DocumentColumn[] => [
  { label: "No", className: "w-10" },
  { label: "Keterangan", required: editing },
  { label: "Jumlah", className: "w-56 text-right", required: editing },
];

/** DPP dan PPN dari nominal yang sudah termasuk PPN, seperti PDF invoice. */
export function splitPpn(amount: number, ppnPercent: number) {
  const dpp = ppnPercent > 0 ? Math.round(amount / (1 + ppnPercent / 100)) : amount;
  return { dpp, ppn: amount - dpp };
}

/**
 * Lembar INVOICE: kop, nomor, info, satu baris tagihan dan ringkasan
 * DPP/PPN. Tanpa `onChange` semuanya hanya-baca.
 */
export function InvoiceSheet({
  letterhead,
  branchName,
  number,
  numberPlaceholder,
  info,
  values,
  onChange,
  ppnPercent,
  paid,
  children,
}: {
  letterhead: Letterhead | undefined;
  branchName?: string | null;
  number: string | null;
  numberPlaceholder: string;
  info: InvoiceSheetInfo;
  values: InvoiceSheetValues;
  onChange?: (patch: Partial<InvoiceSheetValues>) => void;
  /** 0 bila tanpa PPN. */
  ppnPercent: number;
  /** Diisi untuk invoice yang sudah ada: baris dibayar dan sisa. */
  paid?: number;
  /** Isi tambahan di bawah ringkasan, mis. lampiran faktur pajak. */
  children?: ReactNode;
}) {
  const editing = onChange !== undefined;
  const amount = Number(values.amount) || 0;
  const { dpp, ppn } = splitPpn(amount, ppnPercent);

  return (
    <DocumentSheet aria-label="Dokumen invoice">
      <DocumentLetterhead letterhead={letterhead} branchName={branchName} />
      <DocumentTitleBand title="INVOICE" number={number} placeholder={numberPlaceholder} />
      <DocumentInfoGrid
        left={
          <>
            <DocumentInfoRow label="Kepada">
              <DocumentLineText>{info.org}</DocumentLineText>
            </DocumentInfoRow>
            <DocumentInfoRow label="PIC">
              <DocumentLineText>{info.pic}</DocumentLineText>
            </DocumentInfoRow>
            <DocumentInfoRow label="Acara">
              <DocumentLineText>{info.event}</DocumentLineText>
            </DocumentInfoRow>
            <DocumentInfoRow label="Referensi">
              <DocumentLineText>{info.reference}</DocumentLineText>
            </DocumentInfoRow>
          </>
        }
        right={
          <>
            <DocumentInfoRow label="Tanggal invoice">
              <DocumentLineText>{formatDate(info.invoiceDate)}</DocumentLineText>
            </DocumentInfoRow>
            <DocumentInfoRow label="Jatuh tempo" htmlFor={editing ? "inv-due-date" : undefined}>
              {editing ? (
                <DocumentLineInput
                  id="inv-due-date"
                  type="date"
                  value={values.dueDate}
                  onChange={(e) => onChange({ dueDate: e.target.value })}
                />
              ) : (
                <DocumentLineText>{formatDate(values.dueDate, "")}</DocumentLineText>
              )}
            </DocumentInfoRow>
            <DocumentInfoRow label="Termin">
              <DocumentLineText>{info.term}</DocumentLineText>
            </DocumentInfoRow>
            <DocumentInfoRow label="Tanggal acara">
              <DocumentLineText>{formatDate(info.eventDate, "")}</DocumentLineText>
            </DocumentInfoRow>
          </>
        }
      />

      <DocumentItemsTable label="Rincian tagihan" columns={columns(editing)}>
        <tr className="align-top">
          <td className="px-2 py-2.5 text-muted-foreground">1</td>
          <td className="px-2 py-1.5">
            {editing ? (
              <>
                <label htmlFor="inv-label" className="sr-only">
                  Keterangan tagihan
                </label>
                <DocumentLineInput
                  id="inv-label"
                  required
                  value={values.label}
                  onChange={(e) => onChange({ label: e.target.value })}
                  placeholder="mis. DP 50%"
                />
              </>
            ) : (
              <p className="py-1">{values.label}</p>
            )}
          </td>
          <td className="px-2 py-1.5 text-right">
            {editing ? (
              <>
                <label htmlFor="inv-amount" className="sr-only">
                  Nominal tagihan
                </label>
                <RupiahInput
                  id="inv-amount"
                  required
                  value={values.amount}
                  onValueChange={(digits) => onChange({ amount: digits })}
                  className={cn(documentLineClass, "text-right font-semibold")}
                />
              </>
            ) : (
              <p className="py-1 font-semibold tabular-nums">{formatRupiah(amount)}</p>
            )}
          </td>
        </tr>
      </DocumentItemsTable>

      <div className="grid grid-cols-1 gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="space-y-1.5">
          {editing ? (
            <label
              htmlFor="inv-note"
              className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Catatan
            </label>
          ) : (
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Catatan</h3>
          )}
          {editing ? (
            <Textarea
              id="inv-note"
              value={values.note}
              onChange={(e) => onChange({ note: e.target.value })}
              rows={3}
              placeholder="Rekening tujuan, syarat pembayaran, dan lainnya"
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm">{values.note || "—"}</p>
          )}
        </div>
        <div className="space-y-3">
          <DocumentSummary label="Ringkasan tagihan">
            {ppnPercent > 0 ? (
              <>
                <DocumentSummaryRow label="DPP" value={formatRupiah(dpp)} />
                <DocumentSummaryRow tone="tax" label={`PPN ${ppnPercent}%`} value={formatRupiah(ppn)}>
                  <span className="text-xs font-normal normal-case">sudah termasuk</span>
                </DocumentSummaryRow>
              </>
            ) : null}
            <DocumentSummaryRow tone="total" label="Total tagihan" value={formatRupiah(amount)} />
            {paid !== undefined ? (
              <>
                <DocumentSummaryRow label="Sudah dibayar" value={formatRupiah(paid)} />
                <DocumentSummaryRow tone="discount" label="Sisa tagihan" value={formatRupiah(Math.max(0, amount - paid))} />
              </>
            ) : null}
          </DocumentSummary>
          {children}
        </div>
      </div>
    </DocumentSheet>
  );
}
