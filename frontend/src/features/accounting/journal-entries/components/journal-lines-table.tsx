"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  formComboboxClassName,
  formInputClassName,
} from "@/components/layout/form-field";
import type { FormLine } from "../journal-form";

type AccountOption = { value: string; label: string; description?: string };

export function JournalLinesTable({
  lines,
  readOnly,
  accountOptionsFor,
  updateLine,
  setDebit,
  setCredit,
  removeLine,
}: {
  lines: FormLine[];
  readOnly: boolean;
  accountOptionsFor: (lineKey: string) => AccountOption[];
  updateLine: (key: string, patch: Partial<FormLine>) => void;
  setDebit: (key: string, value: number) => void;
  setCredit: (key: string, value: number) => void;
  removeLine: (key: string) => void;
}) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-225 text-sm">
        <thead>
          <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <th className="min-w-70 px-2 py-2">Akun</th>
            <th className="w-36 px-2 py-2 text-right">Debit</th>
            <th className="w-36 px-2 py-2 text-right">Credit</th>
            <th className="min-w-40 px-2 py-2">Memo</th>
            <th className="w-12 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr
              key={line.key}
              className="border-b border-gray-200/70 last:border-0"
            >
              <td className="min-w-70 px-2 py-2 align-middle">
                <Combobox
                  options={accountOptionsFor(line.key)}
                  value={line.account_id}
                  onChange={(v) => updateLine(line.key, { account_id: v })}
                  placeholder="Pilih akun"
                  searchPlaceholder="Cari COA..."
                  disabled={readOnly}
                  className={formComboboxClassName}
                  contentClassName="min-w-80"
                />
              </td>
              <td className="px-2 py-2 align-middle">
                <NumericInput
                  value={line.debit || null}
                  onValueChange={(v) => setDebit(line.key, v)}
                  decimalScale={2}
                  disabled={readOnly}
                  placeholder="0"
                  className="h-10 border-gray-200/80 text-right focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
                />
              </td>
              <td className="px-2 py-2 align-middle">
                <NumericInput
                  value={line.credit || null}
                  onValueChange={(v) => setCredit(line.key, v)}
                  decimalScale={2}
                  disabled={readOnly}
                  placeholder="0"
                  className="h-10 border-gray-200/80 text-right focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
                />
              </td>
              <td className="px-2 py-2 align-middle">
                <Input
                  value={line.memo}
                  onChange={(e) =>
                    updateLine(line.key, { memo: e.target.value })
                  }
                  placeholder="Memo"
                  className={formInputClassName}
                  disabled={readOnly}
                />
              </td>
              <td className="px-2 py-2 align-middle">
                {!readOnly ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removeLine(line.key)}
                    className="h-10 w-10 p-0 text-red-500"
                    aria-label="Hapus baris"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
