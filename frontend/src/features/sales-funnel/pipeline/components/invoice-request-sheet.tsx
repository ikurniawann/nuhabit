"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DocumentFilterStrip, DocumentFooterBar, useLetterhead } from "@/features/documents";
import { InvoiceSheet, type InvoiceSheetValues } from "@/features/finance/invoices/components/invoice-sheet";
import { formatNumber, formatRupiah } from "@/lib/format";
import type { DealInvoiceData } from "../api";
import { useCreateDealInvoice, useDeal } from "../queries";
import { EVENT_TYPE_LABELS } from "../types";

const CUSTOM_TERM = "custom";
const EMPTY: InvoiceSheetValues = { label: "", amount: "", dueDate: "", note: "" };

/**
 * Pengajuan invoice sebagai lembar INVOICE di sheet setinggi layar. Sales
 * menarik nominal dari termin quotation acuan atau mengisi nominal bebas;
 * Finance yang menerbitkan.
 */
export function InvoiceRequestSheet({
  dealId,
  data,
  open,
  onOpenChange,
}: {
  dealId: string;
  data: DealInvoiceData | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="gap-0 bg-surface p-0 data-[side=right]:overflow-y-auto data-[side=right]:sm:max-w-5xl"
      >
        {open ? <InvoiceRequestForm dealId={dealId} data={data} onDone={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function InvoiceRequestForm({
  dealId,
  data,
  onDone,
}: {
  dealId: string;
  data: DealInvoiceData | undefined;
  onDone: () => void;
}) {
  const [termId, setTermId] = useState(CUSTOM_TERM);
  const [values, setValues] = useState(EMPTY);
  const deal = useDeal(dealId).data;
  const letterhead = useLetterhead(deal?.company_id, deal !== undefined).data;
  const createMutation = useCreateDealInvoice(dealId, onDone);

  const reference = data?.reference ?? null;
  const availableTerms = data?.available_terms ?? [];
  const openTerms = availableTerms.filter((term) => !term.invoiced);
  const term = availableTerms.find((t) => t.term_id === termId);
  const termOptions = [
    { value: CUSTOM_TERM, label: "Nominal bebas (tanpa termin)" },
    ...openTerms.map((t) => ({
      value: t.term_id,
      label: `${t.label} (${formatNumber(t.percent, 3)}%)`,
      description: formatRupiah(t.amount),
    })),
  ];

  const applyTerm = (value: string) => {
    const picked = availableTerms.find((t) => t.term_id === value);
    setTermId(picked ? value : CUSTOM_TERM);
    if (picked) {
      setValues((prev) => ({
        ...prev,
        label: picked.label,
        amount: String(Math.round(picked.amount)),
        dueDate: picked.due_date ?? "",
      }));
    }
  };

  const amount = Number(values.amount) || 0;
  const canSubmit = values.label.trim() !== "" && amount > 0 && !createMutation.isPending;
  const submit = () => {
    if (!canSubmit) return;
    createMutation.mutate({
      term_id: term ? termId : null,
      label: values.label.trim(),
      amount,
      due_date: values.dueDate || null,
      note: values.note.trim() || null,
    });
  };

  const pic = deal ? [deal.pic_name, deal.pic_title].filter(Boolean).join(", ") : "";
  return (
    <div className="flex min-h-full flex-col">
      <div className="px-4 pt-5 pr-14 sm:px-6">
        <SheetTitle className="text-xl font-bold">Ajukan Invoice</SheetTitle>
        <SheetDescription>
          Pengajuan masuk ke Finance untuk diterbitkan. Nominal termin sudah termasuk PPN.
        </SheetDescription>
      </div>
      <div className="flex-1 px-4 py-4 sm:px-6">
        <DocumentFilterStrip className="sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="inv-term" className="text-xs font-medium text-muted-foreground">
              Tarik dari termin
            </label>
            <Combobox
              id="inv-term"
              options={termOptions}
              value={termId}
              onChange={applyTerm}
              className="h-10 rounded-full bg-card"
            />
            {availableTerms.length > 0 && openTerms.length === 0 ? (
              <p className="text-xs text-muted-foreground">Semua termin sudah memiliki invoice aktif.</p>
            ) : null}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Quotation acuan</p>
            <p className="flex h-10 items-center rounded-full bg-card px-4 text-sm">
              {reference
                ? `${reference.quote_number} · ${formatRupiah(reference.total)}${reference.is_accepted ? " · diterima" : ""}`
                : "Belum ada quotation"}
            </p>
          </div>
        </DocumentFilterStrip>
        <InvoiceSheet
          letterhead={letterhead}
          branchName={deal?.branch_name}
          number={null}
          numberPlaceholder="Otomatis setelah diajukan"
          info={{
            org: deal?.org_name ?? "",
            pic,
            event: deal ? `${deal.title} (${EVENT_TYPE_LABELS[deal.event_type] ?? deal.event_type})` : "",
            reference: reference?.quote_number ?? null,
            term: term ? `${term.label} (${formatNumber(term.percent, 3)}%)` : "Nominal bebas",
            invoiceDate: new Date(),
            eventDate: deal?.event_date ?? null,
          }}
          values={values}
          onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
          ppnPercent={reference?.use_ppn ? reference.ppn_persen : 0}
        />
      </div>
      <DocumentFooterBar inSheet>
        <Button type="button" variant="ghost" onClick={onDone}>
          Batal
        </Button>
        <Button type="button" onClick={submit} disabled={!canSubmit}>
          {createMutation.isPending ? "Mengirim…" : "Ajukan ke Finance"}
        </Button>
      </DocumentFooterBar>
    </div>
  );
}
