"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/components/ui/numeric-input";
import { DocumentLineInput, documentLineClass } from "@/features/documents";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { termPercentSum, type QuotationTermForm } from "../types";

const MAX_TERMS = 12;

/** Termin pembayaran opsional; bila diisi, total persennya wajib 100. */
export function QuotationTermsEditor({
  terms,
  total,
  readOnly,
  onUsePreset,
  onAdd,
  onChange,
  onRemove,
}: {
  terms: QuotationTermForm[];
  total: number;
  readOnly: boolean;
  onUsePreset: () => void;
  onAdd: () => void;
  onChange: (index: number, patch: Partial<QuotationTermForm>) => void;
  onRemove: (index: number) => void;
}) {
  const percentSum = termPercentSum(terms);
  const balanced = Math.abs(percentSum - 100) <= 0.01;
  const amountOf = (term: QuotationTermForm) =>
    Math.round(total * (Number(term.percent) || 0)) / 100;

  return (
    <section aria-labelledby="q-terms-title" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="q-terms-title" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Termin pembayaran
          </h3>
          {readOnly ? null : (
            <p className="text-xs text-muted-foreground">
              Opsional. Total persen wajib 100%; tampil di PDF dan jadi acuan invoice.
            </p>
          )}
        </div>
        {!readOnly && terms.length === 0 ? (
          <Button type="button" variant="outline" size="sm" onClick={onUsePreset}>
            <Plus /> Pakai termin
          </Button>
        ) : null}
      </div>

      {terms.length === 0 ? (
        readOnly ? <p className="text-sm text-muted-foreground">Tanpa termin.</p> : null
      ) : (
        <ul className="space-y-1.5">
          {terms.map((term, index) => {
            const row = index + 1;
            return readOnly ? (
              <li key={index} className="flex flex-wrap justify-between gap-2 border-b border-border py-1.5 text-sm">
                <span>
                  {term.label} ({formatNumber(term.percent, 2)}%)
                  {term.due_date ? ` · jatuh tempo ${formatDate(term.due_date)}` : ""}
                </span>
                <span className="font-semibold tabular-nums">{formatRupiah(amountOf(term))}</span>
              </li>
            ) : (
              <li
                key={index}
                className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_9.5rem_7rem_auto]"
              >
                <DocumentLineInput
                  aria-label={`Label termin ${row}`}
                  value={term.label}
                  onChange={(e) => onChange(index, { label: e.target.value })}
                  placeholder={index === 0 ? "mis. DP" : "mis. Pelunasan"}
                />
                <NumericInput
                  aria-label={`Persen termin ${row}`}
                  value={term.percent === "" ? null : Number(term.percent)}
                  onValueChange={(value) => onChange(index, { percent: String(value) })}
                  decimalScale={2}
                  max={100}
                  placeholder="%"
                  className={cn(documentLineClass, "text-right")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onRemove(index)}
                  aria-label={`Hapus termin ${row}`}
                  className="text-muted-foreground hover:text-danger sm:order-last"
                >
                  <Trash2 />
                </Button>
                <DocumentLineInput
                  type="date"
                  aria-label={`Jatuh tempo termin ${row}`}
                  value={term.due_date}
                  onChange={(e) => onChange(index, { due_date: e.target.value })}
                  className="col-span-2 sm:col-span-1"
                />
                <span className="text-right text-sm font-semibold tabular-nums">{formatRupiah(amountOf(term))}</span>
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && terms.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onAdd} disabled={terms.length >= MAX_TERMS}>
            <Plus /> Tambah termin
          </Button>
          <span className={cn("text-xs font-semibold", balanced ? "text-success" : "text-warning")}>
            Total {formatNumber(percentSum, 2)}%{balanced ? "" : ", harus 100%"}
          </span>
        </div>
      ) : null}
    </section>
  );
}
