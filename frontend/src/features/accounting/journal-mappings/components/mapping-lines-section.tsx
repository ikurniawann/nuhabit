"use client";

import { useMemo } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { formComboboxClassName } from "@/components/layout/form-field";
import type { CoaAccountItem } from "@/features/accounting/chart-of-accounts/types";
import {
  JOURNAL_AMOUNT_SOURCES,
  JOURNAL_ENTRY_SIDES,
  JOURNAL_LINE_ROLES,
  isCashBankLineRole,
  type JournalAmountSource,
  type JournalEntrySide,
} from "@/lib/accounting/journal-mapping-types";
import type { MappingFormLine } from "../mapping-form";

const sideOptions = JOURNAL_ENTRY_SIDES.map((s) => ({ value: s, label: s }));
const roleOptions = JOURNAL_LINE_ROLES.map((r) => ({ value: r, label: r }));
const amountOptions = JOURNAL_AMOUNT_SOURCES.map((s) => ({
  value: s,
  label: s,
}));

/** Baris Debit/Credit template jurnal; peran CASH/BANK mengutamakan akun Kas/Bank. */
export function MappingLinesSection({
  lines,
  coaRows,
  onAdd,
  onUpdate,
  onRemove,
}: {
  lines: MappingFormLine[];
  coaRows: CoaAccountItem[];
  onAdd: () => void;
  onUpdate: (key: string, patch: Partial<MappingFormLine>) => void;
  onRemove: (key: string) => void;
}) {
  const coaOptionsAll = useMemo(
    () =>
      coaRows.map((a) => ({
        value: a.id,
        label: `${a.code_display || a.code} — ${a.name}`,
        description: a.is_cash_bank ? "Kas/Bank" : undefined,
      })),
    [coaRows],
  );
  const coaCashBankOptions = useMemo(
    () =>
      coaRows
        .filter((a) => a.is_cash_bank)
        .map((a) => ({
          value: a.id,
          label: `${a.code_display || a.code} — ${a.name}`,
          description: "Kas/Bank",
        })),
    [coaRows],
  );

  return (
    <section className="rounded-xl border border-gray-200/70 bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Baris jurnal
          </h2>
          <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">
            Satu baris = satu sisi jurnal. Minimal biasanya ada{" "}
            <span className="font-medium text-foreground">Debit</span> dan{" "}
            <span className="font-medium text-foreground">Credit</span>. Contoh
            penjualan cash: Debit Kas (TOTAL) + Credit Revenue (SUBTOTAL) +
            Credit Pajak (TAX).
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 rounded-lg border-gray-200/80"
          onClick={onAdd}
        >
          + Baris
        </Button>
      </div>

      <div className="mt-4 hidden gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:grid lg:grid-cols-12">
        <div className="lg:col-span-2">Sisi</div>
        <div className="lg:col-span-2">Peran akun</div>
        <div className="lg:col-span-2">Sumber nominal</div>
        <div className="lg:col-span-5">Akun COA</div>
        <div className="lg:col-span-1" />
      </div>

      <div className="mt-2 space-y-3">
        {lines.map((line) => {
          const accountOptions = isCashBankLineRole(line.line_role)
            ? coaCashBankOptions.length > 0
              ? coaCashBankOptions
              : coaOptionsAll
            : coaOptionsAll;
          return (
            <div
              key={line.key}
              className="grid gap-2 rounded-lg border border-gray-200/70 bg-muted/20 p-3 lg:grid-cols-12"
            >
              <div className="space-y-1 lg:col-span-2">
                <span className="text-xs text-muted-foreground lg:hidden">
                  Sisi (Debit/Credit)
                </span>
                <Combobox
                  options={sideOptions}
                  value={line.entry_side}
                  onChange={(value) =>
                    onUpdate(line.key, {
                      entry_side: value as JournalEntrySide,
                    })
                  }
                  placeholder="Debit / Credit"
                  className={formComboboxClassName}
                />
              </div>
              <div className="space-y-1 lg:col-span-2">
                <span className="text-xs text-muted-foreground lg:hidden">
                  Peran akun
                </span>
                <Combobox
                  options={roleOptions}
                  value={line.line_role}
                  onChange={(value) => onUpdate(line.key, { line_role: value })}
                  placeholder="Peran akun"
                  searchPlaceholder="Cari peran..."
                  className={formComboboxClassName}
                />
              </div>
              <div className="space-y-1 lg:col-span-2">
                <span className="text-xs text-muted-foreground lg:hidden">
                  Sumber nominal
                </span>
                <Combobox
                  options={amountOptions}
                  value={line.amount_source}
                  onChange={(value) =>
                    onUpdate(line.key, {
                      amount_source: value as JournalAmountSource,
                    })
                  }
                  placeholder="Sumber nominal"
                  className={formComboboxClassName}
                />
              </div>
              <div className="space-y-1 lg:col-span-5">
                <span className="text-xs text-muted-foreground lg:hidden">
                  Akun COA
                </span>
                <Combobox
                  options={accountOptions}
                  value={line.account_id}
                  onChange={(value) =>
                    onUpdate(line.key, { account_id: value })
                  }
                  placeholder="Pilih akun COA"
                  searchPlaceholder="Cari akun..."
                  allowClear
                  className={formComboboxClassName}
                />
              </div>
              <div className="flex items-center justify-end lg:col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  onClick={() => onRemove(line.key)}
                  disabled={lines.length <= 1}
                  aria-label="Hapus baris"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg border border-primary/15 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Arti kolom</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          <li>
            <span className="font-medium text-foreground">Sisi</span> — Debit
            (kiri) atau Credit (kanan) di jurnal.
          </li>
          <li>
            <span className="font-medium text-foreground">Peran akun</span> —
            fungsi baris (CASH, BANK, REVENUE, TAX, INVENTORY, AP, …).
          </li>
          <li>
            <span className="font-medium text-foreground">Sumber nominal</span>{" "}
            — field transaksi yang diisi (TOTAL, SUBTOTAL, TAX, COGS, PAID, …).
          </li>
          <li>
            <span className="font-medium text-foreground">Akun COA</span> — akun
            postable di Chart of Accounts (CASH/BANK diutamakan akun Kas/Bank).
          </li>
        </ul>
      </div>
    </section>
  );
}
