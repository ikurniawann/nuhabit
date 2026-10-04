"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/format";
import {
  ADDITIONAL_COST_TYPES,
  type AdditionalCostLine,
  type AdditionalCostType,
} from "@/lib/purchasing/production-ui-order-form";

type AdditionalCostsCardProps = {
  lines: AdditionalCostLine[];
  total: number;
  onAdd: () => void;
  onChange: (id: string, changes: Partial<AdditionalCostLine>) => void;
  onRemove: (id: string) => void;
};

export function AdditionalCostsCard({ lines, total, onAdd, onChange, onRemove }: AdditionalCostsCardProps) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base">Biaya Tambahan</CardTitle>
          <p className="mt-1 text-xs text-gray-500">
            Tambahkan overhead, tenaga kerja, kemasan, atau biaya produksi lainnya.
          </p>
        </div>
        <CardAction>
          <Button type="button" variant="outline" size="sm" className="h-9 border-gray-200/80 text-xs" onClick={onAdd}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Tambah Baris
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="min-w-[720px] w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Keterangan</th>
                <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Tipe</th>
                <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">Nominal</th>
                <th className="px-4 py-3 text-right font-semibold whitespace-nowrap w-16">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((line) => (
                <tr key={line.id} className="hover:bg-gray-50/80">
                  <td className="px-4 py-3 align-middle">
                    <Input
                      value={line.description}
                      onChange={(event) => onChange(line.id, { description: event.target.value })}
                      placeholder="mis. Tenaga kerja shift, kemasan box"
                      className="h-10 text-sm focus:border-pink-400 focus:ring-1 focus:ring-pink-100"
                    />
                  </td>
                  <td className="px-4 py-3 align-middle whitespace-nowrap">
                    <Select
                      value={line.type}
                      onValueChange={(value) => onChange(line.id, { type: value as AdditionalCostType })}
                    >
                      <SelectTrigger className="h-10 w-full min-w-[140px] border-gray-200/80">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ADDITIONAL_COST_TYPES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <Input
                      value={line.amount}
                      onChange={(event) => onChange(line.id, { amount: event.target.value })}
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0"
                      className="h-10 text-right text-sm focus:border-pink-400 focus:ring-1 focus:ring-pink-100"
                    />
                  </td>
                  <td className="px-4 py-3 text-right align-middle">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemove(line.id)}
                      title="Hapus baris"
                      className="text-gray-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Hapus baris biaya tambahan"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-gray-200/70 bg-gray-50/80">
              <tr>
                <td
                  colSpan={2}
                  className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500"
                >
                  Total biaya tambahan
                </td>
                <td className="px-4 py-3 text-right text-base font-bold tabular-nums text-gray-900">
                  {formatNumber(total)}
                </td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
